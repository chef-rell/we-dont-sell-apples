// Night summary overlay (spec §4). Night fast-forwards at 3×, so instead of
// watching an empty town for forty seconds the player gets the day's ledger:
// what they earned, what they sold, who didn't come back.
//
// The engine's stats are cumulative, so the day's numbers are deltas against a
// snapshot taken when the day rolled over. That bookkeeping lives here in the
// UI — the sim doesn't need to know the player is reading a summary.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ITEM_DEFS } from "../entities/Item";
import type { GameEngine } from "../game/GameEngine";
import { ledgerInsights } from "../game/Ledger";
import type { GameState } from "../types";
import { PALETTE } from "../utils/constants";
import { getBuilding } from "../utils/TownBuildings";

interface DaySnapshot {
  day: number;
  gold: number;
  totalGoldEarned: number;
  itemsSold: number;
  adventurersServed: number;
  adventurersLost: number;
}

function snapshot(s: GameState): DaySnapshot {
  return {
    day: s.day,
    gold: s.gold,
    totalGoldEarned: s.stats.totalGoldEarned,
    itemsSold: s.stats.itemsSold,
    adventurersServed: s.stats.adventurersServed,
    adventurersLost: s.stats.adventurersLost,
  };
}

interface CraftItemCounts {
  herb: number;
  moon: number;
  potion: number;
}

interface ProductionTally {
  herb: number;
  moon: number;
  brews: number;
}

/** Counts craft-track items across BOTH inventory and shelves (combined),
 *  so the total is robust against the player shelving a just-produced item
 *  between polls — the total only drops if something actually sells, which
 *  is astronomically unlikely inside a 250ms window. */
function countCraftItems(s: GameState): CraftItemCounts {
  const count = (name: string) =>
    s.inventory.filter((it) => it.name === name).length +
    s.shelves.filter((it) => it?.name === name).length;
  return {
    herb: count(ITEM_DEFS.herb_bundle.name),
    moon: count(ITEM_DEFS.moon_blossom.name),
    potion: count(ITEM_DEFS.health_potion.name),
  };
}

export function NightSummary({ engine }: { engine: GameEngine }) {
  const dayStart = useRef<DaySnapshot>(snapshot(engine.state));
  // Garden/lab production runs atomically inside GameEngine.onNewDay() — by
  // the time this poll notices s.day changed, runCraftProduction(s) has
  // already run (s.day flips, THEN production, all inside one 250ms-poll-
  // invisible tick — see onNewDay()). There's no "before" state to diff
  // against using the day-change instant alone, so every tick captures item
  // counts unconditionally; the day-change branch below reconstructs the
  // night's production from the delta against the last observed counts.
  const lastPollItemCounts = useRef<CraftItemCounts>(countCraftItems(engine.state));
  const lastProduction = useRef<ProductionTally>({ herb: 0, moon: 0, brews: 0 });
  const [showing, setShowing] = useState(false);
  const [dismissedDay, setDismissedDay] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const s = engine.state;
      const currentCounts = countCraftItems(s);
      // New day: the previous day's baseline is no longer useful.
      if (s.day !== dayStart.current.day) {
        const prev = lastPollItemCounts.current;
        const herbDelta = currentCounts.herb - prev.herb;
        const moonDelta = currentCounts.moon - prev.moon;
        const potionDelta = currentCounts.potion - prev.potion;
        const brews = Math.max(0, potionDelta);
        lastProduction.current = {
          // Add back what the lab consumed the same tick: the lab eats
          // exactly 1 herb + 1 moon in the SAME runCraftProduction() call
          // that may also add the garden's fresh herb/moon that same
          // morning (both happen inside one atomic tick), so a raw delta
          // undercounts gross garden output by whatever the lab ate. Exact
          // under normal play — herb_bundle/moon_blossom are produced only
          // by the garden and consumed only by the lab. Known edge case: if
          // the player manually shelves-and-sells a raw herb_bundle/
          // moon_blossom in the ~250ms window right at rollover, this could
          // be off by one — negligible.
          herb: Math.max(0, herbDelta + brews),
          moon: Math.max(0, moonDelta + brews),
          brews,
        };
        dayStart.current = snapshot(s);
        setDismissedDay(null);
      }
      lastPollItemCounts.current = currentCounts;
      setShowing(s.phase === "night" && s.view !== "gameover");
      setTick((t) => t + 1);
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  const s = engine.state;
  if (!showing || dismissedDay === s.day) return null;

  const base = dayStart.current;
  const earned = s.stats.totalGoldEarned - base.totalGoldEarned;
  const sold = s.stats.itemsSold - base.itemsSold;
  const served = s.stats.adventurersServed - base.adventurersServed;
  const lost = s.stats.adventurersLost - base.adventurersLost;
  const purse = s.gold - base.gold; // earnings minus restocking and loot buys

  // The day's own notable lines, most recent last, trimmed to fit.
  const events = s.messages.filter((m) => m.day === s.day && m.type === "system").slice(-4);
  const insights = ledgerInsights(s.ledger);

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ color: PALETTE.textLight, fontSize: 20 }}>Day {s.day} · closing up</div>
        <div style={{ color: PALETTE.textDim, fontSize: 11 }}>the town sleeps; night passes quickly</div>

        <div style={rowsStyle}>
          <Row label="Gold taken in" value={`${earned}g`} good={earned > 0} />
          <Row label="Items sold" value={sold} good={sold > 0} />
          <Row label="Adventurers served" value={served} good={served > 0} />
          <Row
            label="Purse, start to end"
            value={`${purse >= 0 ? "+" : ""}${purse}g`}
            good={purse >= 0}
            bad={purse < 0}
          />
          <Row label="Adventurers lost" value={lost} bad={lost > 0} />
        </div>

        <Reactions ledger={s.ledger} />

        <Production s={s} lastProduction={lastProduction.current} />

        {insights.length > 0 && (
          <div style={insightsStyle}>
            {insights.map((line) => (
              <div
                key={line}
                style={{
                  color: line.startsWith("⚠") ? "#e07030" : PALETTE.textLight,
                  fontSize: 12,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div style={eventsStyle}>
            {events.map((m) => (
              <div key={m.id} style={{ color: PALETTE.textDim, fontSize: 11 }}>
                · {m.content}
              </div>
            ))}
          </div>
        )}

        <button style={buttonStyle} onClick={() => setDismissedDay(s.day)}>
          Turn in
        </button>
      </div>
    </div>
  );
}

/** Today's reaction tally — the §17 learning signal, made countable. */
function Reactions({ ledger }: { ledger: GameState["ledger"] }) {
  const r = ledger.reactions;
  const total = r.happy + r.neutral + r.unhappy + r.angry;
  if (total === 0) return null;
  return (
    <div style={reactionsStyle}>
      <span style={{ color: "#5bbf5b" }}>🙂 {r.happy}</span>
      <span style={{ color: "#d9b93a" }}>😐 {r.neutral}</span>
      <span style={{ color: "#d98a3a" }}>🙁 {r.unhappy}</span>
      <span style={{ color: "#c0392b" }}>😠 {r.angry}</span>
      <span style={{ color: PALETTE.textDim, fontSize: 11 }}>reactions today</span>
    </div>
  );
}

/** Last night's craft-track production (spec V2.9, issue #92): garden/lab
 *  output reconstructed by the poll effect above, forge orders/repairs read
 *  straight off state, payroll previewed the same way the engine will
 *  charge it at tonight's rollover. A complete no-op — matching this
 *  repo's "no-craft path is structurally a no-op" convention already
 *  established in Property.ts — for every pre-#91 save and every save
 *  where the player hasn't touched the craft track. */
function Production({ s, lastProduction }: { s: GameState; lastProduction: ProductionTally }) {
  const garden = getBuilding(s.buildings, "garden");
  const lab = getBuilding(s.buildings, "alchemy_lab");
  const forge = getBuilding(s.buildings, "forge");
  if (!garden && !lab && !forge && s.staff.length === 0) return null;

  const forgeOrders = forge?.lastProducedDay === s.day ? 1 : 0;
  const repairsCount = s.messages.filter(
    (m) => m.day === s.day && m.type === "system" && m.content.includes("repaired at the forge"),
  ).length;
  const repairRevenue = s.ledger.repairRevenue;
  // Payroll for day N is deducted at the N->N+1 rollover, so it never
  // lands in the "live" ledger this panel reads during day N's night phase
  // (see GameEngine.onNewDay()'s staff loop, which runs before rotateLedger).
  // This panel shows "tonight," and payroll IS charged as part of tonight's
  // rollover, so preview it read-only the same way the engine will compute
  // it rather than showing a stale/zero historical figure.
  const payroll = s.staff.reduce((sum, st) => sum + Math.round(st.cut * s.ledger.revenue), 0);

  return (
    <div style={rowsStyle}>
      <div style={{ color: PALETTE.textDim, fontSize: 11 }}>production tonight</div>
      {garden && (
        <Row
          label="Garden yielded"
          value={`${lastProduction.herb} herb, ${lastProduction.moon} moon`}
          good={lastProduction.herb + lastProduction.moon > 0}
        />
      )}
      {lab && <Row label="Lab brewed" value={lastProduction.brews} good={lastProduction.brews > 0} />}
      {forge && <Row label="Forge orders" value={forgeOrders} good={forgeOrders > 0} />}
      {(forge || repairsCount > 0 || repairRevenue > 0) && (
        <Row
          label="Repairs done"
          value={repairRevenue > 0 ? `${repairsCount} (${repairRevenue}g)` : repairsCount}
          good={repairsCount > 0}
        />
      )}
      {s.staff.length > 0 && <Row label="Payroll (tonight)" value={`${payroll}g`} bad={payroll > 0} />}
    </div>
  );
}

function Row({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string | number;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div style={rowStyle}>
      <span style={{ color: PALETTE.textDim, fontSize: 12 }}>{label}</span>
      <span
        style={{
          color: bad ? "#c0392b" : good ? PALETTE.gold : PALETTE.textLight,
          fontSize: 15,
        }}
      >
        {value}
      </span>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(10,10,20,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 5,
  fontFamily: "monospace",
};

const cardStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 20,
  width: 380,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const rowsStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  borderBottom: `2px solid #22223c`,
  paddingBottom: 4,
};

const reactionsStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "baseline",
  fontSize: 14,
};

const insightsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  borderLeft: `4px solid ${PALETTE.uiBorder}`,
  paddingLeft: 8,
};

const eventsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  maxHeight: 90,
  overflowY: "auto",
};

const buttonStyle: CSSProperties = {
  alignSelf: "flex-end",
  background: "#2a2a44",
  border: `2px solid ${PALETTE.gold}`,
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 14,
  padding: "6px 14px",
  cursor: "pointer",
};
