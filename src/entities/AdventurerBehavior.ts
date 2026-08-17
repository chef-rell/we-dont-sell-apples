// Behavior state machine (spec §7): deterministic movement and state
// transitions driven by timers, day phase, and the adventurer's daily plan.
// Never calls the API — AI decisions arrive asynchronously and steer the
// plan; the machine acts immediately on deterministic logic either way.

import type { Adventurer, AdventureOutcome, ChatMessage, GameState, Item } from "../types";
import { computeReaction, decidesToBuy, classifyPrice, equippedQuality } from "../game/Economy";
import { recordReactionSeen, recordRepairRevenue, recordSale, recordWalkout } from "../game/Ledger";
import { resolveAdventure, generateAdventureScript, fallbackAskPrice } from "../game/Combat";
import { makeRng } from "../utils/rng";
import { makeItem } from "./Item";
import { browseSpeedFactor } from "./Helper";
import { fallbackMorningPlan, type DayPlan } from "./AdventurerFallback";
import { getBuilding } from "../utils/TownBuildings";
import { planRepairErrand, resolveRepairErrand } from "../game/Property";
import { chooseCompetitorStore, resolveCompetitorPurchase } from "../game/Competition";
import { COMPETITOR_NOTHING_AFFORDABLE_TRIGGER } from "../utils/constants";

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
  /** Set when this morning's errand is a forge repair trip instead of a
   *  shop trip (spec V2.9, issue #91) — which equipped slot is being
   *  repaired. Reuses the "heading_to_shop"/"browsing" states with the
   *  target swapped to the forge's door; cleared on arrival either way. */
  repairSlot: "weapon" | "armor" | null;
  // ---- spec V2.10, issue #94 (competitor stores — engine-only, not persisted) ----
  /** True the moment an "angry" reaction fires during THIS shop trip;
   *  consulted (and cleared) by leaveShop(). Reset early if a later item in
   *  the same trip is actually bought (a careful shopper's second look). */
  angryThisTrip: boolean;
  /** Consecutive shop trips (across days) that ended with nothing on the
   *  shelves this adventurer could afford — 2+ redirects to a competitor
   *  (spec V2.10). Persists across days; resets to 0 the moment a trip DOES
   *  find something affordable. */
  nothingAffordableStreak: number;
  /** Competitor store id this "wandering" walk is headed to, if any — set
   *  by leaveShop()'s redirect, consumed (and cleared) on arrival by the
   *  same generic "arrived at target" branch every other wander-target
   *  uses. Null the rest of the time. */
  competitorVisit: string | null;
  /** One-shot per evening: true once this adventurer's evening idle-drift
   *  has already routed them past the tavern (spec V2.9/Phase-2 deferral's
   *  "night owls gather at the tavern before slipping out"); reset at the
   *  next beginDay(). Only ever set for `a.nightOwl` adventurers. */
  eveningTavernVisited: boolean;
  /** True while the current bc.target is the arrival-day graveyard detour
   *  beginDay() set (spec V2.9, issue #94) — tells the generic "arrived at
   *  target" branch NOT to overwrite bc.timer with the short idle-linger
   *  value, which would cut the morning wake-up stagger short. Cleared the
   *  moment that arrival is handled. */
  graveyardWaypoint: boolean;
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
    repairSlot: null,
    angryThisTrip: false,
    nothingAffordableStreak: 0,
    competitorVisit: null,
    eveningTavernVisited: false,
    graveyardWaypoint: false,
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
        beginDay(a, bc, s, out);
      }
      break;
    }

    case "wandering": {
      if ((s.phase === "dawn" || s.phase === "morning") && bc.planDay !== s.day) {
        beginDay(a, bc, s, out); // covers day 1, when nobody starts in "resting"
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
        // Repair-vs-rebuy (spec V2.9, issue #91): a deterministic,
        // §6-untouched decision (4a's prefersRepair) — when it fires, this
        // morning's shop trip goes to the forge instead of a shelf. When
        // it doesn't (no forge, gear's fine, no material in stock), this
        // is byte-identical to the pre-#91 shop trip below.
        const repair = planRepairErrand(a, s);
        a.state = "heading_to_shop";
        if (repair) {
          bc.target = doorOf(s, "forge");
          bc.repairSlot = repair.slot;
        } else {
          bc.target = doorOf(s, "shop");
        }
        break;
      }
      if (bc.lootToSell.length > 0 && s.phase === "evening") {
        a.state = "returning"; // reuse the walk-to-shop-then-sell path
        bc.target = doorOf(s, "shop");
        break;
      }
      // Storm days are shop days (spec V2.9, issue #94): no party forms
      // (GameEngine.formAfternoonParty already returns early), and nobody
      // even sets out for the gate — they shop/tavern instead, same as any
      // other day their plan wasn't "adventure".
      if (
        bc.plan === "adventure" &&
        !bc.adventured &&
        bc.timer <= 0 &&
        s.phase === "afternoon" &&
        s.weather !== "storm"
      ) {
        a.state = "heading_to_gate";
        const gate = doorOf(s, "gate");
        bc.target = { x: gate.x, y: gate.y + 30 };
        break;
      }
      // Idle drift: pick a fresh spot each time (random is fine here — this
      // is ambience, not a §6 verdict; the old deterministic pick meant one
      // walk per day and then a statue).
      if (!bc.target && bc.timer <= 0) {
        // Night-raid tavern beat (spec V2.9/Phase-2 deferral, issue #94):
        // night owls gather at the tavern during evening, once, before the
        // night-curfew walk-home (and possibly a slip-out) takes over —
        // reuses the existing idle-drift target/arrival machinery, no new
        // state. Gated on `nightOwl` alone (not the slip-out's own morale/HP
        // gate below) — this is atmosphere for every night owl, not a
        // promise they'll actually go out tonight.
        if (s.phase === "evening" && a.nightOwl && !bc.eveningTavernVisited) {
          bc.eveningTavernVisited = true;
          const tavernDoor = doorOf(s, "tavern");
          bc.target = { x: tavernDoor.x, y: tavernDoor.y + 20 };
          out.messages.push(adventurerMsg(s, a, "One more round, then the cave."));
        } else {
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
      }
      // Only an adventurer who actually had somewhere to be has "arrived".
      // walkToward() reports true when there is no target at all, so resetting
      // the linger timer unconditionally re-armed it every tick and the timer
      // never reached zero — which silently blocked the departure gates above.
      if (bc.target && walkToward(a, bc, dt)) {
        // Competitor purchase (spec V2.10, issue #94): arrived at the store
        // leaveShop() redirected this walk to — resolve the transaction now,
        // exactly once, then fall through to the same idle reset as every
        // other wander-target arrival.
        if (bc.competitorVisit) {
          const storeId = bc.competitorVisit;
          bc.competitorVisit = null;
          const result = resolveCompetitorPurchase(a, s, storeId);
          if (result) {
            const store = s.competitors.find((c) => c.id === storeId);
            out.messages.push(
              adventurerMsg(
                s,
                a,
                `Fine, ${store?.name ?? "the other place"} it is. ${result.price}g and I'm out.`,
              ),
            );
          }
        }
        bc.target = null;
        if (bc.graveyardWaypoint) {
          // Newcomer graveyard detour (spec V2.9, issue #94): arriving here
          // must NOT shorten bc.timer — it's still counting down the
          // wake-up stagger beginDay() set (20-60s, #50's fix), and this
          // walk started well before that timer's floor. Overwriting it
          // with the short idle-linger value below would let this one
          // adventurer's shop/adventure departure jump the stagger queue.
          bc.graveyardWaypoint = false;
        } else {
          bc.timer = 4 + Math.random() * 8; // linger, varied
        }
      }
      break;
    }

    case "heading_to_shop": {
      if (walkToward(a, bc, dt)) {
        if (bc.repairSlot) {
          // Forge repair errand (spec V2.9, issue #91): pay the player,
          // consume one player-stock material, apply 4a's applyRepair —
          // then leave WITHOUT touching the shop's browse/buy path at all
          // (the issue's "skip buying"). A material race with another
          // adventurer (resolveRepairErrand returns 0) just means this
          // trip converts to nothing, same as any other browse that didn't
          // convert.
          const cost = resolveRepairErrand(a, s, bc.repairSlot);
          if (cost > 0) {
            recordRepairRevenue(s, cost);
            out.messages.push(systemMsg(s, `${a.name} had their gear repaired at the forge for ${cost}g.`));
          }
          bc.repairSlot = null;
          leaveShop(a, bc, s, out, { checkCompetitor: false }); // a repair trip never touched the shelves
          break;
        }
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
        if (item) recordReaction(a, item, out, s, bc);
        // Careful shoppers examine a second item; others leave.
        const next = pickShelfItem(a, s, bc.browsingItem);
        if (a.personality.spendingStyle === "careful" && next) {
          bc.browsingItem = next;
          a.browsingItemId = next;
          bc.timer = browseTime(a) * waitSpeed;
        } else {
          leaveShop(a, bc, s, out);
        }
      }
      break;
    }

    case "buying": {
      if (bc.timer > 0) break;
      const idx = s.shelves.findIndex((it) => it?.id === bc.browsingItem);
      const item = idx >= 0 ? s.shelves[idx] : null;
      let bought = false;
      if (item && item.salePrice !== null && item.salePrice <= a.gold) {
        completePurchase(a, item, idx, s, out);
        bought = true;
      }
      leaveShop(a, bc, s, out, { boughtThisTrip: bought });
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
          ? resolveNightRun(a, s)
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

function beginDay(a: Adventurer, bc: BehaviorContext, s: GameState, out: StepResult): void {
  bc.planDay = s.day;
  // Arrival day (spec V2.9, issue #94): daysInTown is still 0 the FIRST time
  // beginDay ever runs for this adventurer — true for the starting cast on
  // day 1 and for every later replacement wave alike (memory.daysInTown is
  // part of the saved contract, so this reads correctly even across a
  // reload that resets BehaviorContext to fresh). Checked before the
  // increment just below.
  const isArrivalDay = a.memory.daysInTown === 0;
  a.hp = Math.min(a.maxHp, a.hp + 10); // overnight recovery
  bc.plan = fallbackMorningPlan(a);
  bc.shopped = false;
  bc.adventured = false;
  bc.eveningTavernVisited = false;
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
  // Newcomer graveyard waypoint (spec V2.9, issue #94): one-time detour
  // inserted into the arrival-day walk, reusing "wandering"'s existing
  // target/arrival machinery — no new state. Overrides nothing else this
  // trip since bc.target is otherwise unset at this point in beginDay().
  if (isArrivalDay) {
    bc.target = doorOf(s, "graveyard");
    bc.graveyardWaypoint = true;
    out.messages.push(adventurerMsg(s, a, "New in town. Figured I'd pay my respects first — read a few of the names."));
  }
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

/** True when at least one shelved, priced item is within this adventurer's
 *  current gold — the affordability half of the competitor-redirect trigger
 *  (spec V2.10, issue #94). A bare/unpriced shelf also reads as "nothing
 *  affordable" (nothing there to buy at all). */
function hasAffordablePricedItem(a: Adventurer, s: GameState): boolean {
  return s.shelves.some((it) => it !== null && it.salePrice !== null && it.salePrice <= a.gold);
}

function leaveShop(
  a: Adventurer,
  bc: BehaviorContext,
  s: GameState,
  out: StepResult,
  opts: { checkCompetitor?: boolean; boughtThisTrip?: boolean } = {},
): void {
  a.state = "wandering";
  bc.shopped = true;
  bc.browsingItem = null;
  a.browsingItemId = null;

  // Competitor redirect (spec V2.10, issue #94): an angry walkout THIS
  // trip, or a second-or-later consecutive day finding nothing on the
  // shelves they could afford, sends them to a rival store instead of
  // drifting the square. `opts.checkCompetitor === false` skips this
  // entirely for a repair errand, which never touched the shelves at all.
  const checkCompetitor = opts.checkCompetitor !== false;
  if (checkCompetitor) {
    if (opts.boughtThisTrip) {
      // They just bought something — trivially "found something
      // affordable" this trip. Checked BEFORE rescanning the shelf: the
      // item they bought is already gone from it by this point, so a
      // fresh scan could wrongly read as "nothing affordable" even though
      // they just walked out with a purchase.
      bc.nothingAffordableStreak = 0;
      bc.angryThisTrip = false; // an earlier angry look this trip doesn't matter now
    } else {
      const affordable = hasAffordablePricedItem(a, s);
      bc.nothingAffordableStreak = affordable ? 0 : bc.nothingAffordableStreak + 1;
      const triggered = bc.angryThisTrip || bc.nothingAffordableStreak >= COMPETITOR_NOTHING_AFFORDABLE_TRIGGER;
      bc.angryThisTrip = false;
      if (triggered) {
        const storeId = chooseCompetitorStore(a, s);
        if (storeId) {
          const store = s.competitors.find((c) => c.id === storeId);
          bc.competitorVisit = storeId;
          bc.target = doorOf(s, storeId);
          out.messages.push(
            adventurerMsg(s, a, `Not paying THAT here. ${store?.name ?? "Somewhere else"} will do.`),
          );
          return;
        }
      }
    }
  }

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

function recordReaction(a: Adventurer, item: Item, out: StepResult, s: GameState, bc: BehaviorContext): void {
  const r = computeReaction(a, item);
  if (r === "angry") {
    recordWalkout(s);
    a.relationships.shopkeeper = Math.max(-100, a.relationships.shopkeeper - 2);
    a.morale = Math.max(0, a.morale - 2); // being priced out is demoralizing (§14)
    bc.angryThisTrip = true; // spec V2.10, issue #94: leaveShop() reads this for the competitor redirect
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
 *  the party path.
 *
 *  spec V2.9/Phase-2 deferral, issue #94: this IS "where night runs
 *  generate today" — the script is now also written to `s.nightScript` so
 *  the strip (Phase 5b) has something to play back. GameEngine.tick's
 *  `dayRolled` guard clears the field BEFORE this function can run each
 *  day (see that comment for the full ordering reasoning), so a script
 *  written here survives the entire day that follows. Reads `s.weather`
 *  into the same threat multiplier the afternoon party gets. */
function resolveNightRun(a: Adventurer, s: GameState): AdventureOutcome {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const script = generateAdventureScript([a], s.day, { night: true, seed, weather: s.weather }, makeRng(seed));
  s.nightScript = script;
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

/** An adventurer-voiced flavor line (spoken in first person, matching
 *  TownChat.ts's fallbackChatter style) — deterministic text; a fully
 *  functional fallback, no async AI call from this module (§7: AI is never
 *  load-bearing, and every other AI hook in this codebase is orchestrated
 *  from GameEngine, not from here). Used for the competitor-redirect,
 *  graveyard-waypoint, and evening-tavern flavor beats (spec V2.9/V2.10,
 *  issue #94). */
function adventurerMsg(s: GameState, a: Adventurer, content: string): ChatMessage {
  return {
    id: `chat-${s.day}-${a.id}-${msgCounter++}`,
    senderId: a.id,
    senderName: a.name,
    type: "ambient",
    content,
    timestamp: s.timeOfDay,
    day: s.day,
  };
}
