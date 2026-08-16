// Shop View: interior selling scene (spec §3b) — shelves of stock, a counter,
// and the shopkeeper. Owns its own canvas + rAF loop and keeps the sim ticking
// while the player is inside. Pricing UI and live customers arrive in later
// Phase 2 PRs; this PR delivers the room, the stocked shelves, and navigation.

import { useEffect, useRef } from "react";
import type { GameEngine } from "../game/GameEngine";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { drawItemIcon, ICON_CELL } from "../rendering/ItemRenderer";
import { rect } from "../rendering/PixelRenderer";
import { PALETTE, PX, WORLD_H, WORLD_W } from "../utils/constants";

// Shelf grid layout (12 slots at shop level 1 = 3 rows × 4 columns).
const COLS = 4;
const ROWS = 3;
const SLOT_W = 190;
const SLOT_H = 128;
const GRID_X = 120; // left of the first column
const GRID_Y = 96; // top of the first row
const ICON_SCALE = 2; // shelf icons drawn at 2× for readability
const ICON_PX = ICON_CELL * PX * ICON_SCALE; // on-screen icon footprint

export function ShopView({ engine, onLeave }: { engine: GameEngine; onLeave: () => void }) {
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
      const delta = Math.min(now - last, 100);
      last = now;
      engine.tick(delta);
      renderShop(ctx, engine);
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

/** Slot rectangle (world px) for column/row — exported for the pricing PR's hit-testing. */
export function slotRect(col: number, row: number) {
  return { x: GRID_X + col * SLOT_W, y: GRID_Y + row * SLOT_H, w: SLOT_W, h: SLOT_H };
}

export function renderShop(ctx: CanvasRenderingContext2D, engine: GameEngine) {
  const s = engine.state;

  // ---- Room ----
  rect(ctx, 0, 0, WORLD_W, WORLD_H, "#3a2c22"); // back wall (dark wood)
  rect(ctx, 0, WORLD_H - 200, WORLD_W, 200, "#6b4a2e"); // floor (lighter planks)
  // Floor plank seams
  for (let x = 0; x < WORLD_W; x += 96) rect(ctx, x, WORLD_H - 200, PX, 200, "#5a3e26");
  rect(ctx, 0, WORLD_H - 204, WORLD_W, PX, "#2c1f18"); // floor/wall trim

  // ---- Shelves with stock ----
  for (let row = 0; row < ROWS; row++) {
    const shelfY = GRID_Y + row * SLOT_H + ICON_PX + 20;
    // Shelf board spanning the row
    rect(ctx, GRID_X - 8, shelfY, COLS * SLOT_W + 16, 12, PALETTE.wood[0]);
    rect(ctx, GRID_X - 8, shelfY, COLS * SLOT_W + 16, PX, PALETTE.wood[1]); // top highlight
    rect(ctx, GRID_X - 8, shelfY + 12, COLS * SLOT_W + 16, PX, "#2c1f18"); // shadow

    for (let col = 0; col < COLS; col++) {
      const slotIndex = row * COLS + col;
      const item = s.shelves[slotIndex];
      const { x } = slotRect(col, row);
      const iconX = x + (SLOT_W - ICON_PX) / 2;
      const iconY = shelfY - ICON_PX;

      if (!item) continue;

      // Icon at 2× scale
      ctx.save();
      ctx.translate(iconX, iconY);
      ctx.scale(ICON_SCALE, ICON_SCALE);
      drawItemIcon(ctx, item, 0, 0);
      ctx.restore();

      // Price tag (or a dash for unpriced stock — the player prices these next)
      const label = item.salePrice === null ? "—" : `${item.salePrice}g`;
      ctx.font = `${4 * PX}px monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = item.salePrice === null ? PALETTE.textDim : PALETTE.gold;
      ctx.fillText(label, x + SLOT_W / 2, shelfY + 36);
    }
  }
  ctx.textAlign = "left";

  // ---- Counter + shopkeeper ----
  const counterY = WORLD_H - 150;
  drawCharacter(ctx, { class: "veteran", appearance: { skin: 2, hair: 2 } }, WORLD_W / 2 - 20, counterY - 64, 0);
  rect(ctx, WORLD_W / 2 - 180, counterY, 360, 40, PALETTE.wood[0]); // counter top
  rect(ctx, WORLD_W / 2 - 180, counterY, 360, PX, PALETTE.wood[1]); // highlight
  rect(ctx, WORLD_W / 2 - 180, counterY + 40, 360, 24, "#4a3220"); // counter front

  // ---- Sign ----
  ctx.font = `${5 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textLight;
  ctx.fillText("YOUR SHOP", WORLD_W / 2, 48);
  ctx.font = `${3 * PX}px monospace`;
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText("Day " + s.day + " · " + s.phase, WORLD_W / 2, 74);
  ctx.textAlign = "left";
}
