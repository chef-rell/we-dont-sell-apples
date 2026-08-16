// Notification toasts (spec §15 Phase 5). The chat panel carries everything
// the town says; toasts carry the handful of things the player must not miss
// while they're looking at a shelf instead of the feed.
//
// Toasts are derived from state deltas rather than parsed out of message text,
// so a reworded system message can never silently stop notifying.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { GameState } from "../types";
import { PALETTE } from "../utils/constants";

const LIFETIME_MS = 4500;
const MAX_VISIBLE = 3;

type ToastTone = "good" | "bad" | "info";

interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
  bornAt: number;
}

interface Watch {
  itemsSold: number;
  goldEarned: number;
  livingIds: Set<string>;
  knownIds: Set<string>;
  offerIds: Set<string>;
  merchant: boolean;
  day: number;
}

function read(s: GameState): Watch {
  return {
    itemsSold: s.stats.itemsSold,
    goldEarned: s.stats.totalGoldEarned,
    livingIds: new Set(s.adventurers.filter((a) => a.alive).map((a) => a.id)),
    knownIds: new Set(s.adventurers.map((a) => a.id)),
    offerIds: new Set(s.lootOffers.map((o) => o.id)),
    merchant: s.merchant !== null,
    day: s.day,
  };
}

export function Toasts({ engine }: { engine: GameEngine }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prev = useRef<Watch>(read(engine.state));
  const nextId = useRef(1);

  useEffect(() => {
    const id = setInterval(() => {
      const s = engine.state;
      const now = read(s);
      const was = prev.current;
      const fresh: Omit<Toast, "id" | "bornAt">[] = [];

      // A sale: the earnings delta is the price the player set.
      if (now.itemsSold > was.itemsSold) {
        const take = now.goldEarned - was.goldEarned;
        fresh.push({ text: take > 0 ? `Sold an item · +${take}g` : "Sold an item", tone: "good" });
      }

      // Someone didn't come back.
      for (const a of s.adventurers) {
        if (was.livingIds.has(a.id) && !now.livingIds.has(a.id)) {
          fresh.push({ text: `${a.name} didn't come back`, tone: "bad" });
        }
        if (!was.knownIds.has(a.id)) {
          fresh.push({ text: `${a.name} has arrived in town`, tone: "info" });
        }
      }

      // Loot on the counter, and the cart pulling in.
      for (const o of s.lootOffers) {
        if (!was.offerIds.has(o.id)) {
          fresh.push({ text: `${o.adventurerName} is selling ${o.item.name}`, tone: "info" });
        }
      }
      if (now.merchant && !was.merchant) {
        fresh.push({ text: "The wholesale cart has arrived", tone: "info" });
      }

      prev.current = now;

      const stamp = Date.now();
      setToasts((current) => {
        const kept = current.filter((t) => stamp - t.bornAt < LIFETIME_MS);
        const added = fresh.map((f) => ({ ...f, id: nextId.current++, bornAt: stamp }));
        return [...kept, ...added].slice(-MAX_VISIBLE);
      });
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  if (toasts.length === 0) return null;

  return (
    <div style={stackStyle}>
      {toasts.map((t) => (
        <div key={t.id} style={{ ...toastStyle, borderColor: TONE[t.tone] }}>
          <span style={{ color: TONE[t.tone] }}>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

const TONE: Record<ToastTone, string> = {
  good: PALETTE.gold,
  bad: "#c0392b",
  info: PALETTE.textLight,
};

// Below the views' top-left "← Town" button, so the two never collide.
const stackStyle: CSSProperties = {
  position: "absolute",
  top: 56,
  left: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  zIndex: 3,
  pointerEvents: "none", // never steals a click meant for the shelves
};

const toastStyle: CSSProperties = {
  background: "rgba(26,26,46,0.94)",
  border: `2px solid ${PALETTE.uiBorder}`,
  padding: "6px 10px",
  fontFamily: "monospace",
  fontSize: 12,
};
