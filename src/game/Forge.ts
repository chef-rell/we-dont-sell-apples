// Repair math (spec V2.9, issue #90). Pure functions only — no state, no
// engine wiring; the forge SERVICE (consuming a monster-material from
// inventory, actually calling these from a UI/engine action) is Phase 4b's
// job. These are unit-testable in isolation, Economy.ts-style: deterministic
// given their inputs, no I/O, no randomness.

import type { Adventurer, Item } from "../types";
import {
  PREFERS_REPAIR_REPLACEMENT_RATIO,
  REPAIR_COST_RATIO,
  REPAIR_DURABILITY_DECAY,
  REPAIR_MAX_TIMES,
} from "../utils/constants";

/** Gold cost to repair `item` right now: 35% of its CURRENT baseValue
 *  (spec V2.9). baseValue already carries rarity/enchantment multipliers
 *  (Item.ts's applyRarity) and never changes across repairs, so a
 *  legendary's repair costs proportionally more than a common's — same as
 *  buying one costs more. */
export function repairCost(item: Item): number {
  return Math.round(REPAIR_COST_RATIO * item.baseValue);
}

/** Whether `item` is eligible for another repair: must be gear (durability
 *  tracked at all), below its own max (nothing to restore otherwise), and
 *  under the repair cap (`timesRepaired < 3`, spec V2.9 — never remove this
 *  cap, per CLAUDE.md V2.9 guidance, so a piece of gear can't be repaired
 *  into forever-serviceable). */
export function canRepair(item: Item): boolean {
  if (item.durability === null || item.maxDurability === null) return false;
  if (item.timesRepaired >= REPAIR_MAX_TIMES) return false;
  return item.durability < item.maxDurability;
}

/** Repairs `item`: durability restored to (a shrunken) full, `maxDurability`
 *  reduced ~15% (spec V2.9 — each repair leaves the piece a little more
 *  fragile than before), `timesRepaired` incremented. Returns a NEW item
 *  object (does not mutate the input) — the caller (4b's forge service)
 *  decides how to write it back into whatever collection holds it.
 *  Does NOT check `canRepair` or consume a material itself — pure item
 *  math only; the service wraps this with the cap check and the
 *  monster-material consumption (spec V2.9: "consumes one monster-material,
 *  the existing loot-category drops"). */
export function applyRepair(item: Item): Item {
  const maxDurability = item.maxDurability === null
    ? null
    : Math.round(item.maxDurability * (1 - REPAIR_DURABILITY_DECAY));
  return {
    ...item,
    maxDurability,
    durability: maxDurability,
    timesRepaired: item.timesRepaired + 1,
  };
}

/**
 * Deterministic repair-vs-rebuy decision (spec V2.9: "a pure function in
 * the Economy.ts style"). An adventurer prefers repairing over replacing
 * iff: a forge exists to do it, the repair is comfortably cheaper than
 * replacing (repairCost < 45% of the item's baseValue — the cost of
 * buying/looting an equivalent fresh item), and the repair cap isn't hit.
 *
 * Judgment call: with repairCost fixed at exactly 35% of baseValue
 * (REPAIR_COST_RATIO) and "replacement value" read as that SAME baseValue,
 * the 45% check is always true today (0.35 < 0.45) — it's a guardrail for
 * future tuning (e.g. per-item repair-cost variance) rather than a live
 * gate under current numbers. Computed generically (not hardcoded) so it
 * keeps working correctly if either ratio changes later.
 */
export function prefersRepair(_a: Adventurer, item: Item, forgeAvailable: boolean): boolean {
  if (!forgeAvailable) return false;
  if (!canRepair(item)) return false;
  return repairCost(item) < PREFERS_REPAIR_REPLACEMENT_RATIO * item.baseValue;
}
