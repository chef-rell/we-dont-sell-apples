// Town View: top-down pixel scene with buildings, paths, trees, and
// wandering adventurers (spec §3a). Owns a canvas + rAF loop for drawing only
// — App.tsx owns the single engine.tick loop (issue #55).

import { useEffect, useRef, type MouseEvent } from "react";
import type { GameEngine } from "../game/GameEngine";
import { TOWN } from "../game/GameEngine";
import { skyTint } from "../game/DayNightCycle";
import { drawBuilding } from "../rendering/BuildingRenderer";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { hash2d, px, rect } from "../rendering/PixelRenderer";
import type { AdventurerState } from "../types";
import { PALETTE, PX, WORLD_H, WORLD_W } from "../utils/constants";

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
  // follows the adventurers out to the Wilderness View. Map the click from CSS
  // pixels back into world coordinates (the canvas is scaled to fit the window).
  const handleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const wx = ((e.clientX - r.left) / r.width) * WORLD_W;
    const wy = ((e.clientY - r.top) / r.height) * WORLD_H;
    // Shop footprint (walls + roof), with a little slack for easy clicking.
    if (wx >= TOWN.shop.x - 20 && wx <= TOWN.shop.x + 96 && wy >= TOWN.shop.y - 24 && wy <= TOWN.shop.y + 64) {
      onEnterShop();
      return;
    }
    // Gate pillars plus the road between them.
    if (wx >= TOWN.gate.x - 24 && wy >= TOWN.gate.y - 40 && wy <= TOWN.gate.y + 140) {
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

  // Gate: two stone pillars at the east edge — clickable, it leads out to the
  // Wilderness View, so it gets a label like the buildings do.
  px(ctx, TOWN.gate.x / PX, TOWN.gate.y / PX - 6, 3, 14, PALETTE.stone[0]);
  px(ctx, TOWN.gate.x / PX, TOWN.gate.y / PX + 16, 3, 14, PALETTE.stone[1]);
  ctx.font = `${3 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textLight;
  ctx.fillText("GATE", TOWN.gate.x + 6, TOWN.gate.y - 34);
  ctx.textAlign = "left";

  // Adventurers who are actually outdoors in town (issue #15): shoppers are
  // inside the shop and get drawn by ShopView, and adventurers are away in the
  // wilderness until evening — showing them loitering at the gate gives away
  // that nothing is happening out there (§2/§17).
  const walkFrame: 0 | 1 = Math.floor(now / 180) % 2 === 0 ? 0 : 1;
  const alive = s.adventurers.filter((a) => a.alive && IN_TOWN.includes(a.state));
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
