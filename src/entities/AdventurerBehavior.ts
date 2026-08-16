// Behavior state machine (spec §7): deterministic movement and state
// transitions driven by timers, day phase, and the adventurer's daily plan.
// Never calls the API — AI decisions arrive asynchronously and steer the
// plan; the machine acts immediately on deterministic logic either way.

import type { Adventurer, AdventureOutcome, ChatMessage, GameState, Item } from "../types";
import { computeReaction, decidesToBuy, classifyPrice } from "../game/Economy";
import { resolveAdventure, fallbackAskPrice } from "../game/Combat";
import { makeItem } from "./Item";
import { fallbackMorningPlan, type DayPlan } from "./AdventurerFallback";

// Landmarks duplicated from GameEngine's TOWN to avoid an import cycle;
// GameEngine re-exports TOWN from here as the single source of truth.
export const TOWN = {
  shop: { x: 120, y: 140 },
  shopDoor: { x: 156, y: 200 },
  tavern: { x: 640, y: 120 },
  tavernDoor: { x: 668, y: 172 },
  houses: [
    { x: 200, y: 420 },
    { x: 360, y: 460 },
    { x: 560, y: 430 },
  ],
  gate: { x: 880, y: 300 },
  square: { x: 440, y: 280 },
} as const;

const WALK_SPEED = 60; // world px/sec at 1×

export interface BehaviorContext {
  /** Current plan for the day; set at dawn (fallback immediately, AI may revise). */
  plan: DayPlan;
  /** Countdown timer for timed states (browsing, buying, idling), in seconds. */
  timer: number;
  /** Walk target. */
  target: { x: number; y: number } | null;
  /** Item being considered while browsing. */
  browsingItem: string | null; // item id
  /** Set true once the day's shop trip / adventure is done. */
  shopped: boolean;
  adventured: boolean;
  /** Loot keys still to offer the player after returning. */
  lootToSell: string[]; // item ids in a.inventory
  /** The offer currently on the table, if any. */
  pendingOfferId: string | null;
}

export function freshContext(): BehaviorContext {
  return {
    plan: "rest",
    timer: 0,
    target: null,
    browsingItem: null,
    shopped: false,
    adventured: false,
    lootToSell: [],
    pendingOfferId: null,
  };
}

export interface StepResult {
  messages: ChatMessage[];
  /** Outcome resolved this step (engine attaches AI narration + records it). */
  outcome: AdventureOutcome | null;
}

/**
 * Advance one adventurer by dt seconds (already speed-scaled).
 * Mutates the adventurer and game state (purchases). Returns log messages.
 */
export function stepAdventurer(
  a: Adventurer,
  bc: BehaviorContext,
  s: GameState,
  dt: number,
): StepResult {
  const out: StepResult = { messages: [], outcome: null };
  if (!a.alive) return out;
  bc.timer = Math.max(0, bc.timer - dt);

  switch (a.state) {
    case "resting": {
      // Wake at dawn: plan the day (deterministic immediately; AI may override).
      if (s.phase === "dawn" || s.phase === "morning") {
        beginDay(a, bc);
      }
      break;
    }

    case "wandering": {
      // Route by plan and phase.
      if (s.phase === "night") {
        headHome(a, bc);
        break;
      }
      if (bc.plan === "shop" && !bc.shopped && (s.phase === "dawn" || s.phase === "morning")) {
        a.state = "heading_to_shop";
        bc.target = TOWN.shopDoor;
        break;
      }
      if (bc.plan === "adventure" && !bc.adventured && s.phase === "afternoon") {
        a.state = "heading_to_gate";
        bc.target = { x: TOWN.gate.x, y: TOWN.gate.y + 30 };
        break;
      }
      // Idle drift around the square/tavern.
      if (!bc.target && bc.timer <= 0) {
        const spots = [TOWN.square, { x: TOWN.tavernDoor.x, y: TOWN.tavernDoor.y + 20 }];
        const p = spots[(a.appearance.hair + s.day) % spots.length];
        bc.target = { x: p.x + jitter(a, 80), y: p.y + jitter(a, 50) };
      }
      if (walkToward(a, bc, dt)) {
        bc.target = null;
        bc.timer = 6 + (a.appearance.skin % 3) * 4; // linger
      }
      break;
    }

    case "heading_to_shop": {
      if (walkToward(a, bc, dt)) {
        a.state = "browsing";
        bc.timer = browseTime(a);
        bc.browsingItem = pickShelfItem(a, s);
        a.browsingItemId = bc.browsingItem;
      }
      break;
    }

    case "browsing": {
      if (bc.timer > 0) break;
      const item = s.shelves.find((it) => it?.id === bc.browsingItem) ?? null;
      if (item && decidesToBuy(a, item)) {
        a.state = "buying";
        bc.timer = 2.5;
      } else {
        if (item) recordReaction(a, item, out, s);
        // Careful shoppers examine a second item; others leave.
        const next = pickShelfItem(a, s, bc.browsingItem);
        if (a.personality.spendingStyle === "careful" && next) {
          bc.browsingItem = next;
          a.browsingItemId = next;
          bc.timer = browseTime(a);
        } else {
          leaveShop(a, bc);
        }
      }
      break;
    }

    case "buying": {
      if (bc.timer > 0) break;
      const idx = s.shelves.findIndex((it) => it?.id === bc.browsingItem);
      const item = idx >= 0 ? s.shelves[idx] : null;
      if (item && item.salePrice !== null && item.salePrice <= a.gold) {
        completePurchase(a, item, idx, s, out);
      }
      leaveShop(a, bc);
      break;
    }

    case "heading_to_gate": {
      if (walkToward(a, bc, dt)) {
        a.state = "adventuring";
        bc.adventured = true;
        a.daysSinceLastAdventure = 0;
      }
      break;
    }

    case "adventuring": {
      // Resolve at evening: deterministic outcome roll (§8), then home —
      // or not. The engine attaches AI narration to the outcome async.
      if (s.phase === "evening" || s.phase === "night") {
        const outcome = resolveAdventure(a, s.day);
        out.outcome = outcome;
        a.hp = Math.max(0, a.hp - outcome.damageTaken);

        if (!outcome.survived) {
          a.alive = false;
          a.state = "dead";
          s.stats.adventurersLost += 1;
          out.messages.push(
            systemMsg(s, `${a.name} has fallen to a ${outcome.monsterName} in the ${areaName(outcome.area)}...`),
          );
          break;
        }

        // Loot into inventory; remember what's for sale.
        for (const key of outcome.lootItemKeys) {
          const item = makeItem(key);
          a.inventory.push(item);
          bc.lootToSell.push(item.id);
        }
        if (outcome.monsterDefeated) {
          a.morale = Math.min(100, a.morale + 8);
          a.level = Math.min(10, a.level + (Math.random() < 0.25 ? 1 : 0));
        } else {
          a.morale = Math.max(0, a.morale - 10);
        }

        a.state = "returning";
        bc.target = bc.lootToSell.length > 0 ? TOWN.shopDoor : TOWN.square;
        a.position.x = TOWN.gate.x;
        a.position.y = TOWN.gate.y + 30;
        out.messages.push(
          systemMsg(
            s,
            outcome.monsterDefeated
              ? `${a.name} returned from the ${areaName(outcome.area)} with loot!`
              : `${a.name} limped back from the ${areaName(outcome.area)} empty-handed.`,
          ),
        );
      }
      break;
    }

    case "returning": {
      if (walkToward(a, bc, dt)) {
        if (bc.lootToSell.length > 0 && s.phase === "evening") {
          a.state = "selling_loot";
          bc.timer = 0;
        } else {
          a.state = "wandering";
          bc.timer = 4;
        }
      }
      break;
    }

    case "selling_loot": {
      // One offer at a time; the player accepts/declines via the engine
      // (Dev B's buy-from-adventurer UI drives that). Offers expire at night.
      if (bc.pendingOfferId) {
        const stillOpen = s.lootOffers.some((o) => o.id === bc.pendingOfferId);
        if (stillOpen && s.phase !== "night") break; // waiting on the player
        bc.pendingOfferId = null; // resolved or expired; next item or leave
      }
      const nextId = bc.lootToSell.shift();
      const item = nextId ? a.inventory.find((it) => it.id === nextId) : undefined;
      if (item && s.phase !== "night") {
        const offer = {
          id: `offer-${s.day}-${a.id}-${item.id.slice(0, 8)}`,
          adventurerId: a.id,
          adventurerName: a.name,
          item,
          askPrice: fallbackAskPrice(a, item.baseValue),
          day: s.day,
        };
        s.lootOffers.push(offer);
        bc.pendingOfferId = offer.id;
        out.messages.push(systemMsg(s, `${a.name} offers ${item.name} for ${offer.askPrice}g.`));
      } else {
        a.state = "wandering";
        bc.timer = 4;
      }
      break;
    }

    default:
      break;
  }

  // Night curfew for everyone still out (night owls come in Phase 6).
  if (s.phase === "night" && a.state !== "resting" && a.state !== "adventuring") {
    headHome(a, bc);
    if (walkToward(a, bc, dt)) a.state = "resting";
  }

  return out;
}

// ---------- day start ----------

function beginDay(a: Adventurer, bc: BehaviorContext): void {
  a.hp = Math.min(a.maxHp, a.hp + 10); // overnight recovery
  bc.plan = fallbackMorningPlan(a);
  bc.shopped = false;
  bc.adventured = false;
  a.daysSinceLastAdventure += 1;
  a.memory.daysInTown += 1;
  a.state = "wandering";
  bc.timer = jitterAbs(a, 8); // stagger wake-ups so the town doesn't move in lockstep
}

/** AI morning decision arrived (async) — adopt it if the day hasn't progressed past it. */
export function applyPlanOverride(a: Adventurer, bc: BehaviorContext, plan: DayPlan): void {
  if (a.state === "wandering" || a.state === "resting") {
    bc.plan = plan;
  }
}

// ---------- shop helpers ----------

function browseTime(a: Adventurer): number {
  // Impulsive grabs fast; careful compares (spec §14).
  const base = { impulsive: 2, generous: 4, frugal: 6, careful: 8 } as const;
  return base[a.personality.spendingStyle];
}

function pickShelfItem(a: Adventurer, s: GameState, excludeId?: string | null): string | null {
  const priced = s.shelves.filter(
    (it): it is Item => it !== null && it.salePrice !== null && it.id !== excludeId,
  );
  if (priced.length === 0) return null;
  // Prefer upgrades, then preferred categories, then cheapest.
  const scored = priced
    .map((it) => {
      let score = 0;
      const slotQ =
        it.category === "weapon" ? a.equipment.weapon?.quality ?? 0
        : it.category === "armor" ? a.equipment.armor?.quality ?? 0
        : it.category === "accessory" ? a.equipment.accessory?.quality ?? 0
        : 0;
      if (it.quality > slotQ) score += 10;
      if (a.personality.preferredItems.includes(it.category)) score += 5;
      if (it.category === "consumable") score += 2;
      score -= (it.salePrice ?? 0) / 100;
      return { it, score };
    })
    .sort((x, y) => y.score - x.score);
  return scored[0].it.id;
}

function leaveShop(a: Adventurer, bc: BehaviorContext): void {
  a.state = "wandering";
  bc.shopped = true;
  bc.browsingItem = null;
  a.browsingItemId = null;
  bc.target = { x: TOWN.square.x, y: TOWN.square.y + 20 };
}

function completePurchase(
  a: Adventurer,
  item: Item,
  shelfIdx: number,
  s: GameState,
  out: StepResult,
): void {
  const price = item.salePrice!;
  a.gold -= price;
  s.gold += price;
  s.stats.totalGoldEarned += price;
  s.stats.itemsSold += 1;
  s.shelves[shelfIdx] = null;

  // Equip upgrades; stash the rest.
  const slot =
    item.category === "weapon" ? "weapon"
    : item.category === "armor" ? "armor"
    : item.category === "accessory" ? "accessory"
    : null;
  if (slot && (a.equipment[slot]?.quality ?? 0) < item.quality) {
    if (a.equipment[slot]) a.inventory.push(a.equipment[slot]!);
    a.equipment[slot] = item;
  } else {
    a.inventory.push(item);
  }

  // Memory + relationship (§14): fairness is remembered.
  const fairness = classifyPrice(item);
  a.memory.lastPricePaid[item.name] = price;
  if (fairness === "fair") {
    a.memory.timesFairlyTreated += 1;
    a.loyalty = Math.min(100, a.loyalty + 2);
    a.relationships.shopkeeper = Math.min(100, a.relationships.shopkeeper + 2);
  } else if (fairness === "ripoff") {
    a.memory.timesOvercharged += 1;
    a.loyalty = Math.max(0, a.loyalty - (a.memory.grudges ? 6 : 3));
    a.relationships.shopkeeper = Math.max(-100, a.relationships.shopkeeper - 4);
  }

  out.messages.push(systemMsg(s, `${a.name} bought ${item.name} for ${price}g!`));
}

function recordReaction(a: Adventurer, item: Item, out: StepResult, s: GameState): void {
  const r = computeReaction(a, item);
  if (r === "angry") {
    a.relationships.shopkeeper = Math.max(-100, a.relationships.shopkeeper - 2);
    out.messages.push(systemMsg(s, `${a.name} scoffed at the price of ${item.name} and walked out.`));
  }
}

// ---------- movement ----------

function headHome(a: Adventurer, bc: BehaviorContext): void {
  const home = TOWN.houses[a.appearance.skin % TOWN.houses.length];
  bc.target = { x: home.x + 16, y: home.y + 40 };
}

/** Walk toward bc.target; returns true when arrived. */
function walkToward(a: Adventurer, bc: BehaviorContext, dt: number): boolean {
  if (!bc.target) return true;
  const dx = bc.target.x - a.position.x;
  const dy = bc.target.y - a.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) {
    a.position.moving = false;
    return true;
  }
  const step = Math.min(dist, WALK_SPEED * dt);
  a.position.x += (dx / dist) * step;
  a.position.y += (dy / dist) * step;
  a.position.moving = true;
  a.position.facing =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  return false;
}

// ---------- misc ----------

function areaName(area: "forest_edge" | "shadow_cave"): string {
  return area === "forest_edge" ? "Forest Edge" : "Shadow Cave";
}

function jitter(a: Adventurer, range: number): number {
  return ((a.appearance.skin * 7 + a.appearance.hair * 13) % range) - range / 2;
}

function jitterAbs(a: Adventurer, range: number): number {
  return (a.appearance.skin * 7 + a.appearance.hair * 13) % range;
}

let msgCounter = 0;
function systemMsg(s: GameState, content: string): ChatMessage {
  return {
    id: `sys-${s.day}-${msgCounter++}`,
    senderId: "system",
    senderName: "Town",
    type: "system",
    content,
    timestamp: s.timeOfDay,
    day: s.day,
  };
}
