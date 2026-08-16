// Behavior state machine (spec §7): deterministic movement and state
// transitions driven by timers, day phase, and the adventurer's daily plan.
// Never calls the API — AI decisions arrive asynchronously and steer the
// plan; the machine acts immediately on deterministic logic either way.

import type { Adventurer, AdventureOutcome, ChatMessage, GameState, Item } from "../types";
import { computeReaction, decidesToBuy, classifyPrice, equippedQuality } from "../game/Economy";
import { recordReactionSeen, recordSale, recordWalkout } from "../game/Ledger";
import { resolveAdventure, generateAdventureScript, fallbackAskPrice } from "../game/Combat";
import { makeRng } from "../utils/rng";
import { makeItem } from "./Item";
import { browseSpeedFactor } from "./Helper";
import { fallbackMorningPlan, type DayPlan } from "./AdventurerFallback";
import { getBuilding } from "../utils/TownBuildings";

const WALK_SPEED = 60; // world px/sec at 1×

// ---------- town geometry lookups (spec V2.8, issue #56) ----------
// Landmarks used to be a frozen TOWN literal duplicated here; they now live
// on GameState.buildings (the registry), reached through GameState which
// every behavior function already receives — no import cycle needed.

function mustGetBuilding(s: GameState, id: string) {
  const b = getBuilding(s.buildings, id);
  if (!b) throw new Error(`town building missing from registry: ${id}`);
  return b;
}

/** A building's anchor point (footprint origin) — its render/movement
 *  landmark for buildings with no separate door. */
function anchorOf(s: GameState, id: string): { x: number; y: number } {
  const { footprint } = mustGetBuilding(s, id);
  return { x: footprint.x, y: footprint.y };
}

/** A building's walk-to interaction point, falling back to its anchor. */
function doorOf(s: GameState, id: string): { x: number; y: number } {
  const b = mustGetBuilding(s, id);
  return b.door ?? { x: b.footprint.x, y: b.footprint.y };
}

/** Houses in registry order (matches the old TOWN.houses array order). */
function houseAnchors(s: GameState): { x: number; y: number }[] {
  return s.buildings.filter((b) => b.kind === "house").map((b) => ({ x: b.footprint.x, y: b.footprint.y }));
}

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
  /** Last day beginDay ran — guards the once-per-day plan (0 = never). */
  planDay: number;
  /** Day of the last night run (guards one-per-night) and whether the
   *  current adventure is a night run. */
  nightRunDay: number;
  onNightRun: boolean;
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
    planDay: 0,
    nightRunDay: 0,
    onNightRun: false,
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
  // Shop-track queue speed-up (spec V2.7, issue #83): the ONE call this
  // machine makes into helper territory — a pure read of GameState that
  // returns exactly 1 (no-op) whenever there's no helper on shop duty
  // today. Multiplied into every browsing/decision wait below; nothing
  // else here needs to know a helper exists.
  const waitSpeed = browseSpeedFactor(s);

  switch (a.state) {
    case "resting": {
      // Night owls (§13): high-risk types may slip out after dark for rarer
      // loot. Rare — roughly one night in five when eligible.
      if (
        s.phase === "night" &&
        a.nightOwl &&
        a.morale >= 50 &&
        a.hp > a.maxHp * 0.6 &&
        bc.nightRunDay !== s.day &&
        Math.random() < 0.005 * dt // ~20% chance across a whole night phase
      ) {
        bc.nightRunDay = s.day;
        bc.onNightRun = true;
        a.state = "adventuring";
        const gate = doorOf(s, "gate");
        a.position.x = gate.x;
        a.position.y = gate.y + 30;
        out.messages.push(systemMsg(s, `${a.name} slipped out of the gate into the dark...`));
        break;
      }
      // Wake at dawn: plan the day (deterministic immediately; AI may override).
      if ((s.phase === "dawn" || s.phase === "morning") && bc.planDay !== s.day) {
        beginDay(a, bc, s.day);
      }
      break;
    }

    case "wandering": {
      if ((s.phase === "dawn" || s.phase === "morning") && bc.planDay !== s.day) {
        beginDay(a, bc, s.day); // covers day 1, when nobody starts in "resting"
      }
      // Route by plan and phase.
      if (s.phase === "night") {
        headHome(a, bc, s);
        break;
      }
      // Departures wait out the wake-up stagger set in beginDay(); without the
      // timer check the stagger existed but nothing honoured it (#50).
      if (
        bc.plan === "shop" &&
        !bc.shopped &&
        bc.timer <= 0 &&
        (s.phase === "dawn" || s.phase === "morning")
      ) {
        a.state = "heading_to_shop";
        bc.target = doorOf(s, "shop");
        break;
      }
      if (bc.lootToSell.length > 0 && s.phase === "evening") {
        a.state = "returning"; // reuse the walk-to-shop-then-sell path
        bc.target = doorOf(s, "shop");
        break;
      }
      if (bc.plan === "adventure" && !bc.adventured && bc.timer <= 0 && s.phase === "afternoon") {
        a.state = "heading_to_gate";
        const gate = doorOf(s, "gate");
        bc.target = { x: gate.x, y: gate.y + 30 };
        break;
      }
      // Idle drift: pick a fresh spot each time (random is fine here — this
      // is ambience, not a §6 verdict; the old deterministic pick meant one
      // walk per day and then a statue).
      if (!bc.target && bc.timer <= 0) {
        const tavernDoor = doorOf(s, "tavern");
        const shop = anchorOf(s, "shop");
        const houses = houseAnchors(s);
        const spots = [
          anchorOf(s, "square"),
          { x: tavernDoor.x, y: tavernDoor.y + 20 },
          { x: shop.x + 60, y: shop.y + 90 },
          { x: houses[1].x + 20, y: houses[1].y - 40 },
        ];
        const p = spots[Math.floor(Math.random() * spots.length)];
        bc.target = {
          x: p.x + Math.floor(Math.random() * 100) - 50,
          y: p.y + Math.floor(Math.random() * 60) - 30,
        };
      }
      // Only an adventurer who actually had somewhere to be has "arrived".
      // walkToward() reports true when there is no target at all, so resetting
      // the linger timer unconditionally re-armed it every tick and the timer
      // never reached zero — which silently blocked the departure gates above.
      if (bc.target && walkToward(a, bc, dt)) {
        bc.target = null;
        bc.timer = 4 + Math.random() * 8; // linger, varied
      }
      break;
    }

    case "heading_to_shop": {
      if (walkToward(a, bc, dt)) {
        a.state = "browsing";
        bc.timer = browseTime(a) * waitSpeed;
        bc.browsingItem = pickShelfItem(a, s);
        a.browsingItemId = bc.browsingItem;
      }
      break;
    }

    case "browsing": {
      if (bc.timer > 0) break;
      const item = s.shelves.find((it) => it?.id === bc.browsingItem) ?? null;
      if (item && item.salePrice !== null) recordReactionSeen(s, computeReaction(a, item));
      if (item && decidesToBuy(a, item)) {
        a.state = "buying";
        bc.timer = 2.5 * waitSpeed;
      } else {
        if (item) recordReaction(a, item, out, s);
        // Careful shoppers examine a second item; others leave.
        const next = pickShelfItem(a, s, bc.browsingItem);
        if (a.personality.spendingStyle === "careful" && next) {
          bc.browsingItem = next;
          a.browsingItemId = next;
          bc.timer = browseTime(a) * waitSpeed;
        } else {
          leaveShop(a, bc, s);
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
      leaveShop(a, bc, s);
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
      // Resolve at evening — or at dawn for night runs. Deterministic
      // outcome roll (§8); the engine attaches AI narration async.
      const resolveNow = bc.onNightRun
        ? s.phase === "dawn" || s.phase === "morning"
        : s.phase === "evening" || s.phase === "night";
      if (resolveNow) {
        // v2 (spec V2.5/V2.6, issue #76): the day's party marched as one
        // AdventureScript, generated once at the afternoon-phase boundary
        // (GameEngine.formAfternoonParty) — facts are final from that
        // moment, this just reads this member's slice of it. A straggler
        // whose plan flipped to "adventure" after the party already formed
        // (a late AI override) falls back to solo resolveAdventure() so a
        // missed party bus never blocks anyone (§7: AI is never
        // load-bearing). Night runs generate their own small solo script,
        // resolved at dawn exactly as v1 resolved solo adventures.
        const outcome = bc.onNightRun
          ? resolveNightRun(a, s.day)
          : (findScriptOutcome(s, a.id) ?? resolveAdventure(a, s.day, {}));
        bc.onNightRun = false;
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

        a.gold += outcome.goldFound;
        // Loot into inventory; remember what's for sale. Materialized with
        // the rarity/enchantments rolled at script generation (spec V2.9,
        // issue #90) — origin "loot" (durability ×0.7, spec V2.9 split).
        for (const roll of outcome.lootRolls) {
          const item = makeItem(roll.key, { rarity: roll.rarity, enchantments: roll.enchantments, origin: "loot" });
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
        bc.target = bc.lootToSell.length > 0 ? doorOf(s, "shop") : anchorOf(s, "square");
        const gate = doorOf(s, "gate");
        a.position.x = gate.x;
        a.position.y = gate.y + 30;
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
      if (s.phase === "night") {
        // The shop day is over; whatever wasn't sold gets offered again
        // tomorrow evening (nothing strands in the seller's pack). A still-
        // open offer is withdrawn and its item re-queued.
        if (bc.pendingOfferId) {
          const openIdx = s.lootOffers.findIndex((o) => o.id === bc.pendingOfferId);
          if (openIdx !== -1) {
            bc.lootToSell.unshift(s.lootOffers[openIdx].item.id);
            s.lootOffers.splice(openIdx, 1);
          }
          bc.pendingOfferId = null;
        }
        a.state = "wandering";
        break;
      }
      const nextId = bc.lootToSell.shift();
      const item = nextId ? a.inventory.find((it) => it.id === nextId) : undefined;
      if (item) {
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
    headHome(a, bc, s);
    if (walkToward(a, bc, dt)) a.state = "resting";
  }

  return out;
}

// ---------- day start ----------

function beginDay(a: Adventurer, bc: BehaviorContext, day: number): void {
  bc.planDay = day;
  a.hp = Math.min(a.maxHp, a.hp + 10); // overnight recovery
  bc.plan = fallbackMorningPlan(a);
  bc.shopped = false;
  bc.adventured = false;
  a.daysSinceLastAdventure += 1;
  a.memory.daysInTown += 1;
  a.state = "wandering";
  // Stagger the morning: without a real spread everyone wakes, walks and shops
  // in lockstep, which reads as six copies of one adventurer (#50). Random is
  // right here — this is ambience, not a §6 verdict.
  //
  // 20-60 game-seconds rather than the 5-40 sketched in the issue: the point of
  // starting at dawn is to give the player a setup window, and a 5s floor only
  // guarantees five seconds of it. A 20s floor leaves most of dawn free, and a
  // 60s ceiling still puts every departure early in the morning (which runs to
  // ~210s), so nobody misses their shop trip.
  bc.timer = 20 + Math.random() * 40;
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
      if (it.quality > equippedQuality(a, it)) score += 10;
      if (a.personality.preferredItems.includes(it.category)) score += 5;
      if (it.category === "consumable") score += 2;
      score -= (it.salePrice ?? 0) / 100;
      return { it, score };
    })
    .sort((x, y) => y.score - x.score);
  return scored[0].it.id;
}

function leaveShop(a: Adventurer, bc: BehaviorContext, s: GameState): void {
  a.state = "wandering";
  bc.shopped = true;
  bc.browsingItem = null;
  a.browsingItemId = null;
  // Scatter across the square instead of everyone converging on one pixel and
  // standing in each other (#50).
  const square = anchorOf(s, "square");
  bc.target = {
    x: square.x + Math.floor(Math.random() * 120) - 60,
    y: square.y + Math.floor(Math.random() * 80) - 20,
  };
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
  recordSale(s, item, price);
  s.lastSalePriceByName[item.name] = price; // a sale proves the price clears
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
    recordWalkout(s);
    a.relationships.shopkeeper = Math.max(-100, a.relationships.shopkeeper - 2);
    a.morale = Math.max(0, a.morale - 2); // being priced out is demoralizing (§14)
    out.messages.push(systemMsg(s, `${a.name} scoffed at the price of ${item.name} and walked out.`));
  }
}

// ---------- movement ----------

function headHome(a: Adventurer, bc: BehaviorContext, s: GameState): void {
  const houses = houseAnchors(s);
  const home = houses[a.appearance.skin % houses.length];
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

// ---------- v2 AdventureScript wiring (issue #76) ----------

/** This member's slice of today's party script, if the party already
 *  formed and included them. */
function findScriptOutcome(s: GameState, adventurerId: string): AdventureOutcome | null {
  return s.currentScript?.memberOutcomes.find((o) => o.adventurerId === adventurerId) ?? null;
}

/** A night owl's solo run: its own tiny AdventureScript (party of one,
 *  night: true), generated and resolved in the same beat — "resolved at
 *  dawn as today" (spec V2.6). Not stored on state.currentScript, which is
 *  reserved for the day's one afternoon party; the seed is drawn fresh here
 *  (liveliness) and stored on the throwaway script for replay parity with
 *  the party path, even though nothing persists it today. */
function resolveNightRun(a: Adventurer, day: number): AdventureOutcome {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const script = generateAdventureScript([a], day, { night: true, seed }, makeRng(seed));
  return script.memberOutcomes[0];
}

// ---------- misc ----------

function areaName(area: "forest_edge" | "shadow_cave"): string {
  return area === "forest_edge" ? "Forest Edge" : "Shadow Cave";
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
