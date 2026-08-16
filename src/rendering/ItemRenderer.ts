// Item icon drawing (spec §10). Every icon is procedural chunky pixel art
// on the 4px grid, sized to read at small scale on a shop shelf.
//
// Icons are keyed by `Item.icon` (see the contract in src/types). When an
// icon key is unknown, we fall back to a sensible default per category, so
// Developer A can add new items without a rendering change breaking them.

import type { Item, ItemCategory } from "../types";
import { PALETTE, PX } from "../utils/constants";
import { px } from "./PixelRenderer";

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
  // Kite/diamond outline in metal with a wood emblem
  px(ctx, gx + 3, gy, 2, 1, C.steel);
  px(ctx, gx + 2, gy + 1, 4, 1, C.steel);
  px(ctx, gx + 1, gy + 2, 6, 2, C.steel);
  px(ctx, gx + 2, gy + 4, 4, 1, C.steel);
  px(ctx, gx + 3, gy + 5, 2, 1, C.steel);
  px(ctx, gx + 3, gy + 2, 2, 2, C.wood); // boss/emblem
  px(ctx, gx + 1, gy + 2, 1, 2, C.steelDark); // left edge shade
};

const chestArmor: IconFn = (ctx, gx, gy) => {
  px(ctx, gx + 1, gy + 1, 6, 1, C.steelDark); // shoulders
  px(ctx, gx + 1, gy + 2, 6, 4, C.steel); // breastplate
  px(ctx, gx + 3, gy + 1, 2, 1, C.dark); // neck opening
  px(ctx, gx + 3, gy + 2, 1, 4, C.steelDark); // center seam
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
