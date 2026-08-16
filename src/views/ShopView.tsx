// Shop View: interior selling scene (spec §3b) — shelves of stock, a counter,
// and the shopkeeper. Owns its own canvas + rAF loop for drawing only —
// App.tsx owns the single engine.tick loop (issue #55). Clicking a shelf item
// opens the Moonlighter pricing panel (§6), and adventurers browsing the shop
// stand in front of the item they're examining with their reaction to its
// price over their head.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { GameEngine } from "../game/GameEngine";
import { skyTint } from "../game/DayNightCycle";
import { computeReaction } from "../game/Economy";
import { drawCharacter } from "../rendering/CharacterRenderer";
import { drawItemIcon, ICON_CELL } from "../rendering/ItemRenderer";
import { Particles } from "../rendering/Particles";
import { rect } from "../rendering/PixelRenderer";
import { drawReaction } from "../rendering/ReactionRenderer";
import { PricingPanel } from "../ui/PricingPanel";
import { LootOfferPanel } from "../ui/LootOfferPanel";
import { ShopExpansion } from "../ui/ShopExpansion";
import { WholesalePanel } from "../ui/WholesalePanel";
import { InventoryPanel } from "../ui/InventoryPanel";
import type { Adventurer, GameState, Item } from "../types";
import { PALETTE, PX, WORLD_H, WORLD_W } from "../utils/constants";

// Shelf grid. The shop grows with shopLevel (12 → 16 → 20 → 24 slots, §5), so
// the grid is derived from however many slots state.shelves actually has:
// three rows always, columns as wide as the room allows.
const ROWS = 3;
const GRID_MARGIN = 40; // room left either side of the shelving
const SLOT_H = 128;
const GRID_Y = 96; // top of the first row
const ICON_SCALE = 2; // shelf icons drawn at 2× for readability
const ICON_PX = ICON_CELL * PX * ICON_SCALE; // on-screen icon footprint

// Where customers stand: the open floor in front of the counter, one spot per
// shelf column, so a customer stands under the item they're examining. Past
// that, they queue up a row further back (drawn first, so the front row
// overlaps them) offset half a slot, keeping a crowd readable.
const CHAR_H = 64; // drawCharacter's sprite height in world px
const AISLE_FRONT_Y = 604; // feet line, front row (name plate sits below it)
const AISLE_BACK_Y = 568; // feet line, back row

export interface ShelfLayout {
  cols: number;
  slotW: number;
}

/** Grid geometry for a given slot count. Never narrower than the level-1 shop. */
export function shelfLayout(slotCount: number): ShelfLayout {
  const cols = Math.max(4, Math.ceil(slotCount / ROWS));
  return { cols, slotW: (WORLD_W - GRID_MARGIN * 2) / cols };
}

function spotX(col: number, layout: ShelfLayout): number {
  return GRID_MARGIN + col * layout.slotW + layout.slotW / 2;
}

export function ShopView({ engine, onLeave }: { engine: GameEngine; onLeave: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Selected shelf slot + the item that was in it, so a sale (or a restock
  // reusing the slot) can close a panel that is now pointing at nothing.
  const [sel, setSel] = useState<{ slot: number; item: Item } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  // The top-right corner holds the contextual panels — restock while the cart
  // is in town, loot offers while adventurers are waiting, expansion whenever
  // there's a tier left to buy. One open at a time.
  const [corner, setCorner] = useState<CornerPanel>(null);
  const [cartHere, setCartHere] = useState(engine.state.merchant !== null);
  const [offerCount, setOfferCount] = useState(engine.state.lootOffers.length);
  const [stockCount, setStockCount] = useState(engine.state.inventory.length);
  const [canExpand, setCanExpand] = useState(engine.nextExpansionCost() !== null);
  useEffect(() => {
    const id = setInterval(() => {
      const here = engine.state.merchant !== null;
      setCartHere(here);
      const offers = engine.state.lootOffers.length;
      setOfferCount(offers);
      const stock = engine.state.inventory.length;
      setStockCount(stock);
      setCanExpand(engine.nextExpansionCost() !== null);

      // Close a panel whose reason for existing just went away.
      setCorner((open) =>
        (open === "restock" && !here) ||
        (open === "offers" && offers === 0) ||
        (open === "stockroom" && stock === 0)
          ? null
          : open,
      );
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let last = performance.now();
    const particles = new Particles();
    let soldSoFar = engine.state.stats.itemsSold;
    const frame = (now: number) => {
      const delta = Math.min(now - last, 100);
      last = now;

      // A sale throws coins over the counter.
      if (engine.state.stats.itemsSold > soldSoFar) {
        soldSoFar = engine.state.stats.itemsSold;
        particles.burst(WORLD_W / 2, WORLD_H - 170, { count: 10, speed: 110 });
      }
      particles.update(delta);

      renderShop(ctx, engine, selRef.current?.slot ?? null, particles);
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

    const layout = shelfLayout(engine.state.shelves.length);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const r = slotRect(col, row, layout);
        if (wx < r.x || wx >= r.x + r.w || wy < r.y || wy >= r.y + r.h) continue;
        const slot = row * layout.cols + col;
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
        <div style={panelAnchor(sel.slot, shelfLayout(engine.state.shelves.length))}>
          <PricingPanel
            item={sel.item}
            suggestion={engine.suggestedPrice(sel.item.name)}
            onSetPrice={setPrice}
            onClose={() => setSel(null)}
          />
        </div>
      )}
      {cornerButtons(cartHere, offerCount, stockCount, canExpand).map((btn, row) => (
        <button
          key={btn.key}
          onClick={() => setCorner((open) => (open === btn.key ? null : btn.key))}
          style={cornerButton(row)}
        >
          {btn.label}
        </button>
      ))}
      {corner && (
        <div style={panelCorner(cornerButtons(cartHere, offerCount, stockCount, canExpand).length)}>
          {corner === "restock" ?
            <WholesalePanel engine={engine} onClose={() => setCorner(null)} />
          : corner === "offers" ?
            <LootOfferPanel engine={engine} onClose={() => setCorner(null)} />
          : corner === "stockroom" ?
            <InventoryPanel engine={engine} onClose={() => setCorner(null)} />
          : <ShopExpansion engine={engine} onClose={() => setCorner(null)} />}
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
export function slotRect(col: number, row: number, layout: ShelfLayout) {
  return {
    x: GRID_MARGIN + col * layout.slotW,
    y: GRID_Y + row * SLOT_H,
    w: layout.slotW,
    h: SLOT_H,
  };
}

/** Floats the pricing panel next to its slot, in canvas-relative percentages so
 *  it tracks the shelf as the canvas scales. Bottom row opens upward. */
function panelAnchor(slot: number, layout: ShelfLayout): CSSProperties {
  const row = Math.floor(slot / layout.cols);
  const r = slotRect(slot % layout.cols, row, layout);
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

type CornerPanel = "restock" | "offers" | "stockroom" | "expand" | null;

/** Which contextual buttons the shop is currently offering, top to bottom. */
function cornerButtons(
  cartHere: boolean,
  offerCount: number,
  stockCount: number,
  canExpand: boolean,
): { key: Exclude<CornerPanel, null>; label: string }[] {
  const buttons: { key: Exclude<CornerPanel, null>; label: string }[] = [];
  if (cartHere) buttons.push({ key: "restock", label: "🛒 Restock" });
  if (offerCount > 0) buttons.push({ key: "offers", label: `💰 Offers (${offerCount})` });
  if (stockCount > 0) buttons.push({ key: "stockroom", label: `📦 Stockroom (${stockCount})` });
  if (canExpand) buttons.push({ key: "expand", label: "🔨 Expand" });
  return buttons;
}

/** Corner buttons stack down the top-right; row 0 is the topmost. */
function cornerButton(row: number): CSSProperties {
  return {
    position: "absolute",
    top: 12 + row * 40,
    right: 12,
    background: PALETTE.uiDark,
    border: `2px solid ${PALETTE.gold}`,
    color: PALETTE.gold,
    fontFamily: "monospace",
    fontSize: 15,
    padding: "6px 12px",
    cursor: "pointer",
    zIndex: 2,
  };
}

/** Whichever corner panel is open hangs below the whole button stack. */
function panelCorner(buttonCount: number): CSSProperties {
  return {
    position: "absolute",
    top: 12 + buttonCount * 40 + 4,
    right: 12,
    zIndex: 2,
  };
}

/**
 * Give each customer a standing spot, preferring the lane in front of the
 * shelf column holding the item they're examining so the bubble reads against
 * the right item. Contested lanes fall back to the first free spot; spots past
 * the front row (indices >= lane count) are the back row.
 */
function placeCustomers(customers: Adventurer[], s: GameState, layout: ShelfLayout) {
  const lanes = layout.cols;
  const wanted = customers.map((a) => {
    const slot = a.browsingItemId
      ? s.shelves.findIndex((it) => it?.id === a.browsingItemId)
      : -1;
    return {
      a,
      item: slot >= 0 ? s.shelves[slot] : null,
      preferred: slot >= 0 ? slot % layout.cols : -1,
    };
  });

  const taken = new Set<number>();
  const placed: { a: Adventurer; item: Item | null; spot: number }[] = [];

  // Pass 1: everyone who wants a specific lane and can have it.
  for (const w of wanted) {
    if (w.preferred >= 0 && !taken.has(w.preferred)) {
      taken.add(w.preferred);
      placed.push({ a: w.a, item: w.item, spot: w.preferred });
    }
  }
  // Pass 2: everyone else takes the first free spot (front row, then back).
  for (const w of wanted) {
    if (placed.some((p) => p.a.id === w.a.id)) continue;
    let spot = 0;
    while (spot < lanes * 2 - 1 && taken.has(spot)) spot++;
    taken.add(spot);
    placed.push({ a: w.a, item: w.item, spot });
  }
  return placed;
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
  particles?: Particles,
) {
  const s = engine.state;

  // ---- Room ----
  rect(ctx, 0, 0, WORLD_W, WORLD_H, "#3a2c22"); // back wall (dark wood)
  rect(ctx, 0, WORLD_H - 200, WORLD_W, 200, "#6b4a2e"); // floor (lighter planks)
  // Floor plank seams
  for (let x = 0; x < WORLD_W; x += 96) rect(ctx, x, WORLD_H - 200, PX, 200, "#5a3e26");
  rect(ctx, 0, WORLD_H - 204, WORLD_W, PX, "#2c1f18"); // floor/wall trim

  // ---- Shelves with stock ----
  // The grid follows however many slots the shop has, so an expansion widens
  // the shelving instead of overflowing it.
  const layout = shelfLayout(s.shelves.length);
  const boardW = layout.cols * layout.slotW + 16;
  for (let row = 0; row < ROWS; row++) {
    const shelfY = GRID_Y + row * SLOT_H + ICON_PX + 20;
    // Shelf board spanning the row
    rect(ctx, GRID_MARGIN - 8, shelfY, boardW, 12, PALETTE.wood[0]);
    rect(ctx, GRID_MARGIN - 8, shelfY, boardW, PX, PALETTE.wood[1]); // top highlight
    rect(ctx, GRID_MARGIN - 8, shelfY + 12, boardW, PX, "#2c1f18"); // shadow

    for (let col = 0; col < layout.cols; col++) {
      const slotIndex = row * layout.cols + col;
      const item = s.shelves[slotIndex];
      const { x } = slotRect(col, row, layout);
      const iconX = x + (layout.slotW - ICON_PX) / 2;
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
      ctx.fillText(label, x + layout.slotW / 2, shelfY + 36);
    }
  }
  ctx.textAlign = "left";

  // ---- Counter + shopkeeper ----
  const counterY = WORLD_H - 150;
  drawCharacter(
    ctx,
    { class: "veteran", appearance: { skin: 2, hair: 2 }, equipment: {} },
    WORLD_W / 2 - 20,
    counterY - 64,
    0,
    "down", // stationary behind the counter, facing the customers
  );
  rect(ctx, WORLD_W / 2 - 180, counterY, 360, 40, PALETTE.wood[0]); // counter top
  rect(ctx, WORLD_W / 2 - 180, counterY, 360, PX, PALETTE.wood[1]); // highlight
  rect(ctx, WORLD_W / 2 - 180, counterY + 40, 360, 24, "#4a3220"); // counter front

  // ---- Customers ----
  // Everyone inside the shop: shoppers and adventurers waiting to sell loot
  // (TownView stops drawing them outdoors, issue #15). Sorted by id so a
  // customer keeps the same spot frame to frame, and drawn after the counter
  // since they stand on the near side of it.
  const customers = s.adventurers
    .filter(
      (a) =>
        a.alive &&
        (a.state === "browsing" || a.state === "buying" || a.state === "selling_loot"),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const idleFrame = (Math.floor(performance.now() / 500) % 2) as 0 | 1;
  const spots = placeCustomers(customers, s, layout);

  // Back row first so the front row overlaps it.
  for (const { a, item, spot } of [...spots].sort((p, q) => q.spot - p.spot)) {
    const back = spot >= layout.cols;
    const x = spotX(spot % layout.cols, layout) + (back ? layout.slotW / 2 : 0);
    const feetY = back ? AISLE_BACK_Y : AISLE_FRONT_Y;
    const headY = feetY - CHAR_H;

    rect(ctx, x - 16, feetY - PX, 32, PX, "#2c1f18"); // floor shadow
    drawCharacter(ctx, a, x - 20, headY, idleFrame, a.position.facing);

    // Name below the feet, leaving the airspace above the head to the bubble.
    ctx.font = `${3 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText(a.name, x, feetY + 16);

    // Reaction to the item they're examining (§6). computeReaction is the
    // single source of the verdict — this only draws what it returns.
    if (item) drawReaction(ctx, computeReaction(a, item), x, headY);

    // Coins in hand once the engine has decided the sale.
    if (a.state === "buying") {
      rect(ctx, x + 20, headY + 28, 12, 12, PALETTE.gold);
      rect(ctx, x + 20, headY + 28, 12, PX, "#f4dc9a");
    }
  }
  ctx.textAlign = "left";

  // ---- Sign ----
  ctx.font = `${5 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textLight;
  ctx.fillText("YOUR SHOP", WORLD_W / 2, 48);
  ctx.font = `${3 * PX}px monospace`;
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText("Day " + s.day + " · " + s.phase, WORLD_W / 2, 74);
  particles?.draw(ctx);

  // ---- Lighting ----
  // The shop feels the time of day like the town does, but softer — it's
  // indoors — and the lamps over the counter push back after dark.
  const tint = skyTint(s.timeOfDay);
  if (tint.alpha > 0) {
    ctx.globalAlpha = tint.alpha * 0.7;
    rect(ctx, 0, 0, WORLD_W, WORLD_H, tint.color);
    ctx.globalAlpha = 1;
  }
  if (s.phase === "night" || s.phase === "evening") {
    const strength = s.phase === "night" ? 1 : 0.6;
    // Lanterns hang either side of the sign, clear of the shelving.
    for (const lampX of [140, WORLD_W - 140]) {
      rect(ctx, lampX - PX, 40, PX * 2, 18, "#2c1f18"); // chain
      rect(ctx, lampX - 12, 58, 24, 20, "#3a2c22"); // housing
      rect(ctx, lampX - 8, 62, 16, 12, "#ffd98a"); // flame
      // Light, stepped rather than blended to stay on-style.
      for (const [halfW, alpha] of [
        [28, 0.1],
        [60, 0.06],
        [96, 0.035],
      ] as const) {
        ctx.globalAlpha = alpha * strength;
        rect(ctx, lampX - halfW, 78, halfW * 2, WORLD_H - 140, "#ffd98a");
      }
    }
    ctx.globalAlpha = 1;
  }

  // One status line under the sign, most urgent first: someone waiting to sell
  // (their offer expires at nightfall), else who's in the shop, else the hint.
  // (It lives up here — the floor below the counter belongs to customers.)
  if (s.lootOffers.length > 0) {
    const names = s.lootOffers.map((o) => o.adventurerName.split(" ")[0]);
    const who = names.length === 1 ? names[0] : `${names.length} adventurers`;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(`${who} waiting to sell you loot`, WORLD_W / 2, 96);
  } else if (customers.length > 0) {
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(
      `${customers.length} ${customers.length === 1 ? "customer" : "customers"} in the shop`,
      WORLD_W / 2,
      96,
    );
  } else if (selectedSlot === null) {
    ctx.fillText("click an item to price it", WORLD_W / 2, 96);
  }
  ctx.textAlign = "left";
}
