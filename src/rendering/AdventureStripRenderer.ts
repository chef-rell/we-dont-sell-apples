// Placeholder adventure-strip renderer (spec V2.3, issue #77). The real
// AdventureScript playback (V2.5) lands in issue #78 and takes over this
// exact contract: renderStripPlaceholder(ctx, state, now) draws into a
// WORLD_W x STRIP_H canvas exactly like every other view's draw function,
// reads state read-only, and uses `now` for idle animation only — never for
// anything that decides an outcome (§6, carried into V2.2 as "the renderer
// never decides outcomes"). This keeps the bottom panel from reading as a
// dead box while the layout and canvas contract land first.

import { hash2d, rect } from "./PixelRenderer";
import type { DayPhase, GameState } from "../types";
import { PALETTE, PX, STRIP_H, WORLD_W } from "../utils/constants";

const ROAD_Y = STRIP_H - 56;
const CLOUD_COUNT = 4;

export function renderStripPlaceholder(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  now: number,
): void {
  rect(ctx, 0, 0, WORLD_W, STRIP_H, bandColor(state.phase));

  for (let i = 0; i < CLOUD_COUNT; i++) drawCloud(ctx, i, now);

  // A road, so the empty band reads as a place the party will march down —
  // not a void. #78 replaces the whole draw; the road stays a fixture.
  rect(ctx, 0, ROAD_Y, WORLD_W, PX * 3, "#3d3428");
  rect(ctx, 0, ROAD_Y, WORLD_W, PX, "#5a4636");
  for (let x = -48; x < WORLD_W + 48; x += 56) {
    const dashX = ((x + now * 0.012) % (WORLD_W + 96)) - 48;
    rect(ctx, dashX, ROAD_Y + PX * 4, 26, PX, "#8b6914");
  }

  ctx.font = `${3 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText("the road awaits — adventure strip arrives in #78", WORLD_W / 2, STRIP_H / 2 - 10);
  ctx.textAlign = "left";
}

function bandColor(phase: DayPhase): string {
  switch (phase) {
    case "dawn":
      return "#332a42";
    case "morning":
      return "#33465a";
    case "afternoon":
      return "#3a5468";
    case "evening":
      return "#251f36";
    case "night":
      return "#0f1424";
  }
}

/** A slow drifting cloud rect, position derived from a stable per-cloud seed
 *  plus elapsed time — the same idiom WildernessView uses for its stars and
 *  walk frames: hash2d for stable layout, `now` for the only thing that
 *  moves (spec's determinism rule binds §6 verdicts and combat math, not
 *  idle ambience — see CLAUDE.md gotchas). */
function drawCloud(ctx: CanvasRenderingContext2D, i: number, now: number): void {
  const w = 70 + hash2d(i, 2, 5) * 40;
  const speed = 4 + hash2d(i, 6, 1) * 5; // world px per second, roughly
  const startX = hash2d(i, 11, 3) * (WORLD_W + w * 2);
  const x = ((startX + (now / 1000) * speed) % (WORLD_W + w * 2)) - w;
  const y = 14 + hash2d(i, 4, 9) * 48;
  const h = w * 0.32;
  rect(ctx, x, y, w, h, "rgba(240,230,211,0.05)");
  rect(ctx, x + w * 0.22, y - h * 0.35, w * 0.56, h, "rgba(240,230,211,0.05)");
}
