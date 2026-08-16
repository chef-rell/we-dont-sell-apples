// Morale, loyalty, and social dynamics (spec §14). Processed once per day at
// the rollover. Everything here is deterministic-with-bounded-randomness and
// feeds the same fields the §6 tolerance math already reads — morale and
// loyalty aren't parallel systems, they're inputs to the one that exists.

import type { Adventurer, ChatMessage, GameState } from "../types";

export const REGULAR_LOYALTY = 75; // at/above this, an adventurer is a "regular"
const LOW_MORALE = 30;
const DAYS_BEFORE_LEAVING = 4;
const MORALE_DRIFT_TARGET = 55; // morale slowly relaxes toward mildly content

export interface DayEndResult {
  departed: Adventurer[];
  messages: ChatMessage[];
  /** Shop reputation for the day in [-1, 1]; feeds arrival speed (§14). */
  reputation: number;
}

/** Is this adventurer a regular (§14)? Regulars shop first and forgive spikes
 *  (the §6 loyalty shift already handles the forgiveness half). */
export function isRegular(a: Adventurer): boolean {
  return a.loyalty >= REGULAR_LOYALTY;
}

/**
 * End-of-day social pass:
 * - morale drifts gently toward a neutral resting point
 * - consecutive low-morale days are tracked; too many → the adventurer leaves
 * - the day's treatment of customers spreads through the tavern (§14):
 *   everyone's relationship with the shopkeeper moves a little toward how
 *   the town as a whole was treated
 */
export function processDayEnd(s: GameState): DayEndResult {
  const alive = s.adventurers.filter((a) => a.alive);
  const messages: ChatMessage[] = [];
  const departed: Adventurer[] = [];

  // --- Reputation: the town's average read on the shopkeeper. Relationships
  // already move on every fair purchase, every ripoff, and every angry
  // walkout — so this one number captures gouging even when nobody buys.
  const reputation =
    alive.length === 0
      ? 0
      : alive.reduce((n, a) => n + a.relationships.shopkeeper, 0) / alive.length / 100;

  for (const a of alive) {
    // --- Drift toward the resting point (life goes on).
    if (a.morale < MORALE_DRIFT_TARGET) a.morale = Math.min(MORALE_DRIFT_TARGET, a.morale + 3);
    else if (a.morale > MORALE_DRIFT_TARGET) a.morale = Math.max(MORALE_DRIFT_TARGET, a.morale - 1);

    // --- Living in a town with a resented shop wears people down (§14):
    // sustained bad reputation beats the drift and can drive departures.
    if (reputation < -0.2) {
      a.morale = Math.max(0, a.morale + Math.round(reputation * 8)); // -2..-8/day
    }

    // --- Tavern talk: reputation nudges everyone's read on the shopkeeper.
    // ×4 so even one burned (or delighted) customer registers on bystanders.
    a.relationships.shopkeeper = clamp(
      a.relationships.shopkeeper + Math.round(reputation * 4),
      -100,
      100,
    );

    // --- Low-morale tracking and departure (§14).
    if (a.morale < LOW_MORALE) {
      a.memory.lowMoraleDays += 1;
      if (a.memory.lowMoraleDays >= DAYS_BEFORE_LEAVING) {
        a.alive = false; // gone from the simulation; not dead, but gone
        a.state = "dead"; // reuse the terminal state; the leaving is the story
        departed.push(a);
        messages.push(sysMsg(s, `${a.name} packed up and left town. Word is they'd had enough.`));
        continue;
      }
      if (a.memory.lowMoraleDays === DAYS_BEFORE_LEAVING - 1) {
        messages.push(sysMsg(s, `${a.name} has been talking about moving on...`));
      }
    } else {
      a.memory.lowMoraleDays = 0;
    }

    // --- Becoming a regular is worth announcing once.
    if (a.loyalty >= REGULAR_LOYALTY && a.memory.favoriteItem === null) {
      a.memory.favoriteItem = "shop"; // sentinel: crossed the regular line
      messages.push(sysMsg(s, `${a.name} has become a regular at your shop.`));
    }
  }

  return { departed, messages, reputation };
}

/** Arrival speed-up from reputation (§14): a well-regarded shop attracts
 *  newcomers faster. Returns days to shave off the replacement wait (0-2). */
export function arrivalBonus(reputation: number): number {
  if (reputation > 0.6) return 2;
  if (reputation > 0.2) return 1;
  return 0;
}

function sysMsg(s: GameState, content: string): ChatMessage {
  return {
    id: `morale-${s.day}-${Math.floor(Math.random() * 1e9)}`,
    senderId: "system",
    senderName: "Town",
    type: "system",
    content,
    timestamp: s.timeOfDay,
    day: s.day,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
