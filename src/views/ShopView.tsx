// Shop View: interior selling scene (spec §3b) — shelves of stock, a counter,
// and the shopkeeper. Owns its own canvas + rAF loop and keeps the sim ticking
// while the player is inside. Clicking a shelf item opens the Moonlighter
// pricing panel (§6); live in-shop customers arrive in a later Phase 2 PR.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { GameEngine } from "../game/GameEngine";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { drawItemIcon, ICON_CELL } from "../rendering/ItemRenderer";
import { rect } from "../rendering/PixelRenderer";
import { PricingPanel } from "../ui/PricingPanel";
import type { Item } from "../types";
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
  // Selected shelf slot + the item that was in it, so a sale (or a restock
  // reusing the slot) can close a panel that is now pointing at nothing.
  const [sel, setSel] = useState<{ slot: number; item: Item } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;

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
      renderShop(ctx, engine, selRef.current?.slot ?? null);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // Drop the selection if the item leaves the shelf while the panel is open.
  useEffect(() => {
    if (!sel) return;
    const id = setInterval(() => {
      if (engine.state.shelves[sel.slot] !== sel.item) setSel(null);
    }, 250);
    return () => clearInterval(id);
  }, [engine, sel]);

  const onCanvasClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    // The canvas is CSS-scaled to fit; map the click back into world px.
    const wx = ((e.clientX - bounds.left) / bounds.width) * WORLD_W;
    const wy = ((e.clientY - bounds.top) / bounds.height) * WORLD_H;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const r = slotRect(col, row);
        if (wx < r.x || wx >= r.x + r.w || wy < r.y || wy >= r.y + r.h) continue;
        const slot = row * COLS + col;
        const item = engine.state.shelves[slot];
        if (!item) return; // empty slot: nothing to price
        setSel((prev) => (prev?.slot === slot ? null : { slot, item }));
        return;
      }
    }
    setSel(null); // clicked the room, not a shelf
  };

  // Route pricing through the engine (#10) so it records the pricing history
  // the §13 auto-pilot infers the player's style from.
  const setPrice = (price: number | null) => {
    if (sel) engine.setPrice(sel.item.id, price);
  };

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: WORLD_W, margin: "0 auto" }}>
      <canvas
        ref={canvasRef}
        width={WORLD_W}
        height={WORLD_H}
        onClick={onCanvasClick}
        style={{ width: "100%", imageRendering: "pixelated", display: "block", cursor: "pointer" }}
      />
      {sel && (
        <div style={panelAnchor(sel.slot)}>
          <PricingPanel item={sel.item} onSetPrice={setPrice} onClose={() => setSel(null)} />
        </div>
      )}
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

/** Slot rectangle (world px) for column/row — also used for click hit-testing. */
export function slotRect(col: number, row: number) {
  return { x: GRID_X + col * SLOT_W, y: GRID_Y + row * SLOT_H, w: SLOT_W, h: SLOT_H };
}

/** Floats the pricing panel next to its slot, in canvas-relative percentages so
 *  it tracks the shelf as the canvas scales. Bottom row opens upward. */
function panelAnchor(slot: number): CSSProperties {
  const row = Math.floor(slot / COLS);
  const r = slotRect(slot % COLS, row);
  const above = row === ROWS - 1;
  const y = above ? r.y : r.y + r.h;
  return {
    position: "absolute",
    left: `${clamp((r.x + r.w / 2) / WORLD_W, 0.16, 0.84) * 100}%`,
    top: `${(y / WORLD_H) * 100}%`,
    transform: above ? "translate(-50%, -100%)" : "translate(-50%, 8px)",
    zIndex: 2,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** 1-pixel-unit hollow frame (the fill stays visible through it). */
function outline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  rect(ctx, x, y, w, PX, color);
  rect(ctx, x, y + h - PX, w, PX, color);
  rect(ctx, x, y, PX, h, color);
  rect(ctx, x + w - PX, y, PX, h, color);
}

export function renderShop(
  ctx: CanvasRenderingContext2D,
  engine: GameEngine,
  selectedSlot: number | null = null,
) {
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

      // Selection frame around the item being priced
      if (slotIndex === selectedSlot) {
        const pad = 8;
        outline(ctx, iconX - pad, iconY - pad, ICON_PX + pad * 2, ICON_PX + pad * 2, PALETTE.gold);
      }

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
  if (selectedSlot === null) {
    ctx.fillText("click an item to price it", WORLD_W / 2, WORLD_H - 24);
  }
  ctx.textAlign = "left";
}
