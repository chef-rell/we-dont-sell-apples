// Town View: top-down pixel scene with buildings, paths, trees, and
// wandering adventurers (spec §3a). Owns the canvas + rAF loop for Phase 1.

import { useEffect, useRef } from "react";
import type { GameEngine } from "../game/GameEngine";
import { TOWN } from "../game/GameEngine";
import { skyTint } from "../game/DayNightCycle";
import { drawBuilding } from "../rendering/BuildingRenderer";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { hash2d, px, rect } from "../rendering/PixelRenderer";
import { PALETTE, PX, WORLD_H, WORLD_W } from "../utils/constants";

export function TownView({ engine }: { engine: GameEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const delta = Math.min(now - last, 100); // clamp tab-switch spikes
      last = now;
      engine.tick(delta);
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
      style={{
        width: "100%",
        maxWidth: WORLD_W,
        imageRendering: "pixelated",
        display: "block",
        margin: "0 auto",
      }}
    />
  );
}

function render(ctx: CanvasRenderingContext2D, engine: GameEngine, now: number) {
  const s = engine.state;
  const night = s.phase === "night" || s.phase === "evening";

  // Grass with deterministic tile variation
  rect(ctx, 0, 0, WORLD_W, WORLD_H, PALETTE.grass[0]);
  for (let gy = 0; gy < WORLD_H / PX; gy += 4) {
    for (let gx = 0; gx < WORLD_W / PX; gx += 4) {
      if (hash2d(gx, gy) > 0.7) px(ctx, gx, gy, 4, 4, PALETTE.grass[1]);
    }
  }

  // Dirt paths: square hub connecting shop, tavern, houses, gate
  drawPath(ctx, TOWN.square, TOWN.shop);
  drawPath(ctx, TOWN.square, TOWN.tavern);
  drawPath(ctx, TOWN.square, TOWN.gate);
  for (const h of TOWN.houses) drawPath(ctx, TOWN.square, h);
  // Square plaza
  rect(ctx, TOWN.square.x - 60, TOWN.square.y - 40, 160, 120, PALETTE.dirt[0]);

  // Trees scattered deterministically
  for (let i = 0; i < 24; i++) {
    const tx = Math.floor(hash2d(i, 7) * (WORLD_W - 60)) + 20;
    const ty = Math.floor(hash2d(i, 13) * (WORLD_H - 100)) + 40;
    if (nearAnyBuilding(tx, ty)) continue;
    drawTree(ctx, tx, ty);
  }

  // Buildings
  drawBuilding(ctx, { x: TOWN.shop.x, y: TOWN.shop.y, w: 20, h: 14, label: "SHOP", night, roofColor: PALETTE.roofs[0] });
  drawBuilding(ctx, { x: TOWN.tavern.x, y: TOWN.tavern.y, w: 16, h: 12, label: "TAVERN", night, roofColor: "#6b4a15" });
  for (const h of TOWN.houses) {
    drawBuilding(ctx, { x: h.x, y: h.y, w: 10, h: 8, night });
  }

  // Gate: two stone pillars at the east edge
  px(ctx, TOWN.gate.x / PX, TOWN.gate.y / PX - 6, 3, 14, PALETTE.stone[0]);
  px(ctx, TOWN.gate.x / PX, TOWN.gate.y / PX + 16, 3, 14, PALETTE.stone[1]);

  // Adventurers (sorted by y for painter's order)
  const walkFrame: 0 | 1 = Math.floor(now / 180) % 2 === 0 ? 0 : 1;
  const alive = s.adventurers.filter((a) => a.alive);
  alive.sort((a, b) => a.position.y - b.position.y);
  for (const a of alive) {
    drawCharacter(ctx, a, a.position.x, a.position.y, a.position.moving ? walkFrame : 0);
    // Name tag
    ctx.fillStyle = PALETTE.textLight;
    ctx.font = `${2.5 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(a.name.split(" ")[0], a.position.x + 5 * PX, a.position.y - PX);
    ctx.textAlign = "left";
  }

  // Day/night tint over everything
  const tint = skyTint(s.timeOfDay);
  if (tint.alpha > 0) {
    ctx.globalAlpha = tint.alpha;
    rect(ctx, 0, 0, WORLD_W, WORLD_H, tint.color);
    ctx.globalAlpha = 1;
  }
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  // L-shaped path: horizontal then vertical, 12px wide
  const w = 12;
  const x1 = Math.min(from.x, to.x);
  const x2 = Math.max(from.x, to.x);
  rect(ctx, x1, from.y, x2 - x1 + w, w, PALETTE.dirt[1]);
  const y1 = Math.min(from.y, to.y);
  const y2 = Math.max(from.y, to.y);
  rect(ctx, to.x, y1, w, y2 - y1 + w, PALETTE.dirt[1]);
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const gx = x / PX;
  const gy = y / PX;
  px(ctx, gx + 1, gy + 4, 2, 3, PALETTE.wood[0]); // trunk
  px(ctx, gx - 1, gy, 6, 4, "#2e5429"); // canopy
  px(ctx, gx, gy - 1, 4, 1, "#356331"); // canopy top highlight
}

function nearAnyBuilding(x: number, y: number): boolean {
  const spots = [TOWN.shop, TOWN.tavern, TOWN.gate, TOWN.square, ...TOWN.houses];
  return spots.some((s) => Math.abs(s.x - x) < 120 && Math.abs(s.y - y) < 100);
}
