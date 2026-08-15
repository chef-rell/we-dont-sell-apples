// Core pixel drawing utilities. Everything renders as chunky rectangles
// on a 4px grid (spec §10). All draw calls take world-pixel coords and
// snap to the grid.

import { PX } from "../utils/constants";

export function snap(v: number): number {
  return Math.round(v / PX) * PX;
}

/** Fill a rect given in GRID units (1 unit = PX real pixels). */
export function px(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gw: number,
  gh: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(snap(gx * PX), snap(gy * PX), gw * PX, gh * PX);
}

/** Fill a rect in raw world pixels, snapped to the grid. */
export function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(snap(x), snap(y), snap(w), snap(h));
}

/** Simple bordered rect for UI panels drawn on canvas. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  border: string,
): void {
  rect(ctx, x, y, w, h, border);
  rect(ctx, x + PX, y + PX, w - 2 * PX, h - 2 * PX, fill);
}

/** Deterministic tiny PRNG for stable procedural detail (tree/tile jitter). */
export function hash2d(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
