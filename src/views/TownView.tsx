// Town View: isometric pixel scene with buildings, paths, trees, and
// wandering adventurers (spec WDSA-v2-spec.md V2.4, issue #70). Owns a
// canvas + rAF loop for drawing only — App.tsx owns the single engine.tick
// loop (issue #55).
//
// Render-layer pivot only: game logic, movement, and the building registry
// all stay in orthogonal world coordinates (960x640, unchanged). This
// module projects world -> screen for drawing (src/rendering/iso.ts) and
// screen -> world for clicks. `GameState.buildings` is read directly — the
// legacy TOWN shim in GameEngine.ts is gone (spec V2.15 note 2).

import { useEffect, useRef, type MouseEvent } from "react";
import type { GameEngine } from "../game/GameEngine";
import { skyTint } from "../game/DayNightCycle";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { depthKey, drawIsoBlock, isoFacing, project, shade, unproject } from "../rendering/iso";
import { hash2d, rect } from "../rendering/PixelRenderer";
import type { AdventurerState, TownBuilding } from "../types";
import { PALETTE, PX, WORLD_H, WORLD_W } from "../utils/constants";
import { getBuilding, worldPointToBuilding } from "../utils/TownBuildings";

// States where the adventurer is outdoors in town and belongs in this scene.
// `resting` stays in: they're indoors, but the sprite by their house reads as
// "home" and keeps the town looking inhabited at dawn and night.
const IN_TOWN: AdventurerState[] = [
  "resting",
  "wandering",
  "heading_to_shop",
  "heading_to_gate",
  "returning",
];

export function TownView({
  engine,
  onEnterShop,
  onEnterWilderness,
}: {
  engine: GameEngine;
  onEnterShop: () => void;
  onEnterWilderness: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Clicking the shop building enters the Shop View; clicking the east gate
  // follows the adventurers out to the Wilderness View. The canvas is CSS-
  // scaled to fit the window but its internal resolution is still the
  // WORLD_W x WORLD_H screen-projection space iso.ts draws into, so a CSS
  // click maps 1:1 onto (sx, sy) — unproject() then turns that into world
  // coords for the existing building-registry hit test.
  const handleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * WORLD_W;
    const sy = ((e.clientY - r.top) / r.height) * WORLD_H;
    const { wx, wy } = unproject(sx, sy);
    const hit = worldPointToBuilding(engine.state.buildings, wx, wy);
    if (hit?.id === "shop") {
      onEnterShop();
    } else if (hit?.id === "gate") {
      onEnterWilderness();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;

    const frame = (now: number) => {
      render(ctx, engine, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <canvas
      ref={canvasRef}
      width={WORLD_W}
      height={WORLD_H}
      onClick={handleClick}
      style={{
        width: "100%",
        maxWidth: WORLD_W,
        imageRendering: "pixelated",
        display: "block",
        margin: "0 auto",
        cursor: "pointer",
      }}
    />
  );
}

// ---------- geometry helpers ----------

type Rect = { x: number; y: number; w: number; h: number };
type GroundKind = "grass" | "dirt" | "stone";

const TILE = 32; // world px per ground tile (960/32 = 30 cols, 640/32 = 20 rows, exact)
const PATH_W = 28; // corridor width, world px

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Two axis-aligned rects (an L-shaped corridor: horizontal then vertical)
 *  connecting two points — straight segments, same shape the old flat-view
 *  drawPath used, just returned as hit-testable rects instead of drawn
 *  directly. */
function corridorRects(from: { x: number; y: number }, to: { x: number; y: number }, w: number): Rect[] {
  const x1 = Math.min(from.x, to.x);
  const x2 = Math.max(from.x, to.x);
  const y1 = Math.min(from.y, to.y);
  const y2 = Math.max(from.y, to.y);
  return [
    { x: x1, y: from.y - w / 2, w: x2 - x1 + w, h: w },
    { x: to.x - w / 2, y: y1, w, h: y2 - y1 + w },
  ];
}

function tileKind(x: number, y: number, corridors: Rect[], plaza: Rect): GroundKind {
  if (inRect(x, y, plaza)) return "stone";
  if (corridors.some((r) => inRect(x, y, r))) return "dirt";
  return "grass";
}

function nearAnyBuilding(x: number, y: number, buildings: TownBuilding[]): boolean {
  return buildings.some((b) => {
    const anchor = b.door ?? { x: b.footprint.x + b.footprint.w / 2, y: b.footprint.y + b.footprint.h / 2 };
    return Math.abs(anchor.x - x) < 120 && Math.abs(anchor.y - y) < 100;
  });
}

// ---------- drawables ----------

interface Drawable {
  key: number;
  draw: () => void;
}

interface BuildingVisual {
  x: number; // wall footprint, world units (NOT the registry's click footprint —
  y: number; // shop's click region is deliberately generous, spec V2.15 note 3)
  w: number;
  h: number;
  wallH: number;
  roofH: number;
  roofColor: string;
  label?: string;
}

/** Visual box per building kind. Tavern/house reuse their registry
 *  footprint verbatim (it already IS their true wall box). The shop's
 *  footprint is click-test slack, not its wall box, so its visual box is
 *  derived from `door` instead — same relationship the old TOWN shim used
 *  (door = anchor + fixed offset), just inverted (anchor = door - offset). */
function buildingVisual(b: TownBuilding): BuildingVisual | null {
  switch (b.kind) {
    case "shop": {
      const door = b.door ?? { x: b.footprint.x, y: b.footprint.y };
      return {
        x: door.x - 36,
        y: door.y - 60,
        w: 80,
        h: 56,
        wallH: 84,
        roofH: 26,
        roofColor: PALETTE.gold,
        label: "SHOP",
      };
    }
    case "tavern":
      return {
        x: b.footprint.x,
        y: b.footprint.y,
        w: b.footprint.w,
        h: b.footprint.h,
        wallH: 64,
        roofH: 22,
        roofColor: PALETTE.roofWarm,
        label: "TAVERN",
      };
    case "house":
      return {
        x: b.footprint.x,
        y: b.footprint.y,
        w: b.footprint.w,
        h: b.footprint.h,
        wallH: 46,
        roofH: 18,
        roofColor: PALETTE.roofs[0],
      };
    default:
      return null; // square and gate are drawn separately below
  }
}

function drawBuildingBlock(ctx: CanvasRenderingContext2D, v: BuildingVisual, night: boolean): void {
  const wallBase = PALETTE.walls[0];
  drawIsoBlock(ctx, v.x, v.y, v.w, v.h, v.wallH, wallBase);

  // Door: dark mark at the front (south) ground corner, on the visible face.
  const pS = project(v.x + v.w, v.y + v.h);
  const dw = 8;
  const dh = 16;
  ctx.fillStyle = shade(wallBase, -0.6);
  ctx.fillRect(pS.sx - dw / 2, pS.sy - dh, dw, dh);

  // Windows: one on each visible face, glowing at night.
  const pE = project(v.x + v.w, v.y);
  const pW = project(v.x, v.y + v.h);
  const glow = night ? PALETTE.windowLit : PALETTE.windowDark;
  const winSize = 6;
  const winLift = v.wallH * 0.55;
  ctx.fillStyle = glow;
  ctx.fillRect((pW.sx + pS.sx) / 2 - winSize / 2, (pW.sy + pS.sy) / 2 - winLift - winSize / 2, winSize, winSize);
  ctx.fillRect((pS.sx + pE.sx) / 2 - winSize / 2, (pS.sy + pE.sy) / 2 - winLift - winSize / 2, winSize, winSize);

  // Roof: overhanging eave, stacked on top of the walls.
  const overhang = 8;
  drawIsoBlock(
    ctx,
    v.x - overhang,
    v.y - overhang,
    v.w + overhang * 2,
    v.h + overhang * 2,
    v.roofH,
    v.roofColor,
    v.wallH,
  );

  if (v.label) {
    const top = project(v.x + v.w / 2, v.y + v.h / 2);
    ctx.fillStyle = PALETTE.textLight;
    ctx.font = `${3 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(v.label, top.sx, top.sy - v.wallH - v.roofH - 6);
    ctx.textAlign = "left";
  }
}

function drawGatePillar(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  drawIsoBlock(ctx, cx - size / 2, cy - size / 2, size, size, 88, PALETTE.stone[0]);
}

function drawFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const basin = 28;
  drawIsoBlock(ctx, cx - basin / 2, cy - basin / 2, basin, basin, 14, PALETTE.stone[0]);
  const water = 16;
  drawIsoBlock(ctx, cx - water / 2, cy - water / 2, water, water, 8, PALETTE.water, 14);
}

function drawTree(ctx: CanvasRenderingContext2D, tx: number, ty: number): void {
  const trunk = 8;
  drawIsoBlock(ctx, tx - trunk / 2, ty - trunk / 2, trunk, trunk, 16, PALETTE.wood[0]);
  const canopy = 26;
  drawIsoBlock(ctx, tx - canopy / 2, ty - canopy / 2, canopy, canopy, 22, PALETTE.foliage, 16);
}

function drawGroundTile(ctx: CanvasRenderingContext2D, wx: number, wy: number, size: number, color: string): void {
  const pN = project(wx, wy);
  const pE = project(wx + size, wy);
  const pS = project(wx + size, wy + size);
  const pW = project(wx, wy + size);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pN.sx, pN.sy);
  ctx.lineTo(pE.sx, pE.sy);
  ctx.lineTo(pS.sx, pS.sy);
  ctx.lineTo(pW.sx, pW.sy);
  ctx.closePath();
  ctx.fill();
}

// ---------- main render ----------

function render(ctx: CanvasRenderingContext2D, engine: GameEngine, now: number) {
  const s = engine.state;
  const night = s.phase === "night" || s.phase === "evening";
  const buildings = s.buildings;

  // Backdrop behind the projected diamond (the world's four corners don't
  // reach the canvas's four corners — see iso.ts's header comment).
  rect(ctx, 0, 0, WORLD_W, WORLD_H, PALETTE.uiDark);

  // Square/plaza + fountain hub, and the dirt-path corridors radiating from
  // it to every other landmark (spec: "square hub connecting shop, tavern,
  // houses, gate", straight segments).
  const square = getBuilding(buildings, "square");
  const plaza: Rect = square
    ? { x: square.footprint.x - 60, y: square.footprint.y - 40, w: 160, h: 120 }
    : { x: 380, y: 240, w: 160, h: 120 };
  const hub = { x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h / 2 };

  const shop = getBuilding(buildings, "shop");
  const tavern = getBuilding(buildings, "tavern");
  const gate = getBuilding(buildings, "gate");
  const houses = buildings.filter((b) => b.kind === "house");

  const routeTargets: { x: number; y: number }[] = [];
  if (shop?.door) routeTargets.push(shop.door);
  if (tavern?.door) routeTargets.push(tavern.door);
  if (gate?.door) routeTargets.push(gate.door);
  for (const h of houses) routeTargets.push({ x: h.footprint.x + h.footprint.w / 2, y: h.footprint.y + h.footprint.h / 2 });
  const corridors = routeTargets.flatMap((t) => corridorRects(hub, t, PATH_W));

  // Ground tiles: iso diamonds over a 32-world-px grid, drawn first and
  // unsorted (flat — nothing occludes them).
  for (let cy = 0; cy * TILE < WORLD_H; cy++) {
    for (let cx = 0; cx * TILE < WORLD_W; cx++) {
      const wx = cx * TILE;
      const wy = cy * TILE;
      const kind = tileKind(wx + TILE / 2, wy + TILE / 2, corridors, plaza);
      const tones = kind === "stone" ? PALETTE.stone : kind === "dirt" ? PALETTE.dirt : PALETTE.grass;
      const seed = kind === "stone" ? 2 : kind === "dirt" ? 1 : 0;
      const color = hash2d(cx, cy, seed) > 0.65 ? tones[1] : tones[0];
      drawGroundTile(ctx, wx, wy, TILE, color);
    }
  }

  // Everything with height (buildings, gate pillars, fountain, trees,
  // characters) goes into one depth-sorted drawable list, painter's
  // algorithm ascending by depthKey of each object's ground anchor.
  const drawables: Drawable[] = [];

  for (const b of buildings) {
    const v = buildingVisual(b);
    if (!v) continue;
    const key = depthKey(v.x + v.w / 2, v.y + v.h / 2);
    drawables.push({ key, draw: () => drawBuildingBlock(ctx, v, night) });
  }

  // Gate: two stone pillars flanking the road, no slab between.
  if (gate) {
    const door = gate.door ?? { x: gate.footprint.x, y: gate.footprint.y };
    const pillarSize = 20;
    const gap = 44;
    const nCenter = { x: door.x, y: door.y - gap / 2 - pillarSize / 2 };
    const sCenter = { x: door.x, y: door.y + gap / 2 + pillarSize / 2 };
    drawables.push({
      key: depthKey(nCenter.x, nCenter.y),
      draw: () => drawGatePillar(ctx, nCenter.x, nCenter.y, pillarSize),
    });
    drawables.push({
      key: depthKey(sCenter.x, sCenter.y),
      draw: () => {
        drawGatePillar(ctx, sCenter.x, sCenter.y, pillarSize);
        const lbl = project(door.x, door.y);
        ctx.fillStyle = PALETTE.textLight;
        ctx.font = `${3 * PX}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText("GATE", lbl.sx, lbl.sy - 100);
        ctx.textAlign = "left";
      },
    });
  }

  if (square) {
    drawables.push({ key: depthKey(hub.x, hub.y), draw: () => drawFountain(ctx, hub.x, hub.y) });
  }

  // Trees scattered deterministically (same hash-jittered positions as the
  // old flat view), skipping anything that landed on a building or path.
  for (let i = 0; i < 24; i++) {
    const tx = Math.floor(hash2d(i, 7) * (WORLD_W - 60)) + 20;
    const ty = Math.floor(hash2d(i, 13) * (WORLD_H - 100)) + 40;
    if (nearAnyBuilding(tx, ty, buildings) || tileKind(tx, ty, corridors, plaza) !== "grass") continue;
    drawables.push({ key: depthKey(tx, ty), draw: () => drawTree(ctx, tx, ty) });
  }

  // Adventurers who are actually outdoors in town (issue #15): shoppers are
  // inside the shop and get drawn by ShopView, and adventurers are away in
  // the wilderness until evening — showing them loitering at the gate gives
  // away that nothing is happening out there (§2/§17).
  const walkFrame: 0 | 1 = Math.floor(now / 180) % 2 === 0 ? 0 : 1;
  const alive = s.adventurers.filter((a) => a.alive && IN_TOWN.includes(a.state));
  for (const a of alive) {
    const key = depthKey(a.position.x, a.position.y);
    drawables.push({
      key,
      draw: () => {
        // Billboard sprite, feet-anchored: project the world position, then
        // offset by half the sprite's width and its full height so the
        // sprite's feet land on the projected point.
        const { sx, sy } = project(a.position.x, a.position.y);
        const drawX = sx - 20;
        const drawY = sy - 64;
        drawCharacter(ctx, a, drawX, drawY, a.position.moving ? walkFrame : 0, isoFacing(a.position.facing));
        ctx.fillStyle = PALETTE.textLight;
        ctx.font = `${2.5 * PX}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(a.name.split(" ")[0], sx, drawY - PX);
        ctx.textAlign = "left";
      },
    });
  }

  drawables.sort((a, b) => a.key - b.key);
  for (const d of drawables) d.draw();

  // Day/night tint over everything — same technique as the old flat view:
  // a translucent overlay darkens every tile/face tone already painted, and
  // per-building window glow (above) handles the "lit windows at night"
  // half of the effect.
  const tint = skyTint(s.timeOfDay);
  if (tint.alpha > 0) {
    ctx.globalAlpha = tint.alpha;
    rect(ctx, 0, 0, WORLD_W, WORLD_H, tint.color);
    ctx.globalAlpha = 1;
  }
}
