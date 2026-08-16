// Balance report harness: plays N headless game days at several pricing
// strategies and prints comparative economy metrics. Run before/after
// balance changes and alongside playtests:
//
//   npx tsx scripts/balance-report.ts [days]
//
// Not part of the app bundle — dev tooling only.

import { GameEngine } from "../src/game/GameEngine";

// node has no localStorage; give persistence a throwaway one.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

const DAYS = Number(process.argv[2]) || 10;
const STRATEGIES = [0.9, 1.1, 1.2, 1.5, 1.8, 2.2];
const RUNS_PER_STRATEGY = 5; // average out combat randomness

interface Report {
  markup: number;
  gold: number;
  netWorth: number; // gold + stock at base value — the honest scoreboard
  sold: number;
  wholesaleBought: number;
  lootBought: number;
  deaths: number;
  outcomes: number;
  avgAdventurerGold: number;
  avgLoyalty: number;
  avgMorale: number;
}

function run(markup: number, days: number): Report {
  store.clear();
  const e = new GameEngine(false);
  e.state.aiMode = "off";
  const priceAll = () => {
    for (const it of e.state.shelves) {
      if (it && it.salePrice === null) e.setPrice(it.id, Math.max(1, Math.round(it.baseValue * markup)));
    }
  };
  priceAll();
  let wholesaleBought = 0;
  let lootBought = 0;
  const ticks = days * 600 * 10;
  for (let i = 0; i < ticks; i++) {
    e.tick(100);
    // Player policy: keep shelves stocked from the cart while gold is healthy,
    // buy all loot offered, keep everything priced at the strategy markup.
    if (e.state.merchant && e.state.gold > 80) {
      for (const it of [...e.state.merchant.stock]) {
        if (e.state.gold > 80 && e.buyWholesale(it.id)) wholesaleBought++;
      }
    }
    for (const o of [...e.state.lootOffers]) {
      if (e.acceptLootOffer(o.id)) lootBought++;
    }
    if (i % 50 === 0) priceAll();
  }
  const stockValue =
    e.state.shelves.reduce((s, it) => s + (it?.baseValue ?? 0), 0) +
    e.state.inventory.reduce((s, it) => s + it.baseValue, 0);
  const alive = e.state.adventurers.filter((a) => a.alive);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    markup,
    gold: e.state.gold,
    netWorth: e.state.gold + stockValue,
    sold: e.state.stats.itemsSold,
    wholesaleBought,
    lootBought,
    deaths: e.state.stats.adventurersLost,
    outcomes: e.state.recentOutcomes.length,
    avgAdventurerGold: Math.round(avg(alive.map((a) => a.gold))),
    avgLoyalty: Math.round(avg(alive.map((a) => a.loyalty))),
    avgMorale: Math.round(avg(alive.map((a) => a.morale))),
  };
}

function averageReports(rs: Report[]): Report {
  const n = rs.length;
  const sum = (f: (r: Report) => number) => Math.round(rs.reduce((s, r) => s + f(r), 0) / n);
  return {
    markup: rs[0].markup,
    gold: sum((r) => r.gold),
    netWorth: sum((r) => r.netWorth),
    sold: sum((r) => r.sold),
    wholesaleBought: sum((r) => r.wholesaleBought),
    lootBought: sum((r) => r.lootBought),
    deaths: sum((r) => r.deaths),
    outcomes: sum((r) => r.outcomes),
    avgAdventurerGold: sum((r) => r.avgAdventurerGold),
    avgLoyalty: sum((r) => r.avgLoyalty),
    avgMorale: sum((r) => r.avgMorale),
  };
}

console.log(`Balance report: ${DAYS} game days, ${RUNS_PER_STRATEGY} runs per strategy (averaged)\n`);
const rows = STRATEGIES.map((m) =>
  averageReports(Array.from({ length: RUNS_PER_STRATEGY }, () => run(m, DAYS))),
);

const header = ["markup", "gold", "worth", "sold", "restock", "lootBuy", "deaths", "advGold", "loyalty", "morale"];
console.log(header.map((h) => h.padStart(8)).join(""));
for (const r of rows) {
  console.log(
    [
      `${r.markup}×`, r.gold, r.netWorth, r.sold, r.wholesaleBought, r.lootBought,
      r.deaths, r.avgAdventurerGold, r.avgLoyalty, r.avgMorale,
    ].map((v) => String(v).padStart(8)).join(""),
  );
}
console.log(
  "\nReading it: gold should peak somewhere in the middle bands (1.1-1.5×) — if a" +
  "\nsingle strategy strictly dominates, the §6 discovery game is shallow. Loyalty" +
  "\nshould fall as markup rises; deaths should track adventuring volume, not markup.",
);
