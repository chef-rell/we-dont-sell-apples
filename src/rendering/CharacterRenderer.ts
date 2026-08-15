// Character sprite generation from rectangles (spec §10).
// Head 6×6, body 6×6, arms 2×5, legs 2×4 grid units; 2-frame walk cycle.

import type { Adventurer, AdventurerClass } from "../types";
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

/**
 * Draw a character at world position (x, y) = top-left of the sprite.
 * Sprite is 10 grid units wide (arms included) × 16 tall.
 * walkFrame: 0 or 1 for the leg-alternation cycle; pass 0 when idle.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  a: Pick<Adventurer, "class" | "appearance">,
  x: number,
  y: number,
  walkFrame: 0 | 1,
): void {
  const gx = x / PX;
  const gy = y / PX;
  const skin = PALETTE.skins[a.appearance.skin % PALETTE.skins.length];
  const hair = PALETTE.hair[a.appearance.hair % PALETTE.hair.length];
  const cls = CLASS_COLORS[a.class];

  const isMage = a.class === "mage" || a.class === "cleric";
  const isRogue = a.class === "rogue";

  // Head (6×6) centered over body, offset 2 for arms
  px(ctx, gx + 2, gy, 6, 6, skin);
  // Hair cap
  px(ctx, gx + 2, gy, 6, 2, hair);
  if (isRogue) {
    // Hood: hair color extends down the sides of the head
    px(ctx, gx + 2, gy, 1, 6, cls.accent);
    px(ctx, gx + 7, gy, 1, 6, cls.accent);
    px(ctx, gx + 2, gy, 6, 2, cls.accent);
  }
  // Eyes
  px(ctx, gx + 3, gy + 3, 1, 1, "#1a1a2e");
  px(ctx, gx + 6, gy + 3, 1, 1, "#1a1a2e");

  // Body (6×6); mages/clerics get robes extending over legs
  px(ctx, gx + 2, gy + 6, 6, 6, cls.body);
  // Arms (2×5 each side)
  px(ctx, gx, gy + 6, 2, 5, cls.body);
  px(ctx, gx + 8, gy + 6, 2, 5, cls.body);
  // Hands
  px(ctx, gx, gy + 11, 2, 1, skin);
  px(ctx, gx + 8, gy + 11, 2, 1, skin);

  if (isMage) {
    // Robe covers leg area
    px(ctx, gx + 2, gy + 12, 6, 4, cls.body);
    px(ctx, gx + 2, gy + 15, 6, 1, cls.accent);
  } else {
    // Legs (2×4 each), alternate heights on walk cycle
    const lLift = walkFrame === 0 ? 0 : 1;
    const rLift = walkFrame === 0 ? 1 : 0;
    px(ctx, gx + 3, gy + 12, 2, 4 - lLift, "#3a3a44");
    px(ctx, gx + 5, gy + 12, 2, 4 - rLift, "#3a3a44");
  }

  // Class accessory on back
  if (a.class === "warrior" || a.class === "veteran") {
    // Sword: vertical line with crossguard, peeking over shoulder
    px(ctx, gx + 8, gy + 2, 1, 6, cls.accent);
    px(ctx, gx + 7, gy + 4, 3, 1, "#6b4226");
  } else if (a.class === "ranger") {
    // Bow: arc suggestion on back
    px(ctx, gx + 9, gy + 3, 1, 8, cls.accent);
  } else if (a.class === "mage") {
    // Staff held at side
    px(ctx, gx + 9, gy + 2, 1, 12, "#6b4226");
    px(ctx, gx + 9, gy + 1, 1, 1, cls.accent);
  }
}
