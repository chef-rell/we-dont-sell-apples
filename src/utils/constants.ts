// Game balance numbers and shared constants (spec §4, §5, §10)

import type { DayPhase, ItemOrigin, ItemRarity } from "../types";

// ---------- Time (spec §4) ----------
export const DAY_LENGTH_MS = 10 * 60 * 1000; // 10 real minutes at 1×
export const NIGHT_SPEED_MULT = 3; // night fast-forwards 3×

export const PHASE_BOUNDS = {
  dawn: [0, 0.1],
  morning: [0.1, 0.35],
  afternoon: [0.35, 0.6],
  evening: [0.6, 0.8],
  night: [0.8, 1.0],
} as const;

// ---------- Economy (spec §5) ----------
export const STARTING_GOLD = 200;
export const SHOP_SLOTS_BY_LEVEL = [12, 16, 20, 24]; // index = shopLevel - 1
export const EXPANSION_COSTS = [300, 600, 1200];

// Reaction bands by markup ratio (spec §5/§6) — baseline thresholds.
// Personality shifts these by at most ±15% (REACTION_SHIFT_MAX).
export const REACTION_BANDS = {
  happyMax: 1.3, // <= this → happy
  neutralMax: 1.8, // <= this → neutral
  unhappyMax: 2.5, // <= this → unhappy; above → angry
} as const;
export const REACTION_SHIFT_MAX = 0.15;

// ---------- Rendering (spec §10) ----------
export const PX = 4; // base pixel size; snap all coords to multiples

export const PALETTE = {
  grass: ["#3a6b35", "#4a7a45"],
  dirt: ["#c4a868", "#b49858"],
  wood: ["#6b4226", "#8b6914"],
  stone: ["#888888", "#777777"],
  walls: ["#5c4033", "#7a5a45"],
  roofs: ["#8b1a1a", "#6b1515"],
  gold: "#e6c35c",
  uiDark: "#1a1a2e",
  uiBorder: "#5c4a7a",
  textLight: "#f0e6d3",
  textDim: "#a09890",
  skins: ["#e8b88a", "#d4a07a", "#f0d0a0", "#c09070"],
  hair: ["#2c1810", "#c0392b", "#e8c35c", "#1a1a1a", "#d4d4e8"],
  // ---- Iso town additions (spec V2.4, issue #70) ----
  // Single base tones fed through rendering/iso.ts's shade() to derive the
  // three-face light/mid/dark set — additive PALETTE entries, no ad-hoc hex
  // in the new iso draw functions.
  foliage: "#2e5429", // tree canopy base
  water: "#5a8dbd", // fountain basin water
  roofWarm: "#6b4a15", // tavern roof (matches the old flat-view hardcoded tone)
  windowLit: "#ffd98a", // building window glow at night
  windowDark: "#3a3a52", // building window by day
} as const;

// Logical canvas size in world px (scaled to fit the window)
export const WORLD_W = 960;
export const WORLD_H = 640;

// ---------- Triptych layout (spec V2.3, issue #77) ----------
export const TIME_COLUMN_W = 90; // right panel — sun/moon column, full stage height
export const STRIP_H = 200; // bottom adventure-strip panel; spans WORLD_W

// Sky tone per phase, warmer at the edges of the day and dark at night.
// Shared by the HUD day clock (#52) and the triptych's time column (#77) so
// the two widgets never drift into disagreeing palettes.
export const DAY_SKY: Record<DayPhase, string> = {
  dawn: "#5c4a6e",
  morning: "#5a7a9a",
  afternoon: "#6a8aa8",
  evening: "#463a5e",
  night: "#141b2e",
};

// ---------- Adventurers ----------
export const STARTING_ADVENTURER_COUNT = 6;
export const MIN_ADVENTURER_COUNT = 4; // expedite arrivals below this
export const REPLACEMENT_DAYS_MIN = 2;
export const REPLACEMENT_DAYS_MAX = 3;

// ---------- Token budget (spec §7) ----------
export const DEFAULT_DAILY_LIMIT_CALLS = 200;
export const DEFAULT_DAILY_LIMIT_TOKENS = 100_000;

// ---------- Gear durability ----------
export const BASE_DURABILITY = 20;
export const DURABILITY_QUALITY_SCALE = 5; // maxDurability = BASE + quality * SCALE
export const DURABILITY_LOSS_MIN = 1;
export const DURABILITY_LOSS_MAX = 3;

// ---------- Rarity, enchantments, repair (spec V2.9, issue #90) ----------

// baseValue carries rarity — the §6 rule (CLAUDE.md rule 1 / v2 spec V2.9):
// these multipliers are the ONLY place rarity touches the economy.
// Economy.ts's verdict functions and REACTION_BANDS are never touched by
// rarity/enchantments — a legendary at 10x a forged item's price still
// reads as "fair" because baseValue itself carries the multiplier.
export const RARITY_VALUE_MULT: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 1.6,
  rare: 2.8,
  legendary: 5,
} as const;
export const ENCHANTMENT_VALUE_BONUS = 0.25; // +25% baseValue per enchantment (additive, stacks)

// Loot-roll rarity distribution (issue #90): common 60/uncommon 30/rare 9/
// legendary 1 (%) at day 0, shifting 5% out of common per 5 days elapsed,
// floored at 25% common. The shifted weight is redistributed proportionally
// across uncommon/rare/legendary (their day-0 ratio 30:9:1 is preserved as
// the game ages) — see `rarityWeightsForDay()` in entities/Item.ts.
export const LOOT_RARITY_BASE_WEIGHTS: Record<ItemRarity, number> = {
  common: 60,
  uncommon: 30,
  rare: 9,
  legendary: 1,
} as const;
export const LOOT_RARITY_COMMON_FLOOR = 25;
export const LOOT_RARITY_SHIFT_PER_5_DAYS = 5;

// Enchantment roll chances by rarity (loot only — forge ceiling is
// uncommon, and enchantments never drop on forge-tier gear). "rare: 70% +
// 20% second" and "legendary: always one + 60% second" are nested — the
// second roll only fires once the first has (see rollLootEnchantments).
export const ENCHANT_ROLL_CHANCE = {
  uncommon: { first: 0.4 },
  rare: { first: 0.7, second: 0.2 },
  legendary: { first: 1, second: 0.6 },
} as const;

// Durability split by origin (spec V2.9): loot gear hits harder but breaks
// sooner; forged gear is the reliable daily-run workhorse. "stock" (today's
// shop/wholesale items) is unchanged — ×1.
export const DURABILITY_ORIGIN_MULT: Record<ItemOrigin, number> = {
  stock: 1,
  loot: 0.7,
  forged: 1.3,
} as const;

// Repair math (src/game/Forge.ts, issue #90; engine wiring deferred to 4b).
export const REPAIR_COST_RATIO = 0.35; // repairCost = round(this * current baseValue)
export const REPAIR_MAX_TIMES = 3; // timesRepaired must stay < this to repair again
export const REPAIR_DURABILITY_DECAY = 0.15; // each repair shrinks maxDurability by this fraction
export const PREFERS_REPAIR_REPLACEMENT_RATIO = 0.45; // repair iff cost < this * replacement value
