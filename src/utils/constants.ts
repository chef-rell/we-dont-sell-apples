// Game balance numbers and shared constants (spec §4, §5, §10)

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
