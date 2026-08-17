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
import { depthKey, drawIsoBlock, isoFacing, project, shade, unproject, type ScreenPoint } from "../rendering/iso";
import { hash2d, rect } from "../rendering/PixelRenderer";
import { Particles } from "../rendering/Particles";
import { lightningFlash, weatherDarkenAlpha } from "../rendering/WeatherFX";
import { BuildChip, BuildPanel } from "../ui/BuildPanel";
import { ForgePanel } from "../ui/ForgePanel";
import { StaffPanel } from "../ui/StaffPanel";
import type { Adventurer, AdventurerState, BuildingKind, Item, TownBuilding, WeatherKind } from "../types";
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
  kind: BuildingKind; // ambience hooks (window flicker, chimney smoke, spec V2.9 issue #95) key off this
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
        kind: b.kind,
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
        kind: b.kind,
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
        kind: b.kind,
      };
    default:
      return null; // square and gate are drawn separately below
  }
}

/** Window glow color for a building's face. By day every building reads the
 *  same flat `windowDark`; at night most buildings hold a steady
 *  `windowLit`. The tavern is the one exception (spec: "tavern windows
 *  flicker warm at night") — a soft two-frequency flutter around the same
 *  base glow rather than a metronomic blink, so it reads as firelight
 *  rather than a strobing bulb. Ambience only (Math.sin(now)-driven, never
 *  read back by game logic — CLAUDE.md's determinism-vs-liveliness rule
 *  only binds §6 verdicts and combat math). */
function windowGlowColor(kind: BuildingKind, night: boolean, now: number): string {
  if (!night) return PALETTE.windowDark;
  if (kind !== "tavern") return PALETTE.windowLit;
  const flicker = Math.sin(now / 210) * 0.14 + Math.sin(now / 67 + 1.7) * 0.08;
  return shade(PALETTE.windowLit, flicker);
}

function drawBuildingBlock(ctx: CanvasRenderingContext2D, v: BuildingVisual, night: boolean, now: number): void {
  const wallBase = PALETTE.walls[0];
  drawIsoBlock(ctx, v.x, v.y, v.w, v.h, v.wallH, wallBase);

  // Door: dark mark at the front (south) ground corner, on the visible face.
  const pS = project(v.x + v.w, v.y + v.h);
  const dw = 8;
  const dh = 16;
  ctx.fillStyle = shade(wallBase, -0.6);
  ctx.fillRect(pS.sx - dw / 2, pS.sy - dh, dw, dh);

  // Windows: one on each visible face, glowing at night (flickering warm
  // for the tavern specifically — see windowGlowColor()).
  const pE = project(v.x + v.w, v.y);
  const pW = project(v.x, v.y + v.h);
  const glow = windowGlowColor(v.kind, night, now);
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

// ---------- Competitor stores (spec V2.10, issue #95) ----------
//
// "Deliberately shallow" (V2.10) presentation to match the shallow engine:
// a distinct muted-roof block + a plain hanging sign, never the player
// shop's gold roof or glowing window — a rival's storefront should read as
// "open, but not yours" at a glance. `defaultCompetitors()`'s two stores sit
// in open sky (TownBuildings.ts's own occlusion-check comment), so no
// special-casing is needed here beyond the generic depth-sorted push.

const COMPETITOR_WALL_H = 44;
const COMPETITOR_ROOF_H = 16;
const COMPETITOR_FLASH_MS = 900;

// storeId -> till value last observed, so an increase (an adventurer's
// purchase landing) can trigger the "lost sale" flash exactly once per
// purchase rather than every frame the till stays elevated (spec: "poll
// competitors[].till changes... renderer stays read-only" — this never
// writes back to GameState). `undefined` (first poll ever, or a save
// loaded mid-day with a nonzero starting till) deliberately does NOT flash
// — only a same-session increase does. Module-scoped, same idiom as every
// other ambient-state tracker in this file.
const lastTillByStore = new Map<string, number>();
const competitorFlashUntil = new Map<string, number>();
const competitorFlashParticles = new Particles();

/** Call once per frame (not per-building-draw) to detect a till increase and
 *  arm that store's flash + a small red coin burst — a "lost sale" read,
 *  distinct in color from every other coin effect in this game (which are
 *  always gold), since this coin left town through someone else's door. */
function pollCompetitorPurchases(buildings: TownBuilding[], competitors: { id: string; till: number }[], now: number): void {
  for (const c of competitors) {
    const prev = lastTillByStore.get(c.id);
    if (prev !== undefined && c.till > prev) {
      competitorFlashUntil.set(c.id, now + COMPETITOR_FLASH_MS);
      const b = getBuilding(buildings, c.id);
      const anchor = b?.door ?? (b ? { x: b.footprint.x, y: b.footprint.y } : null);
      if (anchor) {
        const p = project(anchor.x, anchor.y);
        competitorFlashParticles.burst(p.sx, p.sy - 60, {
          count: 5,
          colors: ["#c0392b", "#e0644a"],
          speed: 85,
          spread: 1,
          gravity: 150,
          life: 0.6,
          size: PX,
        });
      }
    }
    lastTillByStore.set(c.id, c.till);
  }
}

function drawCompetitorFlash(ctx: CanvasRenderingContext2D, storeId: string, anchor: ScreenPoint, now: number): void {
  const until = competitorFlashUntil.get(storeId);
  if (!until || until < now) return;
  const t = 1 - (until - now) / COMPETITOR_FLASH_MS;
  ctx.globalAlpha = Math.max(0, 1 - t);
  const y = anchor.sy - 66 - t * 16;
  rect(ctx, anchor.sx - 5, y, PX * 2, PX * 2, "#c0392b");
  rect(ctx, anchor.sx - 5, y, PX * 2, PX / 2, "#e0644a");
  ctx.fillStyle = "#f0b0a0";
  ctx.font = `${2.5 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText("−g", anchor.sx, y - 4);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

function drawCompetitorStore(ctx: CanvasRenderingContext2D, b: TownBuilding, night: boolean, now: number): void {
  const { x, y, w, h } = b.footprint;
  const wallColor = PALETTE.walls[1]; // paler than the player shop's walls[0] — visibly "not yours"
  drawIsoBlock(ctx, x, y, w, h, COMPETITOR_WALL_H, wallColor);

  // Muted roof: plain stone gray, never the player shop's gold (spec:
  // "distinct muted-roof buildings").
  const overhang = 6;
  drawIsoBlock(
    ctx,
    x - overhang,
    y - overhang,
    w + overhang * 2,
    h + overhang * 2,
    COMPETITOR_ROOF_H,
    PALETTE.stone[1],
    COMPETITOR_WALL_H,
  );

  // A plain hanging sign — a shingle, not a shop window display.
  const anchor = b.door ?? { x: x + w / 2, y: y + h };
  const p = project(anchor.x, anchor.y);
  const signY = p.sy - COMPETITOR_WALL_H - COMPETITOR_ROOF_H - 12;
  rect(ctx, p.sx - 8, signY, 16, 8, shade(wallColor, -0.45));
  rect(ctx, p.sx - 6, signY + 2, 12, 3, PALETTE.textDim);

  // One dim window — never warmly lit like the player's own buildings.
  const pS = project(x + w, y + h);
  const pE = project(x + w, y);
  const winSize = 6;
  const winLift = COMPETITOR_WALL_H * 0.55;
  ctx.fillStyle = night ? shade(PALETTE.windowDark, 0.12) : PALETTE.windowDark;
  ctx.fillRect((pS.sx + pE.sx) / 2 - winSize / 2, (pS.sy + pE.sy) / 2 - winLift - winSize / 2, winSize, winSize);

  drawCompetitorFlash(ctx, b.id, p, now);
}

// ---------- Graveyard (spec V2.9, issue #95) ----------
//
// Flat plot — TownBuildings.ts's own comment: "flat headstones, not a tall
// structure — no occlusion risk either way." Fenced diamond, gravestone
// rects filling left-to-right rows as state.stats.adventurersLost grows,
// capped at GRAVEYARD_STONE_CAP with a "..." mound standing in for the
// overflow (the underlying count is never capped, only how many individual
// stones get drawn — a hundred-day run doesn't need a hundred rects).

const GRAVEYARD_COLS = 6;
const GRAVEYARD_ROWS = 4;
const GRAVEYARD_STONE_CAP = GRAVEYARD_COLS * GRAVEYARD_ROWS; // 24

function drawGraveyard(ctx: CanvasRenderingContext2D, b: TownBuilding, adventurersLost: number): void {
  const { x, y, w, h } = b.footprint;

  // Untended ground — duller than the town's regular lawn.
  fillIsoQuad(ctx, x, y, w, h, shade(PALETTE.grass[0], -0.25));

  // Low fence: posts at the diamond's four projected corners, a thin rail
  // between them — decoration on an already-shaded flat fill, the same
  // allowance ground tiles get under spec V2.4's "no unshaded flat rect"
  // rule.
  const corners = [project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)];
  const postH = 10;
  for (const c of corners) rect(ctx, c.sx - 1, c.sy - postH, 2, postH, "#3d382e");
  ctx.strokeStyle = "#5a5040";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const nxt = corners[(i + 1) % corners.length];
    ctx.moveTo(a.sx, a.sy - postH * 0.6);
    ctx.lineTo(nxt.sx, nxt.sy - postH * 0.6);
  }
  ctx.stroke();

  const shown = Math.min(adventurersLost, GRAVEYARD_STONE_CAP);
  const cellW = w / GRAVEYARD_COLS;
  const cellH = h / GRAVEYARD_ROWS;
  for (let i = 0; i < shown; i++) {
    const col = i % GRAVEYARD_COLS;
    const row = Math.floor(i / GRAVEYARD_COLS);
    const gx = x + (col + 0.5) * cellW;
    const gy = y + (row + 0.5) * cellH;
    drawIsoBlock(ctx, gx - 3, gy - 2, 6, 4, 10, PALETTE.stone[1]);
  }

  if (adventurersLost > GRAVEYARD_STONE_CAP) {
    const mx = x + w - cellW * 0.55;
    const my = y + h - cellH * 0.55;
    drawIsoBlock(ctx, mx - 5, my - 4, 10, 8, 7, shade(PALETTE.dirt[0], -0.25));
    const p = project(mx, my);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `${2.5 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("…", p.sx, p.sy - 15);
    ctx.textAlign = "left";
  }
}

/** True while `a` is standing still inside (or just at the edge of) the
 *  graveyard plot — the newcomer arrival-day waypoint (spec V2.9, issue
 *  #94's `bc.graveyardWaypoint`) reads as a walk there followed by a hold,
 *  same as every other wander-target arrival; this is a read-only render-
 *  side approximation of "are they paused there right now" (position +
 *  `!moving`) rather than reading the engine's internal BehaviorContext,
 *  which the renderer never touches. */
function atGraveyard(a: Adventurer, graveyard: TownBuilding | undefined): boolean {
  if (!graveyard || a.position.moving) return false;
  const { x, y, w, h } = graveyard.footprint;
  const pad = 36;
  return (
    a.position.x >= x - pad && a.position.x <= x + w + pad && a.position.y >= y - pad && a.position.y <= y + h + pad
  );
}

// ---------- Reputation stars (spec V2.9, issue #95) ----------

function drawReputationStars(ctx: CanvasRenderingContext2D, v: BuildingVisual, reputation: number): void {
  const stars = Math.max(0, Math.min(5, Math.round(((reputation + 1) / 2) * 5)));
  const top = project(v.x + v.w / 2, v.y + v.h / 2);
  const labelY = top.sy - v.wallH - v.roofH - 6; // matches the "SHOP" label's own baseline
  const y = labelY - 3 * PX - 3;
  const glyphs = "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
  ctx.fillStyle = PALETTE.gold;
  ctx.font = `${3 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(glyphs, top.sx, y);
  ctx.textAlign = "left";
}

// ---------- Ambience: chimney smoke (spec V2.9, issue #95) ----------

const smokeParticles = new Particles();

/** Roof-peak-ish anchor for a smoke wisp — offset toward one corner so it
 *  doesn't spawn dead center over the ridge line. */
function chimneyAnchor(v: BuildingVisual): ScreenPoint {
  const p = project(v.x + v.w * 0.74, v.y + v.h * 0.22);
  return { sx: p.sx, sy: p.sy - v.wallH - v.roofH - 2 };
}

/** Sparse smoke wisps from shop/tavern/house chimneys. Houses and the shop
 *  go quiet overnight (spec: "gated off at night for houses" — the shop's
 *  hearth is read the same way here, a judgment call, since it keeps no
 *  night staff either); the tavern keeps smoking through the night (spec:
 *  "always for tavern" — it's the one building that's busiest after dark).
 *  Math.random() gate, pure ambience (CLAUDE.md's determinism-vs-liveliness
 *  rule). */
function maybeEmitChimneySmoke(kind: BuildingKind, v: BuildingVisual, night: boolean): void {
  if (kind !== "shop" && kind !== "tavern" && kind !== "house") return;
  if (night && kind !== "tavern") return;
  if (Math.random() > 0.025) return;
  const a = chimneyAnchor(v);
  smokeParticles.burst(a.sx, a.sy, {
    count: 1,
    colors: ["#cfd0c8", "#e8e6da", "#b8bcae"],
    speed: 9,
    spread: 0.5,
    gravity: -13, // wisps rise
    life: 1.7,
    size: PX,
  });
}

// ---------- Ambience: weather overlays (spec V2.9, issue #95) ----------
//
// All Math.random-driven, over the town canvas only — the strip gets its
// own, much lighter, sky-tint-only treatment (rendering/AdventureStripRenderer
// .ts's drawSky), and both read state.weather, never decide it (that's
// game/Weather.ts's job, rolled once at rollover).

interface RainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

let rainDrops: RainDrop[] = [];

function spawnRainDrop(): RainDrop {
  return {
    x: Math.random() * WORLD_W,
    y: -20 - Math.random() * WORLD_H,
    len: 8 + Math.random() * 10,
    speed: 240 + Math.random() * 140,
  };
}

function updateAndDrawRain(ctx: CanvasRenderingContext2D, weather: WeatherKind, deltaMs: number): void {
  if (weather !== "rain" && weather !== "storm") {
    rainDrops = [];
    return;
  }
  const target = weather === "storm" ? 90 : 42;
  while (rainDrops.length < target) rainDrops.push(spawnRainDrop());
  if (rainDrops.length > target) rainDrops.length = target;

  const dt = deltaMs / 1000;
  const color = weather === "storm" ? "rgba(190,205,225,0.45)" : "rgba(200,215,230,0.32)";
  for (const d of rainDrops) {
    d.y += d.speed * dt;
    d.x -= d.speed * 0.12 * dt; // a slight wind-driven slant
    if (d.y > WORLD_H + 20) {
      d.y = -20 - Math.random() * 60;
      d.x = Math.random() * WORLD_W;
    }
    rect(ctx, d.x, d.y, PX / 2, d.len, color);
  }
}

/** Fog wash + storm darkening/flash, layered on top of everything already
 *  painted (spec: "fog wash (translucent band), storm darkening +
 *  occasional flash"). Rain has no separate overlay of its own beyond the
 *  streaks above — a wash would just muddy them. */
function drawWeatherOverlay(ctx: CanvasRenderingContext2D, weather: WeatherKind, now: number): void {
  if (weather === "fog") {
    ctx.globalAlpha = 0.22;
    rect(ctx, 0, 0, WORLD_W, WORLD_H, "#c3c9cc");
    ctx.globalAlpha = 1;
  }
  const darken = weatherDarkenAlpha(weather);
  if (darken > 0) {
    ctx.globalAlpha = darken;
    rect(ctx, 0, 0, WORLD_W, WORLD_H, "#0a0a14");
    ctx.globalAlpha = 1;
  }
  const flash = lightningFlash(weather, now);
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.5;
    rect(ctx, 0, 0, WORLD_W, WORLD_H, "#eef0ff");
    ctx.globalAlpha = 1;
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
  smokeParticles.update(deltaMs);
  competitorFlashParticles.update(deltaMs);
  pollCompetitorPurchases(buildings, s.competitors, now);

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
      drawables.push({
        key,
        draw: () => {
          drawBuildingBlock(ctx, v, night, now);
          if (v.kind === "shop") drawReputationStars(ctx, v, s.reputation);
          maybeEmitChimneySmoke(v.kind, v, night);
        },
      });
      continue;
    }
    // Craft buildings (garden/alchemy_lab/forge, spec V2.9/issue #92) and
    // the v2.10/v2.9 competitor stores + graveyard (issue #95): not handled
    // by buildingVisual()/drawBuildingBlock — bespoke draw functions above,
    // inserted into this same depth-sorted list so they clip correctly
    // against characters/trees walking past.
    const key = depthKey(b.footprint.x + b.footprint.w / 2, b.footprint.y + b.footprint.h / 2);
    if (b.kind === "garden") {
      drawables.push({ key, draw: () => drawGardenPlot(ctx, b.footprint, s.inventory) });
    } else if (b.kind === "alchemy_lab") {
      drawables.push({ key, draw: () => drawAlchemyLab(ctx, b) });
    } else if (b.kind === "forge") {
      drawables.push({ key, draw: () => drawForge(ctx, b, night) });
    } else if (b.kind === "competitor_store") {
      drawables.push({ key, draw: () => drawCompetitorStore(ctx, b, night, now) });
    } else if (b.kind === "graveyard") {
      drawables.push({ key, draw: () => drawGraveyard(ctx, b, s.stats.adventurersLost) });
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
  const graveyard = getBuilding(buildings, "graveyard");
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
        // Newcomer graveyard waypoint (spec V2.9, issue #94/#95): the
        // walk-pause IS the hold — a.position.moving is already false while
        // they're standing there, which already forces walkFrame 0 below.
        // The one thing to add is a bowed-head READ: face them down toward
        // the stones instead of whatever direction they last walked in.
        const paused = atGraveyard(a, graveyard);
        const facing = paused ? "down" : a.position.facing;
        drawCharacter(ctx, a, drawX, drawY, a.position.moving ? walkFrame : 0, isoFacing(facing));
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
  smokeParticles.draw(ctx);
  competitorFlashParticles.draw(ctx);

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

  // Weather layer (spec V2.9/V2.10, issue #95): rain streaks fall over the
  // whole scene as a foreground layer (drawn after everything else, like
  // the ambient particle systems above); fog wash / storm darkening /
  // lightning are flat overlays stacked on top of the day/night tint.
  updateAndDrawRain(ctx, s.weather, deltaMs);
  drawWeatherOverlay(ctx, s.weather, now);
}
