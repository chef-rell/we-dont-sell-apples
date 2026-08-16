// Character sprite generation from rectangles (spec §10).
// Head 6×6, body 6×6, arms 2×5, legs 2×4 grid units; 2-frame walk cycle;
// four cardinal facings (front/back/profile, profile mirrored for the
// opposite side). Equipped weapon (if any) is drawn on the sprite.

import type { Adventurer, AdventurerClass, Position } from "../types";
import { PALETTE, PX } from "../utils/constants";
import { px } from "./PixelRenderer";

const CLASS_COLORS: Record<AdventurerClass, { body: string; accent: string }> = {
  warrior: { body: "#7a4a3a", accent: "#a8a8b8" }, // leather + steel
  ranger: { body: "#3f6b3a", accent: "#6b4226" }, // greens + bow wood
  mage: { body: "#4a3a7a", accent: "#e6c35c" }, // robes + gold trim
  rogue: { body: "#2e2e3a", accent: "#1a1a24" }, // darks + hood
  cleric: { body: "#c8c0a8", accent: "#e6c35c" }, // pale robes + gold
  veteran: { body: "#5a5a62", accent: "#8b1a1a" }, // grizzled greys + red sash
};

// Equipped-weapon hip blade colors mirror ItemRenderer's sword icon palette
// (kept local the same way ItemRenderer keeps its own `C`) so the blade a
// character carries reads as the same steel as the one on the shelf.
const WEAPON_STEEL = "#c8ccd8";
const WEAPON_STEEL_DARK = "#8a90a0";
const WEAPON_BRONZE = "#b08d57";

/**
 * Sprite facing: the four cardinal directions the top-down town uses, plus
 * the four iso diagonals added in Phase 1 (v2, WDSA-v2-spec.md V2.4) — "SE"
 * | "SW" | "NE" | "NW". SE/NE are drawn poses; SW/NW mirror them, the same
 * pattern "left" uses off "right" below. Nothing writes diagonals into
 * `Position.facing` yet — the iso TownView (issue #70) maps world facings
 * to diagonals at render time.
 */
export type Facing = Position["facing"];

type SpriteCtx = {
  skin: string;
  hair: string;
  cls: { body: string; accent: string };
  isMage: boolean;
  isRogue: boolean;
  walkFrame: 0 | 1;
  hasWeapon: boolean;
};

type PoseFn = (
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  s: SpriteCtx,
  cclass: AdventurerClass,
) => void;

/** Legs (2×4 each), alternating heights on the walk cycle. Same silhouette
 *  works unchanged for front, back, and profile. */
function drawLegs(ctx: CanvasRenderingContext2D, gx: number, gy: number, walkFrame: 0 | 1): void {
  const lLift = walkFrame === 0 ? 0 : 1;
  const rLift = walkFrame === 0 ? 1 : 0;
  px(ctx, gx + 3, gy + 12, 2, 4 - lLift, "#3a3a44");
  px(ctx, gx + 5, gy + 12, 2, 4 - rLift, "#3a3a44");
}

/** Class flourish (gear slung on the back), read from behind or peeking
 *  over the shoulder from the front. `dx` shifts the whole motif sideways
 *  so the profile pose can move it to the trailing (back) edge, clear of
 *  the visible arm — same relative shape, different anchor. */
function drawClassAccessory(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  cclass: AdventurerClass,
  cls: { accent: string },
  dx: number,
): void {
  if (cclass === "warrior" || cclass === "veteran") {
    // Sword: vertical line with crossguard, peeking over the shoulder.
    px(ctx, gx + 8 + dx, gy + 2, 1, 6, cls.accent);
    px(ctx, gx + 7 + dx, gy + 4, 3, 1, "#6b4226");
  } else if (cclass === "ranger") {
    // Bow: arc suggestion on the back.
    px(ctx, gx + 9 + dx, gy + 3, 1, 8, cls.accent);
  } else if (cclass === "mage") {
    // Staff held at the side.
    px(ctx, gx + 9 + dx, gy + 2, 1, 12, "#6b4226");
    px(ctx, gx + 9 + dx, gy + 1, 1, 1, cls.accent);
  }
}

/** Equipped weapon, gripped in hand and hanging to the ground — anchored to
 *  whichever arm is visible (`armX`) so it never floats free of the body. */
function drawHipWeapon(ctx: CanvasRenderingContext2D, gx: number, gy: number, armX: number): void {
  px(ctx, gx + armX, gy + 12, 2, 1, WEAPON_BRONZE); // crossguard, at the hand
  px(ctx, gx + armX, gy + 13, 1, 3, WEAPON_STEEL); // blade, to the ground line
  px(ctx, gx + armX, gy + 13, 1, 1, WEAPON_STEEL_DARK); // top edge shade
}

/** Front (facing down, toward the viewer) — today's original pose. */
const drawFront: PoseFn = (ctx, gx, gy, s, cclass) => {
  // Head (6×6) centered over body, offset 2 for arms
  px(ctx, gx + 2, gy, 6, 6, s.skin);
  // Hair cap
  px(ctx, gx + 2, gy, 6, 2, s.hair);
  if (s.isRogue) {
    // Hood: hair color extends down the sides of the head
    px(ctx, gx + 2, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 7, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 2, gy, 6, 2, s.cls.accent);
  }
  // Eyes
  px(ctx, gx + 3, gy + 3, 1, 1, "#1a1a2e");
  px(ctx, gx + 6, gy + 3, 1, 1, "#1a1a2e");

  // Body (6×6); mages/clerics get robes extending over legs
  px(ctx, gx + 2, gy + 6, 6, 6, s.cls.body);
  // Arms (2×5 each side)
  px(ctx, gx, gy + 6, 2, 5, s.cls.body);
  px(ctx, gx + 8, gy + 6, 2, 5, s.cls.body);
  // Hands
  px(ctx, gx, gy + 11, 2, 1, s.skin);
  px(ctx, gx + 8, gy + 11, 2, 1, s.skin);

  if (s.isMage) {
    // Robe covers leg area
    px(ctx, gx + 2, gy + 12, 6, 4, s.cls.body);
    px(ctx, gx + 2, gy + 15, 6, 1, s.cls.accent);
  } else {
    drawLegs(ctx, gx, gy, s.walkFrame);
  }

  drawClassAccessory(ctx, gx, gy, cclass, s.cls, 0);
  if (s.hasWeapon) drawHipWeapon(ctx, gx, gy, 0); // left hand, clear of the class accessory
};

/** Back (facing up, away from the viewer) — same silhouette as front, but
 *  the head is all hair (no face) since we're looking at the back of the
 *  skull; a hood reads identically from behind since it already wraps the
 *  whole head. */
const drawBack: PoseFn = (ctx, gx, gy, s, cclass) => {
  px(ctx, gx + 2, gy, 6, 6, s.hair);
  if (s.isRogue) {
    px(ctx, gx + 2, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 7, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 2, gy, 6, 2, s.cls.accent);
  }

  px(ctx, gx + 2, gy + 6, 6, 6, s.cls.body);
  px(ctx, gx, gy + 6, 2, 5, s.cls.body);
  px(ctx, gx + 8, gy + 6, 2, 5, s.cls.body);
  px(ctx, gx, gy + 11, 2, 1, s.skin);
  px(ctx, gx + 8, gy + 11, 2, 1, s.skin);

  if (s.isMage) {
    px(ctx, gx + 2, gy + 12, 6, 4, s.cls.body);
    px(ctx, gx + 2, gy + 15, 6, 1, s.cls.accent);
  } else {
    drawLegs(ctx, gx, gy, s.walkFrame);
  }

  drawClassAccessory(ctx, gx, gy, cclass, s.cls, 0);
  if (s.hasWeapon) drawHipWeapon(ctx, gx, gy, 0);
};

/** Profile, canonical facing right — "left" reuses this mirrored (see
 *  FACINGS below). Only the near (leading) arm is drawn; the far arm is
 *  hidden behind the torso, which is what makes a profile read as a
 *  profile instead of the front pose squashed sideways. Gear slung on the
 *  back moves to the trailing edge, clear of the visible arm. */
const drawSide: PoseFn = (ctx, gx, gy, s, cclass) => {
  // Head, turned: hair covers the trailing half of the skull plus the
  // crown; the leading half stays skin with a single eye — the face
  // turned into the walk.
  px(ctx, gx + 2, gy, 6, 6, s.skin);
  px(ctx, gx + 2, gy, 3, 6, s.hair);
  px(ctx, gx + 2, gy, 6, 2, s.hair);
  if (s.isRogue) {
    px(ctx, gx + 2, gy, 2, 6, s.cls.accent);
    px(ctx, gx + 2, gy, 6, 2, s.cls.accent);
  }
  px(ctx, gx + 6, gy + 3, 1, 1, "#1a1a2e");

  // Torso; only the leading arm is visible.
  px(ctx, gx + 2, gy + 6, 6, 6, s.cls.body);
  px(ctx, gx + 7, gy + 6, 2, 5, s.cls.body);
  px(ctx, gx + 7, gy + 11, 2, 1, s.skin);

  if (s.isMage) {
    px(ctx, gx + 2, gy + 12, 6, 4, s.cls.body);
    px(ctx, gx + 2, gy + 15, 6, 1, s.cls.accent);
  } else {
    drawLegs(ctx, gx, gy, s.walkFrame);
  }

  drawClassAccessory(ctx, gx, gy, cclass, s.cls, -7); // trailing edge, behind the visible arm
  if (s.hasWeapon) drawHipWeapon(ctx, gx, gy, 7); // in the visible hand
};

/** Three-quarter front, canonical facing SE (heading toward the screen's
 *  lower-right) — "SW" reuses this mirrored. A shallower turn than
 *  `drawSide`: the face still reads, but every symmetric feature of
 *  `drawFront` picks up a 1-unit lean toward the leading (right, downhill)
 *  side so the turn is legible at this resolution. */
const drawThreeQuarterFront: PoseFn = (ctx, gx, gy, s, cclass) => {
  px(ctx, gx + 2, gy, 6, 6, s.skin);
  px(ctx, gx + 2, gy, 6, 2, s.hair);
  // Trailing (left) edge shows one extra unit of hair wrap — the far side
  // of the skull just starting to peek around as the head turns toward
  // the leading edge (more of this at full profile in drawSide).
  px(ctx, gx + 2, gy, 1, 6, s.hair);
  if (s.isRogue) {
    // Hood: wraps the trailing edge two units wide (extra wrap, as above)
    // but stays a single unit on the leading edge, same as drawFront.
    px(ctx, gx + 2, gy, 2, 6, s.cls.accent);
    px(ctx, gx + 7, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 2, gy, 6, 2, s.cls.accent);
  }
  // Both eyes stay visible but shift 1 unit toward the leading side.
  px(ctx, gx + 4, gy + 3, 1, 1, "#1a1a2e");
  px(ctx, gx + 7, gy + 3, 1, 1, "#1a1a2e");

  px(ctx, gx + 2, gy + 6, 6, 6, s.cls.body);
  // Leading arm (right) fully visible; trailing arm (left) loses its
  // inner column — partially behind the torso as the body turns.
  px(ctx, gx, gy + 6, 1, 5, s.cls.body);
  px(ctx, gx + 8, gy + 6, 2, 5, s.cls.body);
  px(ctx, gx, gy + 11, 1, 1, s.skin);
  px(ctx, gx + 8, gy + 11, 2, 1, s.skin);

  if (s.isMage) {
    px(ctx, gx + 2, gy + 12, 6, 4, s.cls.body);
    px(ctx, gx + 2, gy + 15, 6, 1, s.cls.accent);
  } else {
    drawLegs(ctx, gx, gy, s.walkFrame);
  }

  drawClassAccessory(ctx, gx, gy, cclass, s.cls, -7); // trailing edge
  if (s.hasWeapon) drawHipWeapon(ctx, gx, gy, 8); // leading hand
};

/** Three-quarter back, canonical facing NE (heading toward the screen's
 *  upper-right) — "NW" reuses this mirrored. Mostly `drawBack`'s hair-only
 *  head (no face from this angle), but the leading (right) shoulder reads
 *  forward into the turn while the trailing arm recedes behind the torso,
 *  mirroring the asymmetry `drawThreeQuarterFront` uses below the neck. */
const drawThreeQuarterBack: PoseFn = (ctx, gx, gy, s, cclass) => {
  px(ctx, gx + 2, gy, 6, 6, s.hair);
  if (s.isRogue) {
    px(ctx, gx + 2, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 7, gy, 1, 6, s.cls.accent);
    px(ctx, gx + 2, gy, 6, 2, s.cls.accent);
  }

  px(ctx, gx + 2, gy + 6, 6, 6, s.cls.body);
  // Trailing arm (left) narrows behind the torso; leading arm (right)
  // stays full width so that shoulder reads as pushed forward.
  px(ctx, gx, gy + 6, 1, 5, s.cls.body);
  px(ctx, gx + 8, gy + 6, 2, 5, s.cls.body);
  px(ctx, gx, gy + 11, 1, 1, s.skin);
  px(ctx, gx + 8, gy + 11, 2, 1, s.skin);

  if (s.isMage) {
    px(ctx, gx + 2, gy + 12, 6, 4, s.cls.body);
    px(ctx, gx + 2, gy + 15, 6, 1, s.cls.accent);
  } else {
    drawLegs(ctx, gx, gy, s.walkFrame);
  }

  // Accessory shifts off-center toward the trailing (left) shoulder —
  // partway between drawBack's centered dx=0 and drawSide's full dx=-7,
  // matching how far the body has actually turned.
  drawClassAccessory(ctx, gx, gy, cclass, s.cls, -4);
  if (s.hasWeapon) drawHipWeapon(ctx, gx, gy, 8); // leading hand
};

const FACINGS: Record<Facing, { draw: PoseFn; mirror: boolean }> = {
  down: { draw: drawFront, mirror: false },
  up: { draw: drawBack, mirror: false },
  right: { draw: drawSide, mirror: false },
  left: { draw: drawSide, mirror: true },
  SE: { draw: drawThreeQuarterFront, mirror: false },
  SW: { draw: drawThreeQuarterFront, mirror: true },
  NE: { draw: drawThreeQuarterBack, mirror: false },
  NW: { draw: drawThreeQuarterBack, mirror: true },
};

// ---------------------------------------------------------------------
// Child variant (spec V2.7/V2.15, issue #84): the Helper's sprite. Shorter
// than the adult grid — 10×12 vs 10×16 — head 6×5, body 6×4, legs 2×3.
// Deliberately reuses every X-axis coordinate from the adult poses above
// verbatim (the grid is still 10 units wide; only the vertical proportions
// compress), so each child pose below is the adult pose's geometry with
// just the row math rescaled: head/cap start at gy (height 5, was 6), body
// starts at gy+5 (was gy+6, height 4, was 6), hands sit at gy+8 (was
// gy+11), legs start at gy+9 (was gy+12, height 3, was 4). Same eight
// facings, same mirror-for-left/-SW/-NW machinery as the adult grid.
//
// The helper has no adventurer class or equipment slot, so there's no
// class accessory, hood, robe, or weapon here — just a plain tunic, kept
// deliberately its own thing rather than a tiny copy of one of the six
// adventurer palettes.
const CHILD_CLOTHES = { body: "#8a6b42", accent: "#5a4228" }; // tunic + hem

type ChildSpriteCtx = { skin: string; hair: string; walkFrame: 0 | 1 };
type ChildPoseFn = (ctx: CanvasRenderingContext2D, gx: number, gy: number, s: ChildSpriteCtx) => void;

/** Legs (2×3 each), alternating heights on the walk cycle — same lift
 *  pattern as the adult drawLegs, just off the child's shorter leg run. */
function drawChildLegs(ctx: CanvasRenderingContext2D, gx: number, gy: number, walkFrame: 0 | 1): void {
  const lLift = walkFrame === 0 ? 0 : 1;
  const rLift = walkFrame === 0 ? 1 : 0;
  px(ctx, gx + 3, gy + 9, 2, 3 - lLift, "#3a3a44");
  px(ctx, gx + 5, gy + 9, 2, 3 - rLift, "#3a3a44");
}

const drawChildFront: ChildPoseFn = (ctx, gx, gy, s) => {
  px(ctx, gx + 2, gy, 6, 5, s.skin);
  px(ctx, gx + 2, gy, 6, 2, s.hair);
  px(ctx, gx + 3, gy + 2, 1, 1, "#1a1a2e");
  px(ctx, gx + 6, gy + 2, 1, 1, "#1a1a2e");

  px(ctx, gx + 2, gy + 5, 6, 4, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 5, 2, 3, CHILD_CLOTHES.body);
  px(ctx, gx + 8, gy + 5, 2, 3, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 8, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 2, gy + 8, 6, 1, CHILD_CLOTHES.accent); // hem

  drawChildLegs(ctx, gx, gy, s.walkFrame);
};

const drawChildBack: ChildPoseFn = (ctx, gx, gy, s) => {
  px(ctx, gx + 2, gy, 6, 5, s.hair); // no face from behind

  px(ctx, gx + 2, gy + 5, 6, 4, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 5, 2, 3, CHILD_CLOTHES.body);
  px(ctx, gx + 8, gy + 5, 2, 3, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 8, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 2, gy + 8, 6, 1, CHILD_CLOTHES.accent);

  drawChildLegs(ctx, gx, gy, s.walkFrame);
};

/** Profile, canonical right — "left" mirrors it, same as the adult side pose. */
const drawChildSide: ChildPoseFn = (ctx, gx, gy, s) => {
  px(ctx, gx + 2, gy, 6, 5, s.skin);
  px(ctx, gx + 2, gy, 3, 5, s.hair); // trailing half, full head height
  px(ctx, gx + 2, gy, 6, 2, s.hair); // cap
  px(ctx, gx + 6, gy + 2, 1, 1, "#1a1a2e");

  px(ctx, gx + 2, gy + 5, 6, 4, CHILD_CLOTHES.body);
  px(ctx, gx + 7, gy + 5, 2, 3, CHILD_CLOTHES.body); // leading arm only
  px(ctx, gx + 7, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 2, gy + 8, 6, 1, CHILD_CLOTHES.accent);

  drawChildLegs(ctx, gx, gy, s.walkFrame);
};

/** Three-quarter front, canonical SE — "SW" mirrors it. */
const drawChildThreeQuarterFront: ChildPoseFn = (ctx, gx, gy, s) => {
  px(ctx, gx + 2, gy, 6, 5, s.skin);
  px(ctx, gx + 2, gy, 6, 2, s.hair);
  px(ctx, gx + 2, gy, 1, 5, s.hair); // trailing sliver, full height
  px(ctx, gx + 4, gy + 2, 1, 1, "#1a1a2e");
  px(ctx, gx + 7, gy + 2, 1, 1, "#1a1a2e");

  px(ctx, gx + 2, gy + 5, 6, 4, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 5, 1, 3, CHILD_CLOTHES.body); // trailing arm, narrowed
  px(ctx, gx + 8, gy + 5, 2, 3, CHILD_CLOTHES.body); // leading arm, full
  px(ctx, gx, gy + 8, 1, 1, s.skin);
  px(ctx, gx + 8, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 2, gy + 8, 6, 1, CHILD_CLOTHES.accent);

  drawChildLegs(ctx, gx, gy, s.walkFrame);
};

/** Three-quarter back, canonical NE — "NW" mirrors it. */
const drawChildThreeQuarterBack: ChildPoseFn = (ctx, gx, gy, s) => {
  px(ctx, gx + 2, gy, 6, 5, s.hair);

  px(ctx, gx + 2, gy + 5, 6, 4, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 5, 1, 3, CHILD_CLOTHES.body);
  px(ctx, gx + 8, gy + 5, 2, 3, CHILD_CLOTHES.body);
  px(ctx, gx, gy + 8, 1, 1, s.skin);
  px(ctx, gx + 8, gy + 8, 2, 1, s.skin);
  px(ctx, gx + 2, gy + 8, 6, 1, CHILD_CLOTHES.accent);

  drawChildLegs(ctx, gx, gy, s.walkFrame);
};

const CHILD_FACINGS: Record<Facing, { draw: ChildPoseFn; mirror: boolean }> = {
  down: { draw: drawChildFront, mirror: false },
  up: { draw: drawChildBack, mirror: false },
  right: { draw: drawChildSide, mirror: false },
  left: { draw: drawChildSide, mirror: true },
  SE: { draw: drawChildThreeQuarterFront, mirror: false },
  SW: { draw: drawChildThreeQuarterFront, mirror: true },
  NE: { draw: drawChildThreeQuarterBack, mirror: false },
  NW: { draw: drawChildThreeQuarterBack, mirror: true },
};

/** Child sprite's total height in world px (12 grid units), for callers
 *  that anchor a sprite by its feet — same role the "64" the adult sprite
 *  (16 grid units) gets hardcoded as at call sites, just named so a
 *  helper-drawing call site doesn't have to repeat the 12*PX math. */
export const CHILD_SPRITE_H = 12 * PX;

/**
 * Draw a character at world position (x, y) = top-left of the sprite.
 * Adult sprite (the default `variant`) is 10 grid units wide (arms
 * included) × 16 tall, unchanged. `variant: "child"` (issue #84) draws the
 * Helper's shorter 10×12 sprite instead — see the child pose functions
 * above; it only ever needs `appearance` (no class, no equipment slot).
 * walkFrame: 0 or 1 for the leg-alternation cycle; pass 0 when idle.
 * facing: defaults to "down" (today's front pose) when omitted, so
 * existing call sites compile and render identically.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  a: Pick<Adventurer, "class" | "appearance" | "equipment">,
  x: number,
  y: number,
  walkFrame: 0 | 1,
  facing?: Facing,
  variant?: "adult",
): void;
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  a: Pick<Adventurer, "appearance">,
  x: number,
  y: number,
  walkFrame: 0 | 1,
  facing: Facing | undefined,
  variant: "child",
): void;
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  a: Pick<Adventurer, "appearance"> & Partial<Pick<Adventurer, "class" | "equipment">>,
  x: number,
  y: number,
  walkFrame: 0 | 1,
  facing: Facing = "down",
  variant: "adult" | "child" = "adult",
): void {
  const gx = x / PX;
  const gy = y / PX;
  const skin = PALETTE.skins[a.appearance.skin % PALETTE.skins.length];
  const hair = PALETTE.hair[a.appearance.hair % PALETTE.hair.length];

  if (variant === "child") {
    const childCtx: ChildSpriteCtx = { skin, hair, walkFrame };
    const pose = CHILD_FACINGS[facing] ?? CHILD_FACINGS.down;
    if (!pose.mirror) {
      pose.draw(ctx, gx, gy, childCtx);
      return;
    }
    const centerPx = x + 5 * PX;
    ctx.save();
    ctx.translate(centerPx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-centerPx, 0);
    pose.draw(ctx, gx, gy, childCtx);
    ctx.restore();
    return;
  }

  // Adult path: the two overloads above guarantee class/equipment are
  // present whenever a real call site reaches here with the default variant.
  const cclass = a.class as AdventurerClass;
  const spriteCtx: SpriteCtx = {
    skin,
    hair,
    cls: CLASS_COLORS[cclass],
    isMage: cclass === "mage" || cclass === "cleric",
    isRogue: cclass === "rogue",
    walkFrame,
    hasWeapon: Boolean(a.equipment?.weapon),
  };

  const pose = FACINGS[facing] ?? FACINGS.down;
  if (!pose.mirror) {
    pose.draw(ctx, gx, gy, spriteCtx, cclass);
    return;
  }

  // Mirror around the sprite's own vertical centerline (grid x=5) so
  // left-facing reuses drawSide instead of duplicating it.
  const centerPx = x + 5 * PX;
  ctx.save();
  ctx.translate(centerPx, 0);
  ctx.scale(-1, 1);
  ctx.translate(-centerPx, 0);
  pose.draw(ctx, gx, gy, spriteCtx, cclass);
  ctx.restore();
}
