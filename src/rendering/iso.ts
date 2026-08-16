// Isometric projection module (spec WDSA-v2-spec.md V2.4, issue #70).
// World stays orthogonal (960x640 world px, unchanged game logic, movement,
// building registry); this module ONLY converts world<->screen for drawing
// and click hit-testing. One shared module — no view does its own
// projection math.
//
// 2:1 diamond projection. Origin constants chosen so the full 960x640 world
// maps to a screen diamond spanning sx in [80, 880], sy in [120, 520] —
// fits inside the existing 960x640 canvas with headroom above for building
// heights (roofs extrude upward in screen space, toward smaller sy).

import { PX } from "../utils/constants";
import type { Position } from "../types";

export const ISO_OX = 400;
export const ISO_OY = 120;

export interface ScreenPoint {
  sx: number;
  sy: number;
}

/** World (wx, wy) -> screen (sx, sy). */
export function project(wx: number, wy: number): ScreenPoint {
  return { sx: ISO_OX + (wx - wy) / 2, sy: ISO_OY + (wx + wy) / 4 };
}

/** Screen (sx, sy) -> world (wx, wy). Exact inverse of project(). */
export function unproject(sx: number, sy: number): { wx: number; wy: number } {
  const dx = sx - ISO_OX;
  const dy = sy - ISO_OY;
  return { wx: dx + 2 * dy, wy: 2 * dy - dx };
}

/** Painter's-algorithm sort key: draw ascending (smallest first, i.e.
 *  north-west before south-east) so nearer objects land on top. */
export function depthKey(wx: number, wy: number): number {
  return wx + wy;
}

/** All eight sprite facings the character renderer understands. */
export type Facing = Position["facing"];

/**
 * Map a world (cardinal) facing to the iso diagonal the town view draws.
 * Movement (`AdventurerBehavior.walkToward`) only ever emits the four
 * cardinal directions — diagonals are a render-time concern applied here,
 * per the CharacterRenderer.ts note. If a diagonal is ever passed through
 * directly, it's left unchanged.
 */
export function isoFacing(facing: Facing): Facing {
  switch (facing) {
    case "right":
      return "SE";
    case "down":
      return "SW";
    case "left":
      return "NW";
    case "up":
      return "NE";
    default:
      return facing;
  }
}

// ---------- Three-face shading (spec V2.4 production rules) ----------

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Lighten (amt > 0) or darken (amt < 0) a "#rrggbb" hex color by a factor
 *  in roughly [-1, 1]. Positive amounts blend toward white; negative
 *  amounts scale toward black. */
export function shade(hex: string, amt: number): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16);
  const g = parseInt(n.substring(2, 4), 16);
  const b = parseInt(n.substring(4, 6), 16);
  const adjust = (c: number) => (amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const toHex = (c: number) => clamp255(c).toString(16).padStart(2, "0");
  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

const OUTLINE = "#14141c"; // 1-grid-unit dark silhouette outline for every solid

function fillPoly(ctx: CanvasRenderingContext2D, pts: ScreenPoint[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].sx, pts[0].sy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a shaded iso box: footprint (wx, wy, wDepth, hDepth) in world units,
 * extruded `heightPx` screen pixels upward from the ground plane. Every
 * solid in the town view uses this (or the same three-face rule): top face
 * light (+0.25), left face mid (the base color, unshaded), right face dark
 * (-0.3), with a 1-grid-unit dark outline on the silhouette. No unshaded
 * flat rect ever appears in the world view.
 *
 * `liftPx` (optional) raises the whole block an extra amount above the
 * ground plane — for stacking one block on another (a roof on its walls, a
 * fountain's water layer on its basin) without changing the shared
 * signature callers rely on.
 */
export function drawIsoBlock(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  wDepth: number,
  hDepth: number,
  heightPx: number,
  baseColor: string,
  liftPx = 0,
): void {
  const pN = project(wx, wy);
  const pE = project(wx + wDepth, wy);
  const pS = project(wx + wDepth, wy + hDepth);
  const pW = project(wx, wy + hDepth);
  const raise = (p: ScreenPoint, dy: number): ScreenPoint => ({ sx: p.sx, sy: p.sy - dy });

  const gN = raise(pN, liftPx);
  const gE = raise(pE, liftPx);
  const gS = raise(pS, liftPx);
  const gW = raise(pW, liftPx);
  const tN = raise(gN, heightPx);
  const tE = raise(gE, heightPx);
  const tS = raise(gS, heightPx);
  const tW = raise(gW, heightPx);

  const top = shade(baseColor, 0.25);
  const right = shade(baseColor, -0.3);

  fillPoly(ctx, [gW, gS, tS, tW], baseColor); // left face: mid (base, unshaded)
  fillPoly(ctx, [gS, gE, tE, tS], right); // right face: dark
  fillPoly(ctx, [tN, tE, tS, tW], top); // top face: light

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = PX;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(tN.sx, tN.sy);
  ctx.lineTo(tE.sx, tE.sy);
  ctx.lineTo(gE.sx, gE.sy);
  ctx.lineTo(gS.sx, gS.sy);
  ctx.lineTo(gW.sx, gW.sy);
  ctx.lineTo(tW.sx, tW.sy);
  ctx.closePath();
  ctx.stroke();
}
