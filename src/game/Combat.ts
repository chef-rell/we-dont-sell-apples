// Combat resolution (spec §8): step one of the two-step design. A
// deterministic-with-bounded-randomness outcome roll using monster stats vs
// adventurer stats. Produces concrete results the AI narrates (step two) and
// the Wilderness View animates. Neither can alter what's decided here.

import type { Adventurer, AdventureOutcome, WildernessArea } from "../types";
import { encounterFor, type MonsterDef } from "../entities/Monster";

/** Adventurer combat power from level + gear (spec §7 death factors). */
export function combatPower(a: Adventurer): number {
  const weapon = a.equipment.weapon?.quality ?? 0;
  const armor = a.equipment.armor?.quality ?? 0;
  const accessory = a.equipment.accessory?.quality ?? 0;
  return a.level * 3 + weapon * 2 + armor * 1.5 + accessory * 0.5;
}

/** Where an adventurer chooses to go: risk appetite gates the harder area. */
export function chooseArea(a: Adventurer, day: number): WildernessArea {
  if (day < 3) return "forest_edge"; // cave "accessible after a few days" (§8)
  const bold = a.personality.riskTolerance >= 60 || combatPower(a) >= 14;
  return bold ? "shadow_cave" : "forest_edge";
}

/**
 * Resolve one adventure. Randomness is real but bounded — gear and level
 * dominate, dice decide the margins (spec §7: "some randomness").
 */
export function resolveAdventure(a: Adventurer, day: number): AdventureOutcome {
  const area = chooseArea(a, day);
  const seed = a.appearance.skin * 17 + a.appearance.hair * 31 + day * 7;
  const monster: MonsterDef = encounterFor(area, seed);

  const power = combatPower(a);
  const threat = monster.hp / 4 + monster.damage;

  // Win chance: power vs threat, clamped to [0.15, 0.95] so nothing is a
  // guaranteed win or a hopeless massacre.
  const edge = power / (power + threat);
  const winChance = clamp(edge * 1.3, 0.15, 0.95);
  const won = Math.random() < winChance;

  // Damage taken scales with how outmatched they were; armor blunts it.
  const armorQ = a.equipment.armor?.quality ?? 0;
  const baseDamage = won ? monster.damage * (0.6 + Math.random() * 0.6) : monster.damage * (1.2 + Math.random() * 0.8);
  const damageTaken = Math.max(1, Math.round(baseDamage - armorQ));

  // Death (spec §7): only possible on a loss, when damage would exceed HP.
  const survived = won || damageTaken < a.hp;

  // Loot: winners roll the table; 60% one drop, 40% two.
  const lootItemKeys: string[] = [];
  if (won) {
    lootItemKeys.push(monster.lootTable[seed % monster.lootTable.length]);
    if (Math.random() < 0.4 && monster.lootTable.length > 1) {
      lootItemKeys.push(monster.lootTable[(seed + 1) % monster.lootTable.length]);
    }
  }

  // Gold: the wilderness is the economy's faucet. Without it the town's
  // money supply is fixed and sales stall once adventurers go broke
  // (found via scripts/balance-report.ts). Scales with monster toughness.
  const goldFound = won ? Math.round(monster.hp * (0.5 + Math.random() * 0.5)) : 0;

  return {
    adventurerId: a.id,
    area,
    day,
    monsterName: monster.name,
    monsterDefeated: won,
    damageTaken: Math.min(damageTaken, a.hp),
    survived,
    lootItemKeys,
    goldFound,
    narration: null, // AI narration attaches async; fallback leaves it null
  };
}

/** Deterministic loot asking price: base value nudged by haggle skill and
 *  relationship — friendly sellers ask fair, hard hagglers ask high (§7 #3). */
export function fallbackAskPrice(a: Adventurer, baseValue: number): number {
  const haggle = a.personality.haggleSkill / 100; // 0..1
  const relationship = a.relationships.shopkeeper / 100; // -1..1
  const markup = 1 + haggle * 0.4 - relationship * 0.15;
  return Math.max(1, Math.round(baseValue * clamp(markup, 0.85, 1.5)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
