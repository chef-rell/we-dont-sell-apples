// Monster definitions (spec §8). Stats are NOT decorative — they drive the
// deterministic combat math in Combat.ts.

import type { WildernessArea } from "../types";

export interface MonsterDef {
  name: string;
  hp: number;
  damage: number;
  lootTable: string[]; // ITEM_DEFS keys
  area: WildernessArea;
  rare?: boolean; // rare spawns gate better loot behind tougher fights
}

export const MONSTERS: MonsterDef[] = [
  { name: "Forest Lurker", hp: 20, damage: 5, lootTable: ["crude_hide", "small_gem"], area: "forest_edge" },
  { name: "Goblin Scavenger", hp: 25, damage: 7, lootTable: ["stolen_trinket", "rusty_dagger"], area: "forest_edge" },
  { name: "Cave Bat Swarm", hp: 12, damage: 8, lootTable: ["bat_wing", "echo_crystal"], area: "shadow_cave" },
  { name: "Stone Golem", hp: 50, damage: 12, lootTable: ["core_shard", "golem_plate"], area: "shadow_cave", rare: true },
];

/** Pick today's encounter for an area. Deterministic given (day, adventurer seed). */
export function encounterFor(area: WildernessArea, seed: number): MonsterDef {
  const pool = MONSTERS.filter((m) => m.area === area);
  const common = pool.filter((m) => !m.rare);
  const rare = pool.filter((m) => m.rare);
  // Rare encounter roughly 1 in 4, when the area has one.
  if (rare.length > 0 && seed % 4 === 0) return rare[seed % rare.length];
  return common[seed % common.length];
}
