// Moonlighter-style pricing widget (spec §6). The player clicks a shelf item,
// this panel opens, and they dial in a price with +/- buttons (hold to repeat)
// or by typing it directly.
//
// The item's baseValue is deliberately NEVER shown — fair prices are learned
// from adventurer reactions, which is the core gameplay loop (§6). This panel
// only writes `salePrice`; it computes no verdicts of its own.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { drawItemIcon, ICON_CELL } from "../rendering/ItemRenderer";
import type { Item } from "../types";
import { PALETTE, PX } from "../utils/constants";

const MAX_PRICE = 9999;
const DEFAULT_PRICE = 10; // opening price for an item type never priced before
const ICON_SCALE = 2;
const ICON_PX = ICON_CELL * PX * ICON_SCALE;

/** Remembers the last price the player set per item name, so restocked copies
 *  open at the price they already dialled in rather than back at the default. */
const lastPriceByName = new Map<string, number>();

export function PricingPanel({
  item,
  suggestion,
  onSetPrice,
  onClose,
}: {
  item: Item;
  /** Engine's opening suggestion: last SOLD price (proven to clear) or last
   *  set price. Null when this item name has no history. */
  suggestion?: { price: number; fromSale: boolean } | null;
  onSetPrice: (price: number | null) => void;
  onClose: () => void;
}) {
  const initialFor = (it: Item) =>
    it.salePrice ?? suggestion?.price ?? lastPriceByName.get(it.name) ?? DEFAULT_PRICE;
  const [price, setPrice] = useState(() => initialFor(item));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Mirrors item.salePrice !== null. The item is mutated outside React, so the
  // footer label needs local state to re-render when the tag comes on or off.
  const [listed, setListed] = useState(item.salePrice !== null);

  // Opening (or switching to) an item lists it at the shown price right away —
  // "not for sale until you nudge the number" was a new-player trap. Unprice
  // remains the explicit way to de-list.
  useEffect(() => {
    const initial = initialFor(item);
    setPrice(initial);
    setEditing(false);
    if (item.salePrice === null) {
      onSetPrice(initial);
    }
    setListed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const commit = (next: number) => {
    const clamped = clamp(Math.round(next), 1, MAX_PRICE);
    setPrice(clamped);
    setListed(true);
    lastPriceByName.set(item.name, clamped);
    onSetPrice(clamped);
  };

  const unprice = () => {
    setListed(false);
    onSetPrice(null);
  };

  const bump = (delta: number) => commit(price + delta);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commitDraft = () => {
    const parsed = parseInt(draft.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) commit(parsed);
    setEditing(false);
  };

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={titleRow}>
        <ItemIcon item={item} />
        <div>
          <div style={{ color: PALETTE.textLight, fontSize: 15 }}>{item.name}</div>
          <div style={{ color: PALETTE.textDim, fontSize: 12 }}>
            {item.category} · quality {item.quality}/10
            {suggestion?.fromSale && (
              <span style={{ color: PALETTE.gold }}> · last sold {suggestion.price}g</span>
            )}
          </div>
        </div>
      </div>

      <div style={priceRow}>
        <RepeatButton label="−10" onStep={() => bump(-10)} />
        <RepeatButton label="−1" onStep={() => bump(-1)} />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onFocus={(e) => e.target.select()} // typing replaces the old price
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              if (e.key === "Escape") {
                // Esc cancels editing only — don't let it reach the
                // window listener that closes the whole panel.
                e.stopPropagation();
                setEditing(false);
              }
            }}
            style={priceInput}
          />
        ) : (
          <button
            onClick={() => {
              setDraft(String(price));
              setEditing(true);
            }}
            title="Click to type a price"
            style={priceDisplay}
          >
            {price}g
          </button>
        )}
        <RepeatButton label="+1" onStep={() => bump(1)} />
        <RepeatButton label="+10" onStep={() => bump(10)} />
      </div>

      <div style={footerRow}>
        <span style={{ color: PALETTE.textDim, fontSize: 11 }}>
          {listed ? "on sale" : "not for sale yet"}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            style={smallButton}
            onClick={unprice}
            title="Remove the price tag — adventurers will ignore this item"
          >
            Unprice
          </button>
          <button style={{ ...smallButton, color: PALETTE.gold }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small canvas showing the item's procedural icon at 2×. */
function ItemIcon({ item }: { item: Item }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    ctx.save();
    ctx.scale(ICON_SCALE, ICON_SCALE);
    drawItemIcon(ctx, item, 0, 0);
    ctx.restore();
  }, [item]);
  return <canvas ref={ref} width={ICON_PX} height={ICON_PX} style={{ imageRendering: "pixelated" }} />;
}

/** Button that fires once on press, then repeats (accelerating) while held. */
function RepeatButton({ label, onStep }: { label: string; onStep: () => void }) {
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  // Held repeats must call the LATEST onStep, or every tick re-applies the
  // delta to the price captured when the press started.
  const step = useRef(onStep);
  step.current = onStep;

  const stop = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
    timers.current = {};
  };

  const start = () => {
    step.current();
    timers.current.delay = window.setTimeout(() => {
      let elapsed = 0;
      timers.current.repeat = window.setInterval(() => {
        elapsed += 80;
        step.current();
        if (elapsed > 1200 && timers.current.repeat) {
          // Second gear: speed up after a sustained hold.
          window.clearInterval(timers.current.repeat);
          timers.current.repeat = window.setInterval(() => step.current(), 30);
        }
      }, 80);
    }, 400);
  };

  useEffect(() => stop, []);

  return (
    <button
      style={stepButton}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {label}
    </button>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ---- styles (inline: the app has no CSS module setup) ----

const panelStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 12,
  width: 268,
  fontFamily: "monospace",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const titleRow: CSSProperties = { display: "flex", gap: 10, alignItems: "center" };

const priceRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 4,
};

const stepButton: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 14,
  padding: "6px 8px",
  cursor: "pointer",
  touchAction: "none",
  userSelect: "none",
};

const priceDisplay: CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 22,
  textAlign: "center",
  cursor: "text",
};

const priceInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#0e0e1c",
  border: `2px solid ${PALETTE.gold}`,
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 20,
  textAlign: "center",
  padding: "2px 0",
};

const footerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const smallButton: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
};
