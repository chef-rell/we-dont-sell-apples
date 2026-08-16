// Deterministic decision fallback (spec §7). The game MUST be fully playable
// with zero API calls — this module is the floor the AI decorates, and it gets
// the same design attention (§7 DESIGN PRIORITY).

import type { Adventurer } from "../types";

export type DayPlan = "shop" | "adventure" | "rest";

/**
 * Morning planning without AI. Personality-driven formula:
 * hurt or exhausted → rest; itchy feet + risk appetite → adventure;
 * gold burning a hole + gear gaps → shop first.
 */
export function fallbackMorningPlan(a: Adventurer): DayPlan {
  // Health first: under half HP, cautious types rest, brave ones still shop.
  if (a.hp < a.maxHp * 0.4) return "rest";
  if (a.hp < a.maxHp * 0.7 && a.personality.riskTolerance < 50) return "rest";

  // Low morale saps the will to head out (§14).
  if (a.morale < 30) return a.gold > 40 ? "shop" : "rest";

  // Restlessness builds with days in town; risk tolerance lowers the bar.
  const restless = a.daysSinceLastAdventure * 25 + a.personality.riskTolerance;
  const gearScore =
    (a.equipment.weapon?.quality ?? 0) + (a.equipment.armor?.quality ?? 0);

  // Poorly equipped adventurers with spending money shop before adventuring.
  if (gearScore < 4 && a.gold >= 25) return "shop";

  if (restless >= 90) return "adventure";
  return a.gold >= 25 ? "shop" : "rest";
}

/** Deterministic one-line flavor when AI text is unavailable. Rotates by day. */
export function fallbackFlavor(a: Adventurer, plan: DayPlan, day: number): string {
  const lines: Record<DayPlan, string[]> = {
    shop: [
      `${a.name} eyes the shop's shelves on the way past.`,
      `${a.name} counts their coin and heads for the shop.`,
    ],
    adventure: [
      `${a.name} tightens their straps and looks toward the gate.`,
      `${a.name} is itching for a fight today.`,
    ],
    rest: [
      `${a.name} lingers near the tavern, in no hurry today.`,
      `${a.name} takes a slow morning.`,
    ],
  };
  const pool = lines[plan];
  return pool[day % pool.length];
}
