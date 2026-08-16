// Balance report harness: plays N headless game days at several pricing
// strategies and prints comparative economy metrics. Run before/after
// balance changes and alongside playtests:
//
//   npx tsx scripts/balance-report.ts [days]
//
// Not part of the app bundle — dev tooling only.

import { GameEngine } from "../src/game/GameEngine";
import { makeItem } from "../src/entities/Item";

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
  // v2 party path (spec V2.5/V2.6, issue #76) — additive, informational.
  scripts: number; // distinct AdventureScripts generated
  avgPartySize: number;
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
  // Party path instrumentation (issue #76): every currentScript is
  // generated once at the afternoon boundary and cleared at day rollover,
  // so counting distinct ids seen this run tells us how many party (or
  // solo-of-one) scripts actually formed and how big they averaged.
  const seenScriptIds = new Set<string>();
  let totalPartySize = 0;
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
    if (e.state.currentScript && !seenScriptIds.has(e.state.currentScript.id)) {
      seenScriptIds.add(e.state.currentScript.id);
      totalPartySize += e.state.currentScript.partyIds.length;
    }
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
    scripts: seenScriptIds.size,
    avgPartySize: seenScriptIds.size ? Math.round((totalPartySize / seenScriptIds.size) * 10) / 10 : 0,
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
    scripts: sum((r) => r.scripts),
    avgPartySize: Math.round((rs.reduce((s, r) => s + r.avgPartySize, 0) / n) * 10) / 10,
  };
}

// ---------- Wipe scenario (spec V2.6, issue #76 — mandatory alongside parties) ----------
//
// Deliberately guts the starting cast (fragile hp, bare gear, zero gold so
// fallbackMorningPlan sends them adventuring instead of shopping) and runs
// long enough to force a multi-death day, then reports how fast and how
// large the replacement wave lands. Proves the wipe stabilizer (deaths pull
// the next arrival wave's due date in and size it) rather than leaving the
// town to trickle back one newcomer at a time after a hard week.
interface WipeReport {
  daysToMultiDeath: number | null; // day the 3rd death (since the last wave) landed
  firstWaveSize: number | null; // newcomers in that wave
  daysToFirstWave: number | null; // days from the multi-death point to the wave landing
  finalAdventurerCount: number;
}

function runWipeScenario(days: number): WipeReport {
  store.clear();
  const e = new GameEngine(false);
  e.state.aiMode = "off";
  for (const a of e.state.adventurers) {
    a.daysSinceLastAdventure = 99; // restless enough to clear the "adventure" bar immediately
    a.gold = 0; // fallbackMorningPlan shops first whenever gold >= 25 and gear is bare
    a.maxHp = 3;
    a.hp = 3; // full (small) health so it doesn't route to "rest" either
    a.level = 1;
    a.equipment = {};
    a.personality.riskTolerance = 90; // keeps clearing the restlessness bar after a day off
  }

  let deathsSinceWaveStart = 0;
  let daysToMultiDeath: number | null = null;
  let firstWaveSize: number | null = null;
  let daysToFirstWave: number | null = null;
  let prevAliveCount = e.state.adventurers.filter((a) => a.alive).length;
  let prevTotalCount = e.state.adventurers.length;

  const ticks = days * 600 * 10;
  for (let i = 0; i < ticks; i++) {
    e.tick(100);
    const aliveNow = e.state.adventurers.filter((a) => a.alive).length;
    if (aliveNow < prevAliveCount) deathsSinceWaveStart += prevAliveCount - aliveNow;
    prevAliveCount = aliveNow;

    if (daysToMultiDeath === null && deathsSinceWaveStart >= 3) {
      daysToMultiDeath = e.state.day;
    }
    if (daysToMultiDeath !== null && e.state.adventurers.length > prevTotalCount) {
      if (firstWaveSize === null) {
        firstWaveSize = e.state.adventurers.length - prevTotalCount;
        daysToFirstWave = e.state.day - daysToMultiDeath;
      }
      deathsSinceWaveStart = 0;
    }
    prevTotalCount = e.state.adventurers.length;
  }

  return {
    daysToMultiDeath,
    firstWaveSize,
    daysToFirstWave,
    finalAdventurerCount: e.state.adventurers.length,
  };
}

console.log(`Balance report: ${DAYS} game days, ${RUNS_PER_STRATEGY} runs per strategy (averaged)\n`);
const rows = STRATEGIES.map((m) =>
  averageReports(Array.from({ length: RUNS_PER_STRATEGY }, () => run(m, DAYS))),
);

const header = ["markup", "gold", "worth", "sold", "restock", "lootBuy", "deaths", "advGold", "loyalty", "morale", "scripts", "avgSz"];
console.log(header.map((h) => h.padStart(8)).join(""));
for (const r of rows) {
  console.log(
    [
      `${r.markup}×`, r.gold, r.netWorth, r.sold, r.wholesaleBought, r.lootBought,
      r.deaths, r.avgAdventurerGold, r.avgLoyalty, r.avgMorale, r.scripts, r.avgPartySize,
    ].map((v) => String(v).padStart(8)).join(""),
  );
}
console.log(
  "\nReading it: gold should peak somewhere in the middle bands (1.1-1.5×) — if a" +
  "\nsingle strategy strictly dominates, the §6 discovery game is shallow. Loyalty" +
  "\nshould fall as markup rises; deaths should track adventuring volume, not markup." +
  "\n'scripts'/'avgSz' are the v2 party path (issue #76): distinct AdventureScripts" +
  "\ngenerated and their average party size — solo (size 1) is the common case with" +
  "\nthe starting cast of 6, since restlessness rarely lines up more than a couple of" +
  "\nadventurers on the same afternoon.",
);

console.log(`\nWipe scenario (spec V2.6, ${DAYS} game days, ${RUNS_PER_STRATEGY} runs, deliberately fragile starting cast):\n`);
const wipeRows = Array.from({ length: RUNS_PER_STRATEGY }, () => runWipeScenario(DAYS));
const wipeHeader = ["run", "multiDeathDay", "firstWaveSize", "daysToWave", "finalCount"];
console.log(wipeHeader.map((h) => h.padStart(14)).join(""));
wipeRows.forEach((w, i) => {
  console.log(
    [i + 1, w.daysToMultiDeath ?? "-", w.firstWaveSize ?? "-", w.daysToFirstWave ?? "-", w.finalAdventurerCount]
      .map((v) => String(v).padStart(14))
      .join(""),
  );
});
console.log(
  "\nReading it: 'multiDeathDay' is when 3+ deaths piled up since the last wave" +
  "\n(a hard week); 'firstWaveSize' should often exceed 1 — the wipe stabilizer" +
  "\nsizes the next replacement wave to the death count instead of trickling" +
  "\nnewcomers in one at a time. '-' means that run's window ended before the" +
  "\ncondition was hit (raise DAYS to see it more reliably).",
);

// ---------- Craft scenario (spec V2.9, issue #91) ----------
//
// The no-craft path above is untouched by this PR (no helper is ever
// created there, so runCraftProduction/the payroll loop are structural
// no-ops) — this scenario exercises the NEW loop instead: a forge built
// ~day 12, helper on craft duty, hired staff, and a steady drip of forge
// orders + repair-fuel materials, so the ledger's new payroll/repair lines
// actually show non-zero numbers here (CLAUDE.md's determinism discipline:
// direct state setup / no unseeded randomness in the scenario itself).
// Runs a fixed 30-day horizon regardless of the CLI `days` arg, so the
// day-12 build point and several days of production after it are always in
// the window even for a short `npx tsx scripts/balance-report.ts 7`.
const CRAFT_HORIZON_DAYS = 30;

interface CraftReport {
  finalDay: number;
  gold: number;
  staffCount: number;
  payrollTotal: number; // summed across ledgerHistory's payrollSpend
  repairRevenueTotal: number; // summed across ledgerHistory's repairRevenue
  forgedItemsOrdered: number;
  herbBundleStock: number;
  moonBlossomStock: number;
  healthPotionStock: number;
}

function runCraftScenario(): CraftReport {
  store.clear();
  const e = new GameEngine(false);
  e.state.aiMode = "off";
  const s = e.state;
  e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 1, hair: 1 }, "curious");
  s.gold = 3000; // headroom for all three build costs, isolating the craft loop from the sales grind

  // Ordinary shop-running policy (same shape as the STRATEGIES run() above)
  // so this scenario's ledger has REAL revenue for payroll to cut from, and
  // adventurers actually buy/equip/wear-down gear so a repair errand has
  // something to fire on — a craft scenario that never prices its shelves
  // would show payrollSpend/repairRevenue stuck at 0 for a reason that has
  // nothing to do with the craft loop itself.
  const priceAll = () => {
    for (const it of [...s.shelves, ...s.inventory]) {
      if (it && it.salePrice === null) e.setPrice(it.id, Math.max(1, Math.round(it.baseValue * 1.3)));
    }
  };
  priceAll();

  let built = false;
  let forgedItemsOrdered = 0;
  const ticksPerDay = 6000; // 10 min/day at 1x, 100ms ticks

  for (let i = 0; i < CRAFT_HORIZON_DAYS * ticksPerDay; i++) {
    e.tick(100);

    if (s.merchant && s.gold > 200) {
      for (const it of [...s.merchant.stock]) {
        if (s.gold > 200) e.buyWholesale(it.id);
      }
    }
    for (const o of [...s.lootOffers]) e.acceptLootOffer(o.id);
    if (i % 50 === 0) priceAll();

    if (!built && s.day >= 12) {
      // Direct state setup, not a grind to day 12+ on the real XP curve
      // (CLAUDE.md: "fixed seeds / direct state setup only" for new sims):
      // commit the craft track and jump the helper to L3 so all three
      // stages are unlocked the same day.
      if (s.helper) {
        s.helper.track = "craft";
        s.helper.trackChosenDay = s.day;
        s.helper.xp = 160; // L3 floor
        s.helper.level = 3;
        s.helper.assignment = "craft";
      }
      s.reputation = 0.5; // seeded so hireStaff's gate is open immediately
      for (const [key, n] of [["echo_crystal", 2], ["golem_plate", 2], ["core_shard", 1]] as [string, number][]) {
        for (let k = 0; k < n; k++) s.inventory.push(makeItem(key));
      }
      e.buildStructure("garden");
      e.buildStructure("alchemy_lab");
      e.buildStructure("forge");
      e.hireStaff("garden"); // payroll sink, independent of the helper's own craft duty
      built = true;
    }

    if (built) {
      if (s.helper) s.helper.assignment = "craft"; // stays on craft duty every rollover
      if (s.day % 3 === 0) {
        // 3 materials/drip: forgeOrder consumes 2, leaving a spare in stock
        // for a repair errand to draw on between drips.
        s.inventory.push(makeItem("crude_hide"), makeItem("crude_hide"), makeItem("crude_hide"));
        if (e.forgeOrder("iron_sword")) forgedItemsOrdered++;
      }
    }
  }

  const stockOf = (defName: string) =>
    s.inventory.filter((it) => it.name === defName).length +
    s.shelves.filter((it) => it?.name === defName).length;

  return {
    finalDay: s.day,
    gold: s.gold,
    staffCount: s.staff.length,
    payrollTotal: s.ledgerHistory.reduce((n, l) => n + l.payrollSpend, 0),
    repairRevenueTotal: s.ledgerHistory.reduce((n, l) => n + l.repairRevenue, 0),
    forgedItemsOrdered,
    herbBundleStock: stockOf("Herb Bundle"),
    moonBlossomStock: stockOf("Moon Blossom"),
    healthPotionStock: stockOf("Health Potion"),
  };
}

console.log(`\nCraft scenario (spec V2.9, issue #91, ${CRAFT_HORIZON_DAYS}-day fixed horizon, forge built ~day 12):\n`);
const craft = runCraftScenario();
console.log(
  [
    `final day: ${craft.finalDay}`,
    `gold: ${craft.gold}`,
    `staff hired: ${craft.staffCount}`,
    `ledger payrollSpend total: ${craft.payrollTotal}g`,
    `ledger repairRevenue total: ${craft.repairRevenueTotal}g`,
    `forge orders filled: ${craft.forgedItemsOrdered}`,
    `stock — herb_bundle: ${craft.herbBundleStock}, moon_blossom: ${craft.moonBlossomStock}, health_potion: ${craft.healthPotionStock}`,
  ].join("\n"),
);
console.log(
  "\nReading it: payrollSpend > 0 is the hired-staff sink (8% of daily sales," +
  "\npaid every rollover once staff exist); repairRevenue > 0 is the forge's" +
  "\nrepair service actually converting a would-be rebuy into a cheaper repair" +
  "\n(4a's prefersRepair, unchanged). Both lines are exactly 0 on the no-craft" +
  "\npath above — this scenario is the only place in the harness that builds" +
  "\nany garden/lab/forge at all.",
);
