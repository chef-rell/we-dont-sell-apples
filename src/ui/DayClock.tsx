// Sun/moon day clock (issue #52). The day drives everything — the morning
// rush, the afternoon cart, the evening loot wave — but the HUD only ever said
// "Day 3 · morning", which tells the player nothing about how much of the
// morning is left. This shows the whole cycle at a glance: the sun arcs across
// the sky, hands over to the moon at dusk, and phase notches on the horizon
// show how far the current phase runs.
//
// Read-only: it renders state.timeOfDay and nothing else.

import { useEffect, useRef, useState } from "react";
import { dayProgress, isNightSky } from "../game/DayNightCycle";
import type { GameEngine } from "../game/GameEngine";
import { rect } from "../rendering/PixelRenderer";
import type { DayPhase } from "../types";
import { DAY_SKY, PALETTE, PHASE_BOUNDS, PX } from "../utils/constants";

// Widget geometry, on the 4px grid like everything else. Drawn and displayed
// at 1:1 so the pixels stay crisp — downscaling pixel art by half muddies it.
const W = 132;
const H = 32;
const HORIZON = 24; // ground line
const ARC_TOP = 6; // highest the disc climbs
const EDGE = 12; // inset so the disc never clips at dawn/midnight
const DISC = 4; // disc half-size

export function DayClock({ engine }: { engine: GameEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  // The day takes ten real minutes, so a slow poll is plenty.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    drawClock(ctx, engine.state.timeOfDay, engine.state.phase);
  }, [engine, tick]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      title="Time of day"
      style={{ width: W, height: H, imageRendering: "pixelated", display: "block" }}
    />
  );
}

function drawClock(ctx: CanvasRenderingContext2D, timeOfDay: number, phase: DayPhase) {
  const t = dayProgress(timeOfDay);

  // ---- Sky and ground ----
  rect(ctx, 0, 0, W, H, DAY_SKY[phase]);
  rect(ctx, 0, HORIZON, W, H - HORIZON, "#2c1f18");
  rect(ctx, 0, HORIZON, W, PX, PALETTE.wood[0]);

  // Stars once the sun is down — the same cue the wilderness sky uses.
  if (phase === "night" || phase === "evening") {
    for (const [sx, sy] of [
      [20, 10],
      [52, 6],
      [84, 13],
      [112, 8],
    ]) {
      rect(ctx, sx, sy, PX, PX, "#8a9ab8");
    }
  }

  // ---- Phase notches on the horizon ----
  // These are what make "how much morning is left" readable: the gap between
  // the disc and the NEXT notch is the answer, so that one is picked out in
  // gold rather than the boundary already passed.
  const upcoming = Object.values(PHASE_BOUNDS)
    .map(([start]) => start)
    .filter((start) => start > t)
    .sort((a, b) => a - b)[0];
  for (const [start] of Object.values(PHASE_BOUNDS)) {
    if (start === 0) continue;
    const x = EDGE + start * (W - EDGE * 2);
    rect(ctx, x, HORIZON - 4, PX, 4, start === upcoming ? PALETTE.gold : "#5a4636");
  }

  // ---- Sun or moon, arcing across the day ----
  const x = EDGE + t * (W - EDGE * 2);
  const y = HORIZON - Math.sin(Math.PI * t) * (HORIZON - ARC_TOP);
  if (isNightSky(phase)) drawMoon(ctx, x, y);
  else drawSun(ctx, x, y);
}

/** A round-ish disc: two crossed bands, which on a 4px grid reads as a circle
 *  at this size without a single diagonal. Bands are half the disc's width, so
 *  the shape holds at any r (an earlier inset-based version collapsed to
 *  nothing when r equalled the pixel size — the moon vanished entirely). */
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  rect(ctx, x - r, y - r / 2, r * 2, r, color); // horizontal band
  rect(ctx, x - r / 2, y - r, r, r * 2, color); // vertical band
}

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number) {
  disc(ctx, x, y, DISC + PX, "#8a6f2a"); // soft glow, one step out
  disc(ctx, x, y, DISC, PALETTE.gold);
  rect(ctx, x - DISC / 2, y - DISC / 2, PX, PX, "#f4dc9a"); // highlight
}

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // A full moon with a crater rather than a crescent: at eight pixels across,
  // a bite big enough to see is a bite big enough to eat the disc, and grid
  // snapping made it land differently at every position along the arc.
  // Pale against a dark sky, with no glow, already reads as "not the sun".
  disc(ctx, x, y, DISC, "#d8dcf0");
  rect(ctx, x - DISC / 2, y - DISC / 2, PX, PX, "#a8b0cc"); // crater
}
