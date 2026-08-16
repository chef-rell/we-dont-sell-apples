// Wilderness View (spec §3c): the ground outside town, where the player is a
// spectator and nothing else. Adventurers who left through the gate appear in
// the area they chose, with the gear the player sold them, and the day's
// resolved fights play out as results — "I sold Bren that iron sword; is it
// good enough for this?" is the whole point of the screen.
//
// Combat is decided in Combat.ts before this view ever sees it (§8). Nothing
// here rolls, decides, or alters an outcome — it only shows what happened.

import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { chooseArea } from "../game/Combat";
import { phaseFor } from "../game/DayNightCycle";
import type { GameEngine } from "../game/GameEngine";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { drawMonster, MONSTER_CELL } from "../rendering/MonsterRenderer";
import { hash2d, px, rect } from "../rendering/PixelRenderer";
import type { Adventurer, AdventureOutcome, WildernessArea } from "../types";
import { PALETTE, PX, WORLD_H, WORLD_W } from "../utils/constants";

const HORIZON = 150; // sky/ground split
const MID_X = WORLD_W / 2; // forest edge on the left, shadow cave on the right
const CHAR_H = 64;
const MONSTER_PX = MONSTER_CELL * PX;
const LOG_Y = WORLD_H - 130; // outcome log panel
const LOG_X = 16; // left inset for log text
const CHAT_CSS_WIDTH = 312; // ChatPanel's width plus its right margin, in CSS px

// Each area stages up to four adventurer-vs-monster pairs: two on a back line
// and two nearer the viewer, offset so a full area still reads clearly.
const BACK_Y = 372;
const FRONT_Y = 466;
const SLOTS: { dx: number; y: number }[] = [
  { dx: 70, y: BACK_Y },
  { dx: 250, y: BACK_Y },
  { dx: 20, y: FRONT_Y },
  { dx: 200, y: FRONT_Y },
];

export function WildernessView({
  engine,
  onLeave,
}: {
  engine: GameEngine;
  onLeave: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    const frame = (now: number) => {
      renderWilderness(ctx, engine, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // Clicking anywhere on the left/right ground is inert — this view is
  // spectator-only (§3c). The button is the only control.
  const noop = (_e: ReactMouseEvent<HTMLCanvasElement>) => {};

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: WORLD_W, margin: "0 auto" }}>
      <canvas
        ref={canvasRef}
        width={WORLD_W}
        height={WORLD_H}
        onClick={noop}
        style={{ width: "100%", imageRendering: "pixelated", display: "block" }}
      />
      <button
        onClick={onLeave}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: PALETTE.uiDark,
          border: `2px solid ${PALETTE.uiBorder}`,
          color: PALETTE.textLight,
          fontFamily: "monospace",
          fontSize: 15,
          padding: "6px 12px",
          cursor: "pointer",
        }}
      >
        ← Town
      </button>
    </div>
  );
}

export function renderWilderness(
  ctx: CanvasRenderingContext2D,
  engine: GameEngine,
  now: number,
) {
  const s = engine.state;

  drawSky(ctx, s.timeOfDay);
  drawForestEdge(ctx);
  drawShadowCave(ctx);

  // Everyone currently out of town, split by the area they chose today.
  const out = s.adventurers.filter(
    (a) => a.alive && (a.state === "adventuring" || a.state === "fighting"),
  );
  const todaysOutcomes = s.recentOutcomes.filter((o) => o.day === s.day);
  const outcomeFor = (a: Adventurer) => todaysOutcomes.find((o) => o.adventurerId === a.id) ?? null;

  const byArea: Record<WildernessArea, Adventurer[]> = { forest_edge: [], shadow_cave: [] };
  for (const a of out) {
    // The same deterministic choice the sim made, imported read-only.
    const area = outcomeFor(a)?.area ?? chooseArea(a, s.day);
    byArea[area].push(a);
  }

  drawArea(ctx, "forest_edge", byArea.forest_edge, outcomeFor, now);
  drawArea(ctx, "shadow_cave", byArea.shadow_cave, outcomeFor, now);

  // The fallen are shown where they fell, until the day rolls over. Spaced
  // out per area so a bad day doesn't stack every headstone on one spot.
  const fallenByArea: Record<WildernessArea, number> = { forest_edge: 0, shadow_cave: 0 };
  for (const o of todaysOutcomes.filter((x) => !x.survived)) {
    drawGrave(ctx, o, fallenByArea[o.area]);
    fallenByArea[o.area] += 1;
  }

  drawLog(ctx, s.recentOutcomes, out.length, s.phase);
}

// ---------- terrain ----------

/** Sky colour tracks the clock — the wilderness is outdoors, and dusk out here
 *  is the part of the day the player is usually watching. */
function skyColors(timeOfDay: number): { sky: string; band: string; stars: boolean } {
  const phase = phaseFor(timeOfDay);
  switch (phase) {
    case "dawn":
      return { sky: "#4a3a58", band: "#8a5a52", stars: false };
    case "morning":
      return { sky: "#5a7a9a", band: "#7a9ab4", stars: false };
    case "afternoon":
      return { sky: "#6a8aa8", band: "#8aa8c0", stars: false };
    case "evening":
      return { sky: "#2a3a52", band: "#3a4a62", stars: true };
    case "night":
      return { sky: "#141b2e", band: "#1e2740", stars: true };
  }
}

function drawSky(ctx: CanvasRenderingContext2D, timeOfDay: number) {
  const { sky, band, stars } = skyColors(timeOfDay);
  rect(ctx, 0, 0, WORLD_W, HORIZON, sky);
  rect(ctx, 0, HORIZON - 12, WORLD_W, 12, band);
  if (!stars) return;
  // A few stars on the cave side, so the two halves read differently
  for (let i = 0; i < 14; i++) {
    const x = MID_X + ((hash2d(i, 3, 7) * 1000) % (MID_X - 40));
    const y = 20 + ((hash2d(i, 9, 11) * 1000) % (HORIZON - 60));
    rect(ctx, x, y, PX, PX, "#8a9ab8");
  }
}

function drawForestEdge(ctx: CanvasRenderingContext2D) {
  rect(ctx, 0, HORIZON, MID_X, WORLD_H - HORIZON, PALETTE.grass[0]);
  // Grass texture
  for (let gx = 0; gx < MID_X; gx += 24) {
    for (let gy = HORIZON; gy < WORLD_H; gy += 24) {
      if (hash2d(gx, gy, 2) > 0.6) rect(ctx, gx, gy, 12, 12, PALETTE.grass[1]);
    }
  }
  // Tree line along the back
  for (let i = 0; i < 7; i++) {
    const x = 30 + i * 62 + (hash2d(i, 5, 1) * 20 - 10);
    drawTree(ctx, x, HORIZON + 30 + hash2d(i, 8, 4) * 20);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x + 12, y + 34, 8, 22, PALETTE.wood[0]); // trunk
  rect(ctx, x, y, 32, 38, "#2f5a2c"); // canopy
  rect(ctx, x + 4, y - 8, 24, 12, "#3a6b35");
  rect(ctx, x + 4, y + 4, 10, 10, "#4a7a45"); // highlight
}

function drawShadowCave(ctx: CanvasRenderingContext2D) {
  rect(ctx, MID_X, HORIZON, MID_X, WORLD_H - HORIZON, "#4a4438"); // scree
  for (let gx = MID_X; gx < WORLD_W; gx += 24) {
    for (let gy = HORIZON; gy < WORLD_H; gy += 24) {
      if (hash2d(gx, gy, 6) > 0.65) rect(ctx, gx, gy, 12, 12, "#3d382e");
    }
  }
  // Cliff face with the cave mouth cut into it. Darker than the town's stone
  // so the cave side reads as somewhere you'd think twice about entering.
  const cliffX = MID_X + 40;
  const cliffW = WORLD_W - MID_X - 80;
  rect(ctx, cliffX, HORIZON - 30, cliffW, 200, "#565049");
  rect(ctx, cliffX, HORIZON - 30, cliffW, PX * 2, "#6b645a"); // lit top edge
  rect(ctx, cliffX, HORIZON + 160, cliffW, PX * 2, "#3d382e"); // base shadow
  for (let i = 0; i < 6; i++) {
    // Cracks, so the face isn't a flat slab
    const cx = cliffX + 24 + i * (cliffW / 6);
    rect(ctx, cx, HORIZON - 10 + hash2d(i, 4, 3) * 40, PX, 40 + hash2d(i, 7, 2) * 40, "#484239");
  }
  const mouthX = MID_X + 160;
  rect(ctx, mouthX, HORIZON + 40, 120, 130, "#14121a"); // the dark
  rect(ctx, mouthX + 16, HORIZON + 20, 88, 32, "#14121a"); // arched top
  rect(ctx, mouthX - PX, HORIZON + 40, PX, 130, "#3d382e"); // mouth edges
  rect(ctx, mouthX + 120, HORIZON + 40, PX, 130, "#3d382e");
  // Boulders
  for (let i = 0; i < 5; i++) {
    const x = MID_X + 30 + i * 80;
    const y = 330 + hash2d(i, 2, 9) * 60;
    rect(ctx, x, y, 28, 18, "#5a544b");
    rect(ctx, x, y, 28, PX, "#6b645a");
  }
}

// ---------- inhabitants ----------

function drawArea(
  ctx: CanvasRenderingContext2D,
  area: WildernessArea,
  adventurers: Adventurer[],
  outcomeFor: (a: Adventurer) => AdventureOutcome | null,
  now: number,
) {
  const left = area === "forest_edge" ? 40 : MID_X + 40;
  const label = area === "forest_edge" ? "FOREST EDGE" : "SHADOW CAVE";

  ctx.font = `${4 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textLight;
  ctx.fillText(label, left + 200, HORIZON - 60);
  ctx.textAlign = "left";

  // Back line first so the nearer pairs overlap it. Past four in one area the
  // slots are reused, nudged along so nobody stands exactly on top of anyone.
  const staged = adventurers.map((a, i) => {
    const slot = SLOTS[i % SLOTS.length];
    const wrap = Math.floor(i / SLOTS.length);
    return { a, slot: { dx: slot.dx + wrap * 26, y: slot.y } };
  });
  for (const { a, slot } of [...staged].sort((p, q) => p.slot.y - q.slot.y)) {
    drawFight(ctx, a, outcomeFor(a), left + slot.dx, slot.y, now);
  }
}

function drawFight(
  ctx: CanvasRenderingContext2D,
  a: Adventurer,
  outcome: AdventureOutcome | null,
  x: number,
  y: number,
  now: number,
) {
  // Adventurer, mid-stride so they read as moving through the area.
  const frame: 0 | 1 = Math.floor(now / 220) % 2 === 0 ? 0 : 1;
  rect(ctx, x - 16, y - PX, 40, PX, "#1e1a14"); // shadow
  drawCharacter(ctx, a, x - 20, y - CHAR_H, frame);

  // Name + HP bar (§3c: names, HP, what they're carrying)
  ctx.font = `${3 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textLight;
  ctx.fillText(a.name.split(" ")[0], x, y - CHAR_H - 32);
  drawHpBar(ctx, x - 24, y - CHAR_H - 24, a.hp / a.maxHp);
  ctx.textAlign = "left";

  // Their weapon is the player's handiwork — call it out.
  const weapon = a.equipment.weapon?.name;
  if (weapon) {
    ctx.font = `${2.5 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(weapon, x, y + 16);
    ctx.textAlign = "left";
  }

  if (!outcome) return; // still out there; the fight resolves in the evening

  // The monster they met, and how it went.
  const mx = x + 76;
  drawMonster(ctx, outcome.monsterName, mx, y - MONSTER_PX);
  // Combat effects: slashes across a monster that went down, and a bruise of
  // impact marks on the adventurer when they took a beating.
  if (outcome.monsterDefeated) drawSlashes(ctx, mx, y - MONSTER_PX);
  if (outcome.damageTaken >= 10) drawImpacts(ctx, x, y - CHAR_H);
  ctx.font = `${2.5 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText(outcome.monsterName, mx + MONSTER_PX / 2, y + 16);

  const verdict =
    !outcome.survived ? "FELL"
    : outcome.monsterDefeated ? "SLAIN"
    : "DROVE IT OFF";
  ctx.font = `${3 * PX}px monospace`;
  ctx.fillStyle =
    !outcome.survived ? "#c0392b"
    : outcome.monsterDefeated ? "#5bbf5b"
    : "#d9b93a";
  ctx.fillText(verdict, mx + MONSTER_PX / 2, y - MONSTER_PX - 12);
  ctx.textAlign = "left";

  // Loot sparkles for what they're bringing home.
  if (outcome.lootItemKeys.length > 0) {
    for (let i = 0; i < outcome.lootItemKeys.length; i++) {
      const twinkle = Math.floor(now / 300 + i) % 2 === 0;
      const sx = mx + 8 + i * 16;
      const sy = y - MONSTER_PX - 32 - (twinkle ? PX : 0);
      rect(ctx, sx, sy, PX * 2, PX * 2, twinkle ? PALETTE.gold : "#f4dc9a");
    }
  }
}

/** Two diagonal cuts across a monster that lost the fight. */
function drawSlashes(ctx: CanvasRenderingContext2D, x: number, y: number) {
  for (const offset of [0, 20]) {
    for (let step = 0; step < 8; step++) {
      rect(ctx, x + 6 + offset + step * PX, y + 8 + step * PX, PX, PX, "#f0e6d3");
    }
  }
}

/** Impact marks — they took a real hit out there. Static: a wound that blinks
 *  reads as a rendering glitch, not an injury. */
function drawImpacts(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x - 12, y + 20, PX * 2, PX * 2, "#c0392b");
  rect(ctx, x + 8, y + 36, PX, PX, "#c0392b");
  rect(ctx, x - 4, y + 44, PX, PX, "#8f2a20");
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, ratio: number) {
  const w = 48;
  const clamped = Math.max(0, Math.min(1, ratio));
  rect(ctx, x, y, w, 8, "#1e1a14");
  rect(
    ctx,
    x + PX / 2,
    y + PX / 2,
    Math.max(0, (w - PX) * clamped),
    8 - PX,
    clamped > 0.5 ? "#5bbf5b"
    : clamped > 0.25 ? "#d9b93a"
    : "#c0392b",
  );
}

function drawGrave(ctx: CanvasRenderingContext2D, outcome: AdventureOutcome, index: number) {
  const base = outcome.area === "forest_edge" ? 380 : MID_X + 380;
  const x = base - index * 44; // headstones line up back along the ground
  const y = FRONT_Y - 32;
  px(ctx, x / PX, y / PX, 6, 8, PALETTE.stone[1]); // headstone
  px(ctx, x / PX + 1, y / PX - 1, 4, 1, PALETTE.stone[0]);
  px(ctx, x / PX + 2, y / PX + 2, 2, 5, "#3d382e"); // cross groove
  px(ctx, x / PX + 1, y / PX + 3, 4, 1, "#3d382e");
}

// ---------- outcome log ----------

function drawLog(
  ctx: CanvasRenderingContext2D,
  outcomes: AdventureOutcome[],
  outCount: number,
  phase: string,
) {
  rect(ctx, 0, LOG_Y, WORLD_W, WORLD_H - LOG_Y, "rgba(16,16,28,0.86)");
  rect(ctx, 0, LOG_Y, WORLD_W, PX, PALETTE.uiBorder);

  ctx.font = `${3 * PX}px monospace`;
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.textDim;
  // The chat panel is docked over the bottom-right of the stage, so log lines
  // stop short of it rather than running underneath. It is sized in CSS pixels
  // while this canvas is in world pixels, so convert: a smaller window scales
  // the canvas down and the panel covers proportionally more of the world.
  const scale = WORLD_W / (ctx.canvas.clientWidth || WORLD_W);
  const textWidth = WORLD_W - LOG_X - CHAT_CSS_WIDTH * scale;
  // Night owls head out after dark and resolve at dawn, so the copy can't
  // assume everything happens on the afternoon-to-evening schedule.
  const night = phase === "night";
  ctx.fillText(
    outCount > 0 ?
      `${outCount} ${outCount === 1 ? "adventurer is" : "adventurers are"} out here · ` +
        (night ? "night runs resolve at dawn" : "fights resolve in the evening")
    : night ?
      "Quiet out here — only night owls go out after dark"
    : `Nobody is out here right now — they head through the gate in the afternoon (${phase})`,
    LOG_X,
    LOG_Y + 28,
  );

  // Most recent first: what happened, and the AI's line when it has arrived.
  const recent = [...outcomes].reverse().slice(0, 3);
  recent.forEach((o, i) => {
    const y = LOG_Y + 56 + i * 24;
    ctx.fillStyle = o.survived ? PALETTE.textLight : "#c0392b";
    const summary =
      o.narration ??
      `${o.monsterDefeated ? "Defeated" : "Escaped"} ${o.monsterName}` +
        `${o.damageTaken > 0 ? `, took ${o.damageTaken} damage` : " without a scratch"}` +
        `${o.lootItemKeys.length > 0 ? `, found ${o.lootItemKeys.length} item(s)` : ""}`;
    ctx.fillText(fit(ctx, `Day ${o.day}: ${summary}`, textWidth), LOG_X, y);
  });
}

/** Trim to what actually fits, measured rather than guessed at a character
 *  count — AI narration is free-form and can be any length. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}
