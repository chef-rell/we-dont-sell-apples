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

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { GameEngine } from "../game/GameEngine";
import { skyTint } from "../game/DayNightCycle";
import { ITEM_DEFS } from "../entities/Item";
import { CHILD_SPRITE_H, drawCharacter } from "../rendering/CharacterRenderer";
import { depthKey, drawIsoBlock, isoFacing, project, shade, unproject } from "../rendering/iso";
import { hash2d, rect } from "../rendering/PixelRenderer";
import { Particles } from "../rendering/Particles";
import { BuildChip, BuildPanel } from "../ui/BuildPanel";
import { ForgePanel } from "../ui/ForgePanel";
import { StaffPanel } from "../ui/StaffPanel";
import type { AdventurerState, Item, TownBuilding } from "../types";
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
}: {
  engine: GameEngine;
  onEnterShop: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Which craft/build panel (if any) is open, mirroring ShopView's `corner`
  // pattern — the chip and building clicks both funnel through this one
  // piece of state so only one panel is ever open at a time.
  const [openPanel, setOpenPanel] = useState<"build" | "forge" | "staff" | null>(null);

  // Clicking the shop building enters the Shop View. The east gate used to
  // route to the Wilderness View; that screen is retired as of issue #78 —
  // the adventure strip panel is always visible and plays the day's
  // AdventureScript itself, so there is nowhere left to send a gate click.
  // The gate stays registered as `clickable: true` in the building registry
  // (src/utils/TownBuildings.ts) rather than being flipped off, since a
  // future phase (night-raid tavern beat, spec V2.15) may give it a job
  // again — for now it's just inert. The canvas is CSS-scaled to fit the
  // window but its internal resolution is still the WORLD_W x WORLD_H
  // screen-projection space iso.ts draws into, so a CSS click maps 1:1 onto
  // (sx, sy) — unproject() then turns that into world coords for the
  // existing building-registry hit test.
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
    } else if (hit?.kind === "forge") {
      setOpenPanel("forge");
    } else if (hit?.kind === "garden" || hit?.kind === "alchemy_lab") {
      // Judgment call (per issue #92's package spec): no dedicated
      // garden/lab panel exists — only BuildPanel/ForgePanel/StaffPanel do.
      // StaffPanel is the closest "right panel" for managing who works
      // these two buildings, so both route there until/unless a future
      // phase gives them bespoke panels.
      setOpenPanel("staff");
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
    <div style={{ position: "relative", width: "100%", maxWidth: WORLD_W, margin: "0 auto" }}>
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
      <div style={{ position: "absolute", top: 12, right: 12 }}>
        <BuildChip engine={engine} onOpen={() => setOpenPanel("build")} />
      </div>
      {openPanel && (
        <div style={{ position: "absolute", top: 52, right: 12 }}>
          {openPanel === "build" && (
            <BuildPanel
              engine={engine}
              onClose={() => setOpenPanel(null)}
              onOpenStaff={() => setOpenPanel("staff")}
            />
          )}
          {openPanel === "forge" && <ForgePanel engine={engine} onClose={() => setOpenPanel(null)} />}
          {openPanel === "staff" && <StaffPanel engine={engine} onClose={() => setOpenPanel(null)} />}
        </div>
      )}
    </div>
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

/** Flat projected diamond, optionally lifted `liftPx` above the ground
 *  plane (for a decoration drawn on top of an already-shaded face, per spec
 *  V2.4's "no unshaded flat rect ever appears in the world view" rule —
 *  ground tiles themselves are the one ground-plane exception; everything
 *  else layering a flat fill does so on top of a shaded box, same as
 *  drawBuildingBlock's door/window marks). */
function fillIsoQuad(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  wDepth: number,
  hDepth: number,
  color: string,
  liftPx = 0,
): void {
  const pN = project(wx, wy);
  const pE = project(wx + wDepth, wy);
  const pS = project(wx + wDepth, wy + hDepth);
  const pW = project(wx, wy + hDepth);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pN.sx, pN.sy - liftPx);
  ctx.lineTo(pE.sx, pE.sy - liftPx);
  ctx.lineTo(pS.sx, pS.sy - liftPx);
  ctx.lineTo(pW.sx, pW.sy - liftPx);
  ctx.closePath();
  ctx.fill();
}

function drawGroundTile(ctx: CanvasRenderingContext2D, wx: number, wy: number, size: number, color: string): void {
  fillIsoQuad(ctx, wx, wy, size, size, color);
}

// ---------- Craft buildings (spec V2.9/V2.4, issue #92) ----------
//
// Garden/alchemy_lab/forge get their own bespoke look rather than the
// generic `drawBuildingBlock` house-shape — `buildingVisual()` still
// returns null for these three kinds (see its switch above), and these
// draw functions are called directly from the same building loop in
// `render()`, pushed into the same depth-sorted `drawables` array. All
// three use `b.footprint` verbatim — unlike the shop, these buildings'
// footprint IS their real plot/wall box (see CRAFT_PLOTS in Property.ts),
// no door-offset math needed.

const GARDEN_INGREDIENT_NAMES: readonly string[] = [ITEM_DEFS.herb_bundle.name, ITEM_DEFS.moon_blossom.name];
const GARDEN_CROP_CAP = 8;
const GARDEN_ROWS = 4;
const GARDEN_LIFT = 3; // subtle raised-bed height, not a wall

/** Ingredients currently in the stockroom (herb_bundle + moon_blossom),
 *  clamped to the crop-fill cap — a read-only state observation, no engine
 *  changes. */
function gardenCropCount(inventory: Item[]): number {
  const count = inventory.filter((it) => GARDEN_INGREDIENT_NAMES.includes(it.name)).length;
  return Math.min(GARDEN_CROP_CAP, count);
}

/** Tilled diamond plot with furrow-row stripes and crop marks that fill in
 *  as garden ingredients accrue (spec: "crop rows that fill in as
 *  ingredients accrue"). A very-low `drawIsoBlock` gives it a subtle
 *  raised-bed silhouette distinct from the plain dirt path tiles already in
 *  the scene, rather than a flat fill. */
function drawGardenPlot(ctx: CanvasRenderingContext2D, footprint: Rect, inventory: Item[]): void {
  const { x, y, w, h } = footprint;
  drawIsoBlock(ctx, x, y, w, h, GARDEN_LIFT, PALETTE.dirt[0]);

  const rowH = h / GARDEN_ROWS;
  for (let r = 0; r < GARDEN_ROWS; r++) {
    const tone = r % 2 === 0 ? PALETTE.dirt[1] : shade(PALETTE.dirt[0], -0.15);
    fillIsoQuad(ctx, x, y + r * rowH, w, rowH - 1, tone, GARDEN_LIFT);
  }

  const cols = 4;
  const totalSlots = GARDEN_ROWS * cols;
  const filled = Math.round((gardenCropCount(inventory) / GARDEN_CROP_CAP) * totalSlots);
  let slot = 0;
  for (let r = 0; r < GARDEN_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (slot < filled) {
        const cx = x + (c + 0.5) * (w / cols);
        const cy = y + (r + 0.5) * rowH;
        const p = project(cx, cy);
        const cropSize = 5;
        ctx.fillStyle = PALETTE.foliage;
        ctx.fillRect(p.sx - cropSize / 2, p.sy - GARDEN_LIFT - cropSize, cropSize, cropSize);
      }
      slot++;
    }
  }
}

const LAB_WALL_H = 40;
const LAB_ROOF_H = 10;

/** Small block, purple accent + bottle sign (spec). `PALETTE.uiBorder`
 *  (#5c4a7a) is already purple-ish and reused verbatim here rather than
 *  adding a new PALETTE token — it reads fine at this scale. */
function drawAlchemyLab(ctx: CanvasRenderingContext2D, b: TownBuilding): void {
  const { x, y, w, h } = b.footprint;
  const wallColor = PALETTE.uiBorder;
  drawIsoBlock(ctx, x, y, w, h, LAB_WALL_H, wallColor);

  // Flat roof cap, stacked on the walls — same liftPx-stacking idiom as
  // drawBuildingBlock's roof.
  const overhang = 4;
  drawIsoBlock(
    ctx,
    x - overhang,
    y - overhang,
    w + overhang * 2,
    h + overhang * 2,
    LAB_ROOF_H,
    shade(wallColor, -0.25),
    LAB_WALL_H,
  );

  // Bottle sign: a tiny glass-bottle glyph hanging above the door —
  // decoration only, a handful of flat fills on top of the shaded roof.
  const anchor = b.door ?? { x: x + w / 2, y: y + h };
  const p = project(anchor.x, anchor.y);
  const signBaseY = p.sy - LAB_WALL_H - LAB_ROOF_H - 12;
  ctx.fillStyle = PALETTE.windowDark; // bottle glass
  ctx.fillRect(p.sx - 3, signBaseY, 6, 8);
  ctx.fillStyle = "#5bcf9e"; // potion liquid, teal-green
  ctx.fillRect(p.sx - 2, signBaseY + 3, 4, 5);
  ctx.fillStyle = PALETTE.textDim; // neck
  ctx.fillRect(p.sx - 1, signBaseY - 2, 2, 3);
}

const FORGE_WALL_H = 46;
const FORGE_CHIMNEY_W = 10;
const FORGE_CHIMNEY_H = 30;

/** Block + chimney, warm ember glow on its faces at night (spec). Mirrors
 *  drawBuildingBlock's night-glow technique (`night ? windowLit :
 *  windowDark`), same idea, different placement/color/size — an ember glow
 *  low on the wall rather than a window partway up it. */
function drawForge(ctx: CanvasRenderingContext2D, b: TownBuilding, night: boolean): void {
  const { x, y, w, h } = b.footprint;
  const wallColor = PALETTE.stone[0];
  drawIsoBlock(ctx, x, y, w, h, FORGE_WALL_H, wallColor);

  // Chimney: small, narrow, tall block at one roof corner, stacked via
  // liftPx = wall height — same stacking idiom as the lab's/house's roof.
  const chimneyX = x + w - FORGE_CHIMNEY_W - 4;
  const chimneyY = y + 4;
  drawIsoBlock(
    ctx,
    chimneyX,
    chimneyY,
    FORGE_CHIMNEY_W,
    FORGE_CHIMNEY_W,
    FORGE_CHIMNEY_H,
    shade(wallColor, -0.35),
    FORGE_WALL_H,
  );

  if (night) {
    const pS = project(x + w, y + h);
    const pE = project(x + w, y);
    const pW = project(x, y + h);
    const glowSize = 10;
    const glowLift = FORGE_WALL_H * 0.2; // low on the wall, like a firebox
    ctx.fillStyle = PALETTE.windowLit;
    ctx.fillRect((pW.sx + pS.sx) / 2 - glowSize / 2, (pW.sy + pS.sy) / 2 - glowLift - glowSize / 2, glowSize, glowSize);
    ctx.fillRect((pS.sx + pE.sx) / 2 - glowSize / 2, (pS.sy + pE.sy) / 2 - glowLift - glowSize / 2, glowSize, glowSize);
  }
}

// ---------- main render ----------

// Sweep animation for the shop's helper: dust flecks are cosmetic ambience
// (Math.random(), never a fixed formula — determinism-vs-liveliness gotcha
// in CLAUDE.md) and live in a module-scoped Particles instance the same way
// ShopView's rAF loop and AdventureStripRenderer's renderStrip each own
// theirs across frames. `lastFrameTime` mirrors AdventureStripRenderer's
// `lastNow` to turn the rAF timestamp into a per-frame delta.
let lastFrameTime: number | null = null;
const helperDustParticles = new Particles();
// Spark (forge)/leaf (garden, alchemy lab) flecks for the helper's "craft"
// assignment animation below — same module-scope-Particles idiom as
// helperDustParticles, kept separate since the two never burst from the
// same spot in the same frame.
const craftFleckParticles = new Particles();

function render(ctx: CanvasRenderingContext2D, engine: GameEngine, now: number) {
  const s = engine.state;
  const night = s.phase === "night" || s.phase === "evening";
  const buildings = s.buildings;

  const deltaMs = lastFrameTime === null ? 0 : Math.min(now - lastFrameTime, 100);
  lastFrameTime = now;
  helperDustParticles.update(deltaMs);
  craftFleckParticles.update(deltaMs);

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
    if (v) {
      const key = depthKey(v.x + v.w / 2, v.y + v.h / 2);
      drawables.push({ key, draw: () => drawBuildingBlock(ctx, v, night) });
      continue;
    }
    // Craft buildings (garden/alchemy_lab/forge, spec V2.9/issue #92): not
    // handled by buildingVisual()/drawBuildingBlock — bespoke draw
    // functions above, inserted into this same depth-sorted list so they
    // clip correctly against characters/trees walking past.
    const key = depthKey(b.footprint.x + b.footprint.w / 2, b.footprint.y + b.footprint.h / 2);
    if (b.kind === "garden") {
      drawables.push({ key, draw: () => drawGardenPlot(ctx, b.footprint, s.inventory) });
    } else if (b.kind === "alchemy_lab") {
      drawables.push({ key, draw: () => drawAlchemyLab(ctx, b) });
    } else if (b.kind === "forge") {
      drawables.push({ key, draw: () => drawForge(ctx, b, night) });
    }
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

  // The helper: shop-adjacent duty (chores/shop assignment, spec V2.7 /
  // issue #83) parks it by the shop door doing an idle sweep — same
  // drawable idiom as the adventurers above (depth-sorted, feet-anchored
  // via project()), but drawn with the shorter "child" sprite variant and
  // no walk cycle since it's stationary. Skips the draw if there's no shop
  // building (registry lookup miss) or the helper is off doing something
  // else today (adventuring).
  if (shop?.door && s.helper && (s.helper.assignment === "chores" || s.helper.assignment === "shop")) {
    const helper = s.helper;
    const anchorX = shop.door.x + 30;
    const anchorY = shop.door.y - 8;
    drawables.push({
      key: depthKey(anchorX, anchorY),
      draw: () => {
        const { sx, sy } = project(anchorX, anchorY);
        const drawX = sx - 20;
        const drawY = sy - CHILD_SPRITE_H;
        drawCharacter(ctx, helper, drawX, drawY, 0, "SW", "child");

        // Broom: handle + bristle head, both shifting together between two
        // ground-level positions just clear of the sprite's own 40px-wide
        // silhouette (sx-20 to sx+20) — kept entirely outside the body box
        // so it reads as its own object next to the child rather than
        // blending into the tunic (an earlier version overlapped the
        // trailing arm and all but vanished at this palette's resolution).
        // Dark handle against a bright bristle head stays legible against
        // both the wall behind it and the character beside it. Slow,
        // readable 2-frame cadence — ambience, not a leg-cycle.
        const swingFrame = Math.floor(now / 300) % 2;
        const swingX = swingFrame === 0 ? 0 : 10;
        const handX = sx + 22 + swingX;
        const handY = sy - 30;
        const handLen = 22;
        const headW = PX * 3;
        const headX = handX - PX;
        const headY = handY + handLen - PX;
        rect(ctx, handX, handY, PX, handLen, "#3a2c1e"); // handle
        rect(ctx, headX, headY, headW, PX * 2, "#e8d9a8"); // bristle head, near the ground

        // Dust fleck, occasionally — ambience only, so Math.random() (never
        // a fixed formula, or the sweep reads as frozen/robotic).
        if (Math.random() < 0.02) {
          helperDustParticles.burst(headX + headW / 2, headY, {
            count: 1 + Math.floor(Math.random() * 2),
            colors: ["#e8d9a8"],
            speed: 30,
            spread: 1,
            gravity: 60,
            life: 0.5,
            size: PX,
          });
        }

        ctx.fillStyle = PALETTE.textLight;
        ctx.font = `${2.5 * PX}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(helper.name.split(" ")[0], sx, drawY - PX);
        ctx.textAlign = "left";
      },
    });
  }

  // The helper on "craft" assignment (spec V2.9, issue #92): a child sprite
  // near the highest-unlocked craft building (forge > alchemy_lab > garden)
  // doing a 2-frame work motion with an occasional spark/leaf fleck. Mirrors
  // the chores/shop sweep block above almost exactly — same drawCharacter
  // call, same depth-sorted drawable push, same feet-anchored project()
  // placement, same name label below the feet — gated on "craft" instead of
  // chores/shop, and skipped entirely if none of the three craft buildings
  // exist yet (nothing to work at).
  const craftBuilding =
    getBuilding(buildings, "forge") ?? getBuilding(buildings, "alchemy_lab") ?? getBuilding(buildings, "garden");
  if (craftBuilding && s.helper && s.helper.assignment === "craft") {
    const helper = s.helper;
    const anchor = craftBuilding.door ?? {
      x: craftBuilding.footprint.x + craftBuilding.footprint.w / 2,
      y: craftBuilding.footprint.y + craftBuilding.footprint.h / 2,
    };
    const anchorX = anchor.x + 24;
    const anchorY = anchor.y - 6;
    const isForge = craftBuilding.kind === "forge";
    drawables.push({
      key: depthKey(anchorX, anchorY),
      draw: () => {
        const { sx, sy } = project(anchorX, anchorY);
        const drawX = sx - 20;
        const drawY = sy - CHILD_SPRITE_H;
        drawCharacter(ctx, helper, drawX, drawY, 0, "SW", "child");

        // Work motion: same 2-frame swing cadence as the broom sweep above
        // (reused timing constant for visual consistency), a small
        // tool/hand mark shifting between two ground-level positions,
        // outside the sprite's own silhouette the same way the broom is.
        const workFrame = Math.floor(now / 300) % 2;
        const toolX = sx + 22 + (workFrame === 0 ? 0 : 8);
        const toolY = sy - 28 + (workFrame === 0 ? 0 : -6);
        rect(ctx, toolX, toolY, PX * 2, PX * 2, isForge ? "#c0392b" : PALETTE.foliage);

        // Spark (near the forge) or leaf fleck (near the garden/lab),
        // occasionally — ambience only, so Math.random() (never a fixed
        // formula, the determinism-vs-liveliness gotcha), mirroring the
        // sweep's dust-fleck gating exactly.
        if (Math.random() < 0.02) {
          craftFleckParticles.burst(toolX + PX, toolY, {
            count: 1 + Math.floor(Math.random() * 2),
            colors: isForge ? ["#ffb347", "#e8542c"] : ["#4a7a45", "#2e5429"],
            speed: isForge ? 40 : 26,
            spread: 1,
            gravity: isForge ? -20 : 60,
            life: 0.5,
            size: PX,
          });
        }

        ctx.fillStyle = PALETTE.textLight;
        ctx.font = `${2.5 * PX}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(helper.name.split(" ")[0], sx, drawY - PX);
        ctx.textAlign = "left";
      },
    });
  }

  drawables.sort((a, b) => a.key - b.key);
  for (const d of drawables) d.draw();
  helperDustParticles.draw(ctx);
  craftFleckParticles.draw(ctx);

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
