// Item definitions and generation (spec §5).

import type { Item, ItemCategory } from "../types";

interface ItemDef {
  name: string;
  category: ItemCategory;
  baseValue: number;
  quality: number;
  icon: string;
}

export const ITEM_DEFS: Record<string, ItemDef> = {
  iron_sword: { name: "Iron Sword", category: "weapon", baseValue: 30, quality: 3, icon: "sword" },
  steel_sword: { name: "Steel Sword", category: "weapon", baseValue: 60, quality: 5, icon: "sword" },
  rusty_dagger: { name: "Rusty Dagger", category: "weapon", baseValue: 8, quality: 1, icon: "dagger" },
  hunting_bow: { name: "Hunting Bow", category: "weapon", baseValue: 35, quality: 3, icon: "bow" },
  oak_staff: { name: "Oak Staff", category: "weapon", baseValue: 32, quality: 3, icon: "staff" },
  wooden_shield: { name: "Wooden Shield", category: "armor", baseValue: 20, quality: 2, icon: "shield" },
  leather_armor: { name: "Leather Armor", category: "armor", baseValue: 40, quality: 3, icon: "chest_armor" },
  iron_helmet: { name: "Iron Helmet", category: "armor", baseValue: 28, quality: 3, icon: "helmet" },
  health_potion: { name: "Health Potion", category: "consumable", baseValue: 10, quality: 2, icon: "potion" },
  rations: { name: "Rations", category: "consumable", baseValue: 5, quality: 1, icon: "ration" },
  travelers_cloak: { name: "Traveler's Cloak", category: "accessory", baseValue: 15, quality: 2, icon: "cloak" },
  simple_ring: { name: "Simple Ring", category: "accessory", baseValue: 25, quality: 2, icon: "ring" },
  crude_hide: { name: "Crude Hide", category: "loot", baseValue: 6, quality: 1, icon: "hide" },
  small_gem: { name: "Small Gem", category: "loot", baseValue: 14, quality: 2, icon: "gem" },
};

export function makeItem(defKey: string): Item {
  const def = ITEM_DEFS[defKey];
  if (!def) throw new Error(`Unknown item def: ${defKey}`);
  return {
    id: crypto.randomUUID(),
    name: def.name,
    category: def.category,
    baseValue: def.baseValue,
    salePrice: null,
    quality: def.quality,
    icon: def.icon,
  };
}

/** Starting inventory per spec §5. */
export function startingInventory(): Item[] {
  const counts: Array<[string, number]> = [
    ["iron_sword", 3],
    ["wooden_shield", 2],
    ["leather_armor", 2],
    ["health_potion", 4],
    ["travelers_cloak", 1],
    ["simple_ring", 1],
  ];
  return counts.flatMap(([key, n]) => Array.from({ length: n }, () => makeItem(key)));
}
