// Item icon drawing (spec §10). Every icon is procedural chunky pixel art
// on the 4px grid, sized to read at small scale on a shop shelf.
//
// Icons are keyed by `Item.icon` (see the contract in src/types). When an
// icon key is unknown, we fall back to a sensible default per category, so
// Developer A can add new items without a rendering change breaking them.

import type { Enchantment, Item, ItemCategory, ItemRarity } from "../types";
import { PALETTE, PX } from "../utils/constants";
import type { Particles } from "./Particles";
import { px, rect } from "./PixelRenderer";

// Every icon draws inside an 8×8 grid cell (32×32 world px at PX=4).
export const ICON_CELL = 8; // grid units

// Item-specific colors (kept local; PALETTE covers world/UI colors only).
const C = {
  steel: "#c8ccd8",
  steelDark: "#8a90a0",
  bronze: "#b08d57",
  wood: "#6b4226",
  woodDark: "#4a2e1a",
  leather: "#8a5a34",
  glass: "#7fb0c8",
  glassHi: "#d8ecf4",
  potion: "#c0392b",
  magic: "#6a5acd",
  magicHi: "#b0a0f0",
  gem: "#3fb6c8",
  gemHi: "#a8ecf4",
  cloak: "#4a5a7a",
  cloakHi: "#66779a",
  hide: "#a97c50",
  hideDark: "#7a5636",
  ration: "#b4783c",
  gold: PALETTE.gold,
  dark: "#2c1810",
  // ---- Enchantment glyph accents (spec V2.9, issue #92) ----
  bone: "#e8dfc8",
  flameCore: "#f4b942",
  flameHot: "#e8622c",
  heartPink: "#e85a7a",
} as const;

type IconFn = (ctx: CanvasRenderingContext2D, gx: number, gy: number) => void;

// ---------- Weapons ----------

const sword: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 3, gy, 2, 5, C.steel); // blade
  px(ctx, gx + 3, gy, 1, 5, C.steelDark); // blade shadow
  px(ctx, gx + 1, gy + 5, 6, 1, C.bronze); // crossguard
  px(ctx, gx + 3, gy + 6, 2, 2, C.wood); // grip
  px(ctx, gx + 3, gy + 8, 2, 1, C.gold); // pommel
};

const dagger: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 3, gy + 1, 2, 4, C.steel);
  px(ctx, gx + 3, gy + 1, 1, 4, C.steelDark);
  px(ctx, gx + 2, gy + 5, 4, 1, C.bronze); // crossguard
  px(ctx, gx + 3, gy + 6, 2, 2, C.wood); // grip
};

const bow: IconFn = (ctx, gx, gy) => {
  // Wooden C-curve with a drawn string
  px(ctx, gx + 2, gy + 1, 1, 6, C.wood);
  px(ctx, gx + 3, gy, 1, 1, C.wood);
  px(ctx, gx + 3, gy + 7, 1, 1, C.wood);
  px(ctx, gx + 4, gy + 1, 1, 6, C.woodDark);
  px(ctx, gx + 4, gy, 1, 8, "#e8e0c8"); // string
};

const staff: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 3, gy + 2, 1, 6, C.wood); // rod
  px(ctx, gx + 2, gy, 3, 3, C.magic); // orb
  px(ctx, gx + 2, gy, 1, 1, C.magicHi); // orb highlight
};

// ---------- Armor ----------

const shield: IconFn = (ctx, gx, gy) => {
  // Solid heater shield: flat top, tapering to a point, with a bronze stripe.
  // Kept solid (no contrasting center) so it never reads as a ring.
  px(ctx, gx + 1, gy, 6, 4, C.steel); // main body
  px(ctx, gx + 2, gy + 4, 4, 1, C.steel); // taper
  px(ctx, gx + 3, gy + 5, 2, 1, C.steel); // point
  px(ctx, gx + 1, gy, 6, 1, "#e0e4ee"); // bright top rim
  px(ctx, gx + 1, gy, 1, 4, C.steelDark); // left edge shade
  px(ctx, gx + 6, gy, 1, 4, C.steelDark); // right edge shade
  px(ctx, gx + 1, gy + 2, 6, 1, C.bronze); // emblem stripe
};

const chestArmor: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 1, gy + 1, 6, 1, C.steelDark); // shoulders
  px(ctx, gx + 1, gy + 2, 6, 3, C.steel); // upper chest
  px(ctx, gx + 2, gy + 5, 4, 1, C.steel); // taper toward waist
  px(ctx, gx + 3, gy + 1, 2, 1, C.dark); // neckline
  px(ctx, gx + 2, gy + 3, 1, 1, C.steelDark); // pec definition
  px(ctx, gx + 5, gy + 3, 1, 1, C.steelDark);
  px(ctx, gx + 1, gy + 6, 6, 1, C.leather); // belt
};

const helmet: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 1, 4, 1, C.steelDark);
  px(ctx, gx + 1, gy + 2, 6, 3, C.steel); // dome
  px(ctx, gx + 1, gy + 2, 1, 3, C.steelDark); // shade
  px(ctx, gx + 2, gy + 4, 4, 1, C.dark); // visor slit
  px(ctx, gx + 3, gy, 2, 1, "#c0392b"); // plume
};

// ---------- Accessories ----------

const ring: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 3, 4, 1, C.gold); // band top
  px(ctx, gx + 2, gy + 4, 1, 2, C.gold); // left
  px(ctx, gx + 5, gy + 4, 1, 2, C.gold); // right
  px(ctx, gx + 2, gy + 6, 4, 1, C.gold); // band bottom
  px(ctx, gx + 3, gy + 1, 2, 2, C.gem); // stone
  px(ctx, gx + 3, gy + 1, 1, 1, C.gemHi); // sparkle
};

const amulet: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy, 1, 1, C.gold); // chain
  px(ctx, gx + 5, gy, 1, 1, C.gold);
  px(ctx, gx + 3, gy + 1, 1, 1, C.gold);
  px(ctx, gx + 4, gy + 1, 1, 1, C.gold);
  px(ctx, gx + 3, gy + 2, 2, 3, C.magic); // pendant gem
  px(ctx, gx + 3, gy + 2, 1, 1, C.magicHi);
};

const cloak: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy, 4, 1, C.cloakHi); // collar
  px(ctx, gx + 1, gy + 1, 6, 1, C.cloak);
  px(ctx, gx + 2, gy + 2, 4, 4, C.cloak); // draped body
  px(ctx, gx + 3, gy + 2, 1, 4, C.cloakHi); // fold highlight
  px(ctx, gx + 2, gy + 6, 4, 1, C.cloakHi); // hem
};

// ---------- Consumables ----------

const potion: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 3, gy, 2, 1, C.wood); // cork
  px(ctx, gx + 3, gy + 1, 2, 1, C.glass); // neck
  px(ctx, gx + 2, gy + 2, 4, 4, C.glass); // bottle
  px(ctx, gx + 2, gy + 3, 4, 3, C.potion); // liquid
  px(ctx, gx + 2, gy + 3, 1, 2, C.glassHi); // shine
};

const ration: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 2, 4, 4, C.ration); // loaf
  px(ctx, gx + 2, gy + 2, 4, 1, "#d9a35e"); // crust top
  px(ctx, gx + 3, gy + 3, 1, 1, C.woodDark); // score marks
  px(ctx, gx + 4, gy + 4, 1, 1, C.woodDark);
};

// ---------- Loot ----------

const hide: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 1, 4, 1, C.hide);
  px(ctx, gx + 1, gy + 2, 6, 3, C.hide); // pelt body
  px(ctx, gx + 2, gy + 5, 4, 1, C.hide);
  px(ctx, gx + 2, gy + 2, 1, 1, C.hideDark); // markings
  px(ctx, gx + 4, gy + 3, 1, 1, C.hideDark);
};

const gem: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 3, gy + 1, 2, 1, C.gemHi); // top facet
  px(ctx, gx + 2, gy + 2, 4, 2, C.gem); // body
  px(ctx, gx + 3, gy + 4, 2, 1, C.gem);
  px(ctx, gx + 4, gy + 5, 1, 1, C.gem); // point
  px(ctx, gx + 2, gy + 2, 1, 1, C.gemHi); // sparkle
};

const artifact: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 1, 4, 4, C.magic); // relic body
  px(ctx, gx + 3, gy, 2, 1, C.gold); // crown
  px(ctx, gx + 2, gy + 5, 4, 1, C.gold); // base
  px(ctx, gx + 3, gy + 2, 2, 2, C.magicHi); // glow core
};

const broken: IconFn = (ctx, gx, gy) => {
  // A snapped, dull blade — clearly damaged loot
  px(ctx, gx + 3, gy + 2, 2, 3, C.steelDark);
  px(ctx, gx + 4, gy + 1, 1, 1, C.steelDark); // jagged break
  px(ctx, gx + 2, gy + 5, 4, 1, C.bronze); // crossguard
  px(ctx, gx + 3, gy + 6, 2, 2, C.wood); // grip
};

// ---------- Icon table + lookup ----------

const ICONS: Record<string, IconFn> = {
  sword,
  dagger,
  bow,
  staff,
  shield,
  chest_armor: chestArmor,
  helmet,
  ring,
  amulet,
  cloak,
  potion,
  ration,
  hide,
  gem,
  artifact,
  broken,
};

const CATEGORY_FALLBACK: Record<ItemCategory, IconFn> = {
  weapon: sword,
  armor: chestArmor,
  accessory: ring,
  consumable: potion,
  loot: gem,
};

/** Known icon keys, exported so item data can be validated against the table. */
export const ITEM_ICON_KEYS = Object.keys(ICONS);

/**
 * Draw an item's icon with its top-left at world pixel (x, y).
 * Occupies an ICON_CELL × ICON_CELL grid footprint (32×32 px at PX=4).
 * Unknown icon keys fall back to a per-category default.
 */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  item: Pick<Item, "icon" | "category">,
  x: number,
  y: number,
): void {
  const draw = ICONS[item.icon] ?? CATEGORY_FALLBACK[item.category] ?? sword;
  draw(ctx, x / PX, y / PX);
}

// ---------- Rarity visuals (spec V2.9, issue #92) ----------
//
// common — nothing; uncommon — green border glow; rare — blue border glow +
// subtle sparkle; legendary — purple/gold border glow + persistent sparkle +
// gold name text. `drawItemWithRarity` is a drop-in, fully static replacement
// for `drawItemIcon` at any existing call site (same (ctx, item, x, y) shape,
// works inside a `ctx.scale()` block exactly like `drawItemIcon` does) — no
// `now`/animation param, so one-shot `useEffect` canvases render correctly too.

/** Border glow colors by rarity. Empty = no glow drawn. Legendary carries two
 *  tones (purple + gold) so both are always visibly present at once. */
export const RARITY_GLOW_COLORS: Record<ItemRarity, string[]> = {
  common: [],
  uncommon: [PALETTE.rarityUncommon],
  rare: [PALETTE.rarityRare],
  legendary: [PALETTE.rarityLegendary, PALETTE.gold],
};

/** Gold for legendary item names (spec: "item name in gold text"); every
 *  other rarity keeps the caller's own text color unchanged. */
export function rarityNameColor(
  item: Pick<Item, "rarity">,
  defaultColor: string,
): string {
  return item.rarity === "legendary" ? PALETTE.gold : defaultColor;
}

/** Hollow rectangular frame, thickness `t`, in the caller's current transform
 *  units — the same hollow-frame idiom as ShopView's local `outline()`. */
function ringFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  color: string,
): void {
  rect(ctx, x, y, w, t, color); // top
  rect(ctx, x, y + h - t, w, t, color); // bottom
  rect(ctx, x, y, t, h, color); // left
  rect(ctx, x + w - t, y, t, h, color); // right
}

// ---- Enchantment corner glyphs: flame / shield / heart / skull ----
// Tiny ~3x3-grid-unit accents, same chunky-rect style as the icons above.

const flameGlyph: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 1, gy, 1, 1, C.flameCore); // tip
  px(ctx, gx, gy + 1, 3, 1, C.flameHot); // body
  px(ctx, gx + 1, gy + 2, 1, 1, C.potion); // base
};

const shieldGlyph: IconFn = (ctx, gx, gy) => {
  px(ctx, gx, gy, 3, 2, C.steel); // body
  px(ctx, gx + 1, gy + 2, 1, 1, C.steelDark); // point
};

const heartGlyph: IconFn = (ctx, gx, gy) => {
  px(ctx, gx, gy, 1, 1, C.heartPink); // left lobe
  px(ctx, gx + 2, gy, 1, 1, C.heartPink); // right lobe
  px(ctx, gx, gy + 1, 3, 1, C.heartPink); // body
  px(ctx, gx + 1, gy + 2, 1, 1, C.heartPink); // point
};

const skullGlyph: IconFn = (ctx, gx, gy) => {
  px(ctx, gx, gy, 3, 2, C.bone); // cranium
  px(ctx, gx, gy + 1, 1, 1, C.dark); // eye socket
  px(ctx, gx + 2, gy + 1, 1, 1, C.dark); // eye socket
  px(ctx, gx + 1, gy + 2, 1, 1, C.bone); // jaw
};

/** Enchantment -> corner-glyph mapping (issue #92: flame/skull/shield/heart). */
const ENCHANT_GLYPHS: Record<Enchantment, IconFn> = {
  flame: flameGlyph,
  warding: shieldGlyph,
  vigor: heartGlyph,
  lifesteal: skullGlyph,
};

/**
 * Drop-in replacement for `drawItemIcon` that layers rarity + enchantment
 * visuals on top of the base icon: border glow (uncommon+), static sparkle
 * accents (rare+), and up to 2 enchantment corner glyphs. Fully synchronous
 * and deterministic — no `Math.random()`, no time input — so it looks
 * identical on every redraw, including one-shot canvases that never re-render.
 */
export function drawItemWithRarity(
  ctx: CanvasRenderingContext2D,
  item: Pick<Item, "icon" | "category" | "rarity" | "enchantments">,
  x: number,
  y: number,
): void {
  drawItemIcon(ctx, item, x, y);

  const box = ICON_CELL * PX;
  const gx = x / PX;
  const gy = y / PX;

  const glowColors = RARITY_GLOW_COLORS[item.rarity];
  if (glowColors.length === 1) {
    ringFrame(ctx, x - PX, y - PX, box + 2 * PX, box + 2 * PX, PX, glowColors[0]);
  } else if (glowColors.length === 2) {
    // Two concentric rings so both the outer and inner tone always read —
    // legendary's "purple/gold" is non-negotiable per spec.
    ringFrame(ctx, x - 2 * PX, y - 2 * PX, box + 4 * PX, box + 4 * PX, PX, glowColors[0]);
    ringFrame(ctx, x - PX, y - PX, box + 2 * PX, box + 2 * PX, PX, glowColors[1]);
  }

  if (item.rarity === "rare") {
    // One small, subtle highlight dot — "subtle sparkle particles".
    px(ctx, gx + ICON_CELL - 1, gy - 1, 1, 1, PALETTE.rarityRare);
  } else if (item.rarity === "legendary") {
    // Persistent, brighter multi-dot sparkle in the legendary colors + white.
    px(ctx, gx + ICON_CELL - 1, gy - 1, 1, 1, "#ffffff");
    px(ctx, gx + ICON_CELL, gy + 1, 1, 1, PALETTE.rarityLegendary);
    px(ctx, gx - 1, gy - 1, 1, 1, PALETTE.gold);
  }

  if (item.enchantments.length > 0) {
    // Up to 2 tiny glyphs along the icon's bottom edge, right-to-left.
    item.enchantments.slice(0, 2).forEach((ench, i) => {
      ENCHANT_GLYPHS[ench](ctx, gx + 5 - i * 3, gy + 5);
    });
  }
}

/**
 * Optional live-particle sparkle for callers that already own a `Particles`
 * instance and redraw every frame (ShopView's shelf loop, the adventure
 * strip's loot-drop labels). No-op for common/uncommon. Spawns exactly one
 * burst per call — the CALLER is responsible for throttling call frequency
 * (e.g. a `Math.random()` gate per frame) per CLAUDE.md's determinism-vs-
 * liveliness rule: this shared helper stays gate-free.
 */
export function spawnRaritySparkle(
  particles: Particles,
  item: Pick<Item, "rarity">,
  x: number,
  y: number,
  sizePx: number,
): void {
  if (item.rarity === "rare") {
    particles.burst(x + sizePx / 2, y + sizePx / 2, {
      count: 1,
      colors: [PALETTE.rarityRare, "#ffffff"],
      speed: 20,
      spread: 1,
      gravity: -10,
      life: 0.6,
      size: PX,
    });
  } else if (item.rarity === "legendary") {
    particles.burst(x + sizePx / 2, y + sizePx / 2, {
      count: 2,
      colors: [PALETTE.rarityLegendary, PALETTE.gold, "#ffffff"],
      speed: 24,
      spread: 1,
      gravity: -10,
      life: 0.7,
      size: PX,
    });
  }
}
