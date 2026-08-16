// Pricing math and transactions (spec §5, §6).
//
// THE CRITICAL RULE (§6): reactions and buy/pass verdicts are DETERMINISTIC.
// Baseline thresholds come from the markup bands; personality, morale,
// loyalty, and need shift them by a bounded ±15%. Same adventurer in the
// same state → same verdict, always. The AI writes flavor, never verdicts.

import type { Adventurer, Item, Reaction } from "../types";
import { REACTION_BANDS, REACTION_SHIFT_MAX } from "../utils/constants";

/**
 * Per-adventurer threshold shift as a multiplier in [1 - 0.15, 1 + 0.15].
 * Positive shift = more tolerant (thresholds move up).
 * Deterministic: a pure function of the adventurer's current state.
 */
export function toleranceShift(a: Adventurer, item: Item): number {
  let shift = 0;

  // Spending style: frugal buyers are strict, generous ones forgiving.
  const styleShift = { frugal: -0.06, careful: -0.03, impulsive: 0.03, generous: 0.06 } as const;
  shift += styleShift[a.personality.spendingStyle];

  // Loyalty and relationship: a trusted shop earns slack (up to +0.05).
  shift += ((a.loyalty - 50) / 50) * 0.03;
  shift += (a.relationships.shopkeeper / 100) * 0.02;

  // Morale: confident adventurers spend more freely (up to ±0.03).
  shift += ((a.morale - 50) / 50) * 0.03;

  // Need: they'll stretch for a real upgrade over their current gear.
  const current = equippedQuality(a, item);
  if (item.quality > current + 1) shift += 0.04;
  else if (item.quality <= current) shift -= 0.04;

  // Wealth: can't stretch for what you can't afford, regardless of mood.
  if (item.salePrice !== null && item.salePrice > a.gold * 0.8) shift -= 0.05;

  return clamp(shift, -REACTION_SHIFT_MAX, REACTION_SHIFT_MAX);
}

function equippedQuality(a: Adventurer, item: Item): number {
  const slot =
    item.category === "weapon" ? a.equipment.weapon
    : item.category === "armor" ? a.equipment.armor
    : item.category === "accessory" ? a.equipment.accessory
    : undefined;
  return slot?.quality ?? 0;
}

/** Deterministic reaction to a priced item (§6). Unpriced items read as neutral. */
export function computeReaction(a: Adventurer, item: Item): Reaction {
  if (item.salePrice === null) return "neutral";
  const markup = item.salePrice / item.baseValue;
  const m = 1 + toleranceShift(a, item);
  if (markup <= REACTION_BANDS.happyMax * m) return "happy";
  if (markup <= REACTION_BANDS.neutralMax * m) return "neutral";
  if (markup <= REACTION_BANDS.unhappyMax * m) return "unhappy";
  return "angry";
}

/**
 * Buy/pass verdict. Deterministic given the adventurer's state:
 * happy always buys (if affordable); neutral buys when they need the item;
 * unhappy buys only when desperate (no gear in slot) AND wealthy; angry never.
 */
export function decidesToBuy(a: Adventurer, item: Item): boolean {
  if (item.salePrice === null || item.salePrice > a.gold) return false;
  const reaction = computeReaction(a, item);
  const needs = item.quality > equippedQuality(a, item);
  const wantsCategory =
    a.personality.preferredItems.length === 0 ||
    a.personality.preferredItems.includes(item.category);
  switch (reaction) {
    case "happy":
      return needs || item.category === "consumable" ? true : wantsCategory;
    case "neutral":
      return needs && wantsCategory;
    case "unhappy":
      return needs && equippedQuality(a, item) === 0 && a.gold >= item.salePrice * 3;
    case "angry":
      return false;
  }
}

/** Fairness classification used for memory/relationship updates. */
export function classifyPrice(item: Item): "fair" | "steep" | "ripoff" {
  if (item.salePrice === null) return "fair";
  const markup = item.salePrice / item.baseValue;
  if (markup <= REACTION_BANDS.happyMax) return "fair";
  if (markup <= REACTION_BANDS.neutralMax) return "steep";
  return "ripoff";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
