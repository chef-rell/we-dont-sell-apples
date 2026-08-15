// Adventurer reaction faces (spec §6): the happy / neutral / unhappy / angry
// expression that pops up in a thought bubble above an adventurer's head when
// they judge a price.
//
// IMPORTANT: this module only *draws* a reaction it is handed. The reaction
// itself is a deterministic function of markup ratio + personality, computed by
// Dev A's game logic (spec §6). Rendering never decides the verdict.

import type { Reaction } from "../types";
import { PALETTE, PX } from "../utils/constants";
import { px } from "./PixelRenderer";

// Emotion colors (spec §6). Exported so HUD/sound cues can stay consistent.
export const REACTION_COLORS: Record<Reaction, string> = {
  happy: "#5bbf5b", // green — good deal
  neutral: "#d9b93a", // yellow — considering
  unhappy: "#d98a3a", // orange — too expensive
  angry: "#c0392b", // red — outrageous
};

const BUBBLE_FILL = PALETTE.textLight; // cream
const FEATURE = "#2c1810"; // dark eyes/mouth

// Bubble footprint in grid units.
const BW = 8;
const BH = 7;

/**
 * Draw a reaction thought-bubble whose tail points down at world pixel (x, y)
 * — pass the top-center of the adventurer's sprite as the anchor. The bubble
 * floats just above that point.
 */
export function drawReaction(
  ctx: CanvasRenderingContext2D,
  reaction: Reaction,
  x: number,
  y: number,
): void {
  const ax = Math.round(x / PX);
  const ay = Math.round(y / PX);
  const color = REACTION_COLORS[reaction];

  const bx = ax - Math.floor(BW / 2); // center bubble over anchor
  const by = ay - BH - 3; // sit above the head, leaving room for the tail

  // Tail: two shrinking puffs between the bubble and the anchor.
  drawPuff(ctx, ax - 1, by + BH, 2, color);
  drawPuff(ctx, ax, by + BH + 2, 1, color);

  // Bubble: colored border with a cream interior.
  px(ctx, bx, by, BW, BH, color);
  px(ctx, bx + 1, by + 1, BW - 2, BH - 2, BUBBLE_FILL);

  // Face inside the interior (6 wide × 5 tall, origin at ix, iy).
  const ix = bx + 1;
  const iy = by + 1;
  drawFace(ctx, ix, iy, reaction, color);
}

function drawPuff(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  size: number,
  border: string,
): void {
  px(ctx, gx, gy, size, size, border);
  if (size > 1) px(ctx, gx, gy, 1, 1, BUBBLE_FILL);
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  ix: number,
  iy: number,
  reaction: Reaction,
  color: string,
): void {
  switch (reaction) {
    case "happy":
      // Bright eyes, rosy cheeks, upturned smile.
      px(ctx, ix + 1, iy + 1, 1, 1, FEATURE);
      px(ctx, ix + 4, iy + 1, 1, 1, FEATURE);
      px(ctx, ix, iy + 2, 1, 1, color); // cheek
      px(ctx, ix + 5, iy + 2, 1, 1, color); // cheek
      px(ctx, ix + 1, iy + 3, 1, 1, FEATURE);
      px(ctx, ix + 4, iy + 3, 1, 1, FEATURE);
      px(ctx, ix + 2, iy + 4, 2, 1, FEATURE); // smile base
      break;
    case "neutral":
      // Plain eyes, flat mouth.
      px(ctx, ix + 1, iy + 1, 1, 1, FEATURE);
      px(ctx, ix + 4, iy + 1, 1, 1, FEATURE);
      px(ctx, ix + 2, iy + 3, 2, 1, FEATURE); // flat mouth
      break;
    case "unhappy":
      // Eyes, downturned frown (corners low).
      px(ctx, ix + 1, iy + 1, 1, 1, FEATURE);
      px(ctx, ix + 4, iy + 1, 1, 1, FEATURE);
      px(ctx, ix + 2, iy + 3, 2, 1, FEATURE); // mouth middle
      px(ctx, ix + 1, iy + 4, 1, 1, FEATURE); // corner down
      px(ctx, ix + 4, iy + 4, 1, 1, FEATURE); // corner down
      break;
    case "angry":
      // Slanted brows driving inward, narrowed eyes, hard frown.
      px(ctx, ix + 1, iy, 1, 1, FEATURE); // left brow (outer, high)
      px(ctx, ix + 2, iy + 1, 1, 1, FEATURE); // left brow (inner, low)
      px(ctx, ix + 4, iy, 1, 1, FEATURE); // right brow (outer, high)
      px(ctx, ix + 3, iy + 1, 1, 1, FEATURE); // right brow (inner, low)
      px(ctx, ix + 1, iy + 2, 1, 1, FEATURE); // eyes
      px(ctx, ix + 4, iy + 2, 1, 1, FEATURE);
      px(ctx, ix, iy + 2, 1, 1, color); // flushed cheek
      px(ctx, ix + 5, iy + 2, 1, 1, color); // flushed cheek
      px(ctx, ix + 2, iy + 3, 2, 1, FEATURE); // mouth middle
      px(ctx, ix + 1, iy + 4, 1, 1, FEATURE); // corner down
      px(ctx, ix + 4, iy + 4, 1, 1, FEATURE); // corner down
      break;
  }
}
