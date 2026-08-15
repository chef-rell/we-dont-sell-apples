// Building drawing: rectangular walls, pitched roof, door, glowing windows
// (spec §10). Coordinates in world px, snapped internally.

import { PALETTE, PX } from "../utils/constants";
import { px } from "./PixelRenderer";

export interface BuildingSpec {
  x: number; // world px, top-left of walls
  y: number;
  w: number; // wall width in grid units
  h: number; // wall height in grid units
  roofColor?: string;
  label?: string;
  night?: boolean; // warm window glow at night
}

export function drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingSpec): void {
  const gx = b.x / PX;
  const gy = b.y / PX;
  const roof = b.roofColor ?? PALETTE.roofs[0];

  // Roof: wider rectangle on top, with a ridge highlight
  px(ctx, gx - 1, gy - 4, b.w + 2, 4, roof);
  px(ctx, gx - 1, gy - 4, b.w + 2, 1, PALETTE.roofs[1]);

  // Walls
  px(ctx, gx, gy, b.w, b.h, PALETTE.walls[0]);
  px(ctx, gx, gy, b.w, 1, PALETTE.walls[1]); // eave shadow line

  // Door at bottom center
  const doorW = 2;
  const doorX = gx + Math.floor(b.w / 2) - 1;
  px(ctx, doorX, gy + b.h - 3, doorW, 3, "#2c1810");

  // Windows: one either side of the door
  const glow = b.night ? "#ffd98a" : "#3a3a52";
  if (b.w >= 8) {
    px(ctx, gx + 1, gy + b.h - 4, 2, 2, glow);
    px(ctx, gx + b.w - 3, gy + b.h - 4, 2, 2, glow);
  }

  // Label above roof
  if (b.label) {
    ctx.fillStyle = PALETTE.textLight;
    ctx.font = `${3 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(b.label, (gx + b.w / 2) * PX, (gy - 5) * PX);
    ctx.textAlign = "left";
  }
}
