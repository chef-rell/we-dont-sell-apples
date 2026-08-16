// Item definitions and generation (spec §5; rarity/enchantments/repair math
// added spec V2.9, issue #90).

import type { Enchantment, Item, ItemCategory, ItemOrigin, ItemRarity } from "../types";
import {
  BASE_DURABILITY,
  DURABILITY_QUALITY_SCALE,
  DURABILITY_ORIGIN_MULT,
  ENCHANTMENT_VALUE_BONUS,
  ENCHANT_ROLL_CHANCE,
  LOOT_RARITY_BASE_WEIGHTS,
  LOOT_RARITY_COMMON_FLOOR,
  LOOT_RARITY_SHIFT_PER_5_DAYS,
  RARITY_VALUE_MULT,
} from "../utils/constants";

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
  stolen_trinket: { name: "Stolen Trinket", category: "loot", baseValue: 12, quality: 2, icon: "ring" },
  bat_wing: { name: "Bat Wing", category: "loot", baseValue: 8, quality: 1, icon: "hide" },
  echo_crystal: { name: "Echo Crystal", category: "loot", baseValue: 22, quality: 3, icon: "gem" },
  core_shard: { name: "Core Shard", category: "loot", baseValue: 35, quality: 4, icon: "gem" },
  golem_plate: { name: "Golem Plate", category: "loot", baseValue: 45, quality: 4, icon: "artifact" },
};

/**
 * Applies rarity + enchantment baseValue multipliers (spec V2.9, issue #90).
 * THE single place this math lives — CLAUDE.md rule 1: baseValue is the
 * ONLY place rarity touches the §6 economy, so every rarity/enchant roll
 * must funnel through here exactly once, at item creation (`makeItem`
 * below). Mutates and returns `item`; calling it twice on the same item
 * would double-apply the multiplier, so nothing outside `makeItem` should
 * call it directly.
 *
 * uncommon ×1.6, rare ×2.8, legendary ×5 (RARITY_VALUE_MULT); each
 * enchantment adds +25% baseValue, additive across enchantments (so two
 * enchantments = +50%, not +56%) — ENCHANTMENT_VALUE_BONUS.
 */
export function applyRarity(item: Item, rarity: ItemRarity, enchantments: Enchantment[] = []): Item {
  const rarityMult = RARITY_VALUE_MULT[rarity];
  const enchantMult = 1 + ENCHANTMENT_VALUE_BONUS * enchantments.length;
  item.rarity = rarity;
  item.enchantments = enchantments;
  item.baseValue = Math.round(item.baseValue * rarityMult * enchantMult);
  return item;
}

/**
 * Loot rarity weights for a given game day (spec V2.9, issue #90): base
 * 60/30/9/1 (common/uncommon/rare/legendary), shifting 5% out of common per
 * 5 elapsed days, floored at 25% common. The shifted weight is
 * redistributed into uncommon/rare/legendary PROPORTIONALLY to their day-0
 * ratio (30:9:1) — a judgment call (the spec numbers don't say how the
 * shifted weight splits); this keeps their relative rarity feel constant as
 * the floor drifts loot upward. Weights always sum to 100.
 */
export function rarityWeightsForDay(day: number): Record<ItemRarity, number> {
  const steps = Math.floor(Math.max(0, day) / 5);
  const maxShift = LOOT_RARITY_BASE_WEIGHTS.common - LOOT_RARITY_COMMON_FLOOR;
  const shift = Math.min(maxShift, steps * LOOT_RARITY_SHIFT_PER_5_DAYS);
  const nonCommonTotal =
    LOOT_RARITY_BASE_WEIGHTS.uncommon + LOOT_RARITY_BASE_WEIGHTS.rare + LOOT_RARITY_BASE_WEIGHTS.legendary;
  return {
    common: LOOT_RARITY_BASE_WEIGHTS.common - shift,
    uncommon: LOOT_RARITY_BASE_WEIGHTS.uncommon + shift * (LOOT_RARITY_BASE_WEIGHTS.uncommon / nonCommonTotal),
    rare: LOOT_RARITY_BASE_WEIGHTS.rare + shift * (LOOT_RARITY_BASE_WEIGHTS.rare / nonCommonTotal),
    legendary: LOOT_RARITY_BASE_WEIGHTS.legendary + shift * (LOOT_RARITY_BASE_WEIGHTS.legendary / nonCommonTotal),
  };
}

/** Roll one loot drop's rarity (spec V2.9, issue #90). Deterministic given
 *  `rng` — callers MUST pass the script's seeded rng (never Math.random)
 *  so the same seed reproduces the same rarity every time. */
export function rollLootRarity(day: number, rng: () => number): ItemRarity {
  const w = rarityWeightsForDay(day);
  const total = w.common + w.uncommon + w.rare + w.legendary; // always 100
  const roll = rng() * total;
  if (roll < w.common) return "common";
  if (roll < w.common + w.uncommon) return "uncommon";
  if (roll < w.common + w.uncommon + w.rare) return "rare";
  return "legendary";
}

export const ALL_ENCHANTMENTS: Enchantment[] = ["flame", "lifesteal", "warding", "vigor"];

/** Roll enchantments for one loot drop (spec V2.9, issue #90) — loot only;
 *  common rarity never enchants. uncommon: 40% for one. rare: 70% for a
 *  first, and (only if the first landed) 20% for a second. legendary:
 *  always one, plus 60% for a second. Picks are distinct — an item never
 *  rolls the same enchantment twice. Deterministic given `rng`. */
export function rollLootEnchantments(rarity: ItemRarity, rng: () => number): Enchantment[] {
  const pool = [...ALL_ENCHANTMENTS];
  const pickOne = (): Enchantment => {
    const idx = Math.floor(rng() * pool.length);
    return pool.splice(idx, 1)[0];
  };
  const enchantments: Enchantment[] = [];
  switch (rarity) {
    case "common":
      break;
    case "uncommon":
      if (rng() < ENCHANT_ROLL_CHANCE.uncommon.first) enchantments.push(pickOne());
      break;
    case "rare":
      if (rng() < ENCHANT_ROLL_CHANCE.rare.first) {
        enchantments.push(pickOne());
        if (rng() < ENCHANT_ROLL_CHANCE.rare.second) enchantments.push(pickOne());
      }
      break;
    case "legendary":
      enchantments.push(pickOne());
      if (rng() < ENCHANT_ROLL_CHANCE.legendary.second) enchantments.push(pickOne());
      break;
  }
  return enchantments;
}

export function makeItem(
  defKey: string,
  opts: { rarity?: ItemRarity; enchantments?: Enchantment[]; origin?: ItemOrigin } = {},
): Item {
  const def = ITEM_DEFS[defKey];
  if (!def) throw new Error(`Unknown item def: ${defKey}`);
  const rarity = opts.rarity ?? "common";
  const enchantments = opts.enchantments ?? [];
  const origin = opts.origin ?? "stock";
  const isGear = def.category === "weapon" || def.category === "armor";
  // Durability split by origin (spec V2.9): applied BEFORE rarity/enchant
  // baseValue math below, since it's independent of baseValue entirely.
  // "stock" (default; every call site pre-#90 is unaffected) multiplies by
  // 1 — byte-for-byte identical maxDurability to today's output.
  const rawMaxDurability = isGear ? BASE_DURABILITY + def.quality * DURABILITY_QUALITY_SCALE : null;
  const maxDurability = rawMaxDurability !== null
    ? Math.round(rawMaxDurability * DURABILITY_ORIGIN_MULT[origin])
    : null;

  const item: Item = {
    id: crypto.randomUUID(),
    name: def.name,
    category: def.category,
    baseValue: def.baseValue,
    salePrice: null,
    quality: def.quality,
    icon: def.icon,
    durability: maxDurability,
    maxDurability,
    timesRepaired: 0,
    rarity: "common",
    enchantments: [],
    origin,
  };
  // rarity="common" + enchantments=[] here is a ×1×1 no-op — every call
  // site that doesn't pass opts gets today's exact baseValue back.
  return applyRarity(item, rarity, enchantments);
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
