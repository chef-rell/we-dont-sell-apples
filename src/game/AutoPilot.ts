// Shopkeeper auto-pilot (spec §13): learns the player's pricing style from
// pricingHistory and can run the shop without them. Implemented as the spec's
// §13 implementation note demands: an explicit heuristic — average markup per
// category plus a stubbornness read — not fake sophistication. confidenceScore
// reflects data quantity, nothing more.

import type { GameState, Item, ItemCategory, PriceRecord } from "../types";

export interface AutoPilotProfile {
  averageMarkup: Partial<Record<ItemCategory, number>>;
  overallMarkup: number; // fallback for categories with no history
  confidenceScore: number; // 0-100, purely from data quantity
  samples: number;
}

const DEFAULT_MARKUP = 1.2; // sensible-but-modest when there is no history at all
const MIN_SAMPLES_FULL_CONFIDENCE = 15; // ~3-5 days of play (§13)

/** Build the pricing profile from recorded history. Pure function. */
export function inferProfile(history: PriceRecord[]): AutoPilotProfile {
  if (history.length === 0) {
    return { averageMarkup: {}, overallMarkup: DEFAULT_MARKUP, confidenceScore: 0, samples: 0 };
  }
  // Recent decisions matter more than early fumbling: weight the last 50.
  const recent = history.slice(-50);
  const byCategory = new Map<ItemCategory, number[]>();
  for (const r of recent) {
    const list = byCategory.get(r.itemCategory) ?? [];
    list.push(r.markupRatio);
    byCategory.set(r.itemCategory, list);
  }
  const averageMarkup: Partial<Record<ItemCategory, number>> = {};
  for (const [cat, ratios] of byCategory) {
    averageMarkup[cat] = round2(avg(ratios));
  }
  return {
    averageMarkup,
    overallMarkup: round2(avg(recent.map((r) => r.markupRatio))),
    confidenceScore: Math.min(100, Math.round((recent.length / MIN_SAMPLES_FULL_CONFIDENCE) * 100)),
    samples: recent.length,
  };
}

/** Price one item the way the player would. */
export function autoPrice(profile: AutoPilotProfile, item: Item): number {
  const markup = profile.averageMarkup[item.category] ?? profile.overallMarkup;
  return Math.max(1, Math.round(item.baseValue * markup));
}

/** Price everything unpriced on the shelves (used by the offline sim, or a
 *  live auto-pilot toggle). Routes through the same salePrice field the
 *  player uses; deliberately does NOT record into pricingHistory — the
 *  auto-pilot must not learn from itself. */
export function autoPriceShelves(state: GameState, profile: AutoPilotProfile): number {
  let priced = 0;
  for (const item of state.shelves) {
    if (item && item.salePrice === null) {
      item.salePrice = autoPrice(profile, item);
      priced++;
    }
  }
  return priced;
}

/** Human-readable style summary for the settings screen (§13). */
export function describeProfile(profile: AutoPilotProfile): string {
  if (profile.samples === 0) {
    return "Your shopkeeper hasn't learned your style yet — set some prices.";
  }
  const parts = Object.entries(profile.averageMarkup)
    .map(([cat, m]) => `${cat}s ${m}×`)
    .join(", ");
  return `Your shopkeeper marks up ${parts || `everything ${profile.overallMarkup}×`} (confidence ${profile.confidenceScore}%).`;
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
