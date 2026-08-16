// Daily trade ledger (playtest feature). Records what actually happened at
// the counter so the player can learn from numbers as well as faces (§17).
// Only player-observable information: "restock cost" is the wholesale price
// (= base value) the player sees on the cart, so a sold-at-a-loss count
// teaches without leaking what adventurers privately think items are worth.

import type { DayLedger, GameState, Item, Reaction } from "../types";

export const LEDGER_HISTORY_DAYS = 7;

export function freshLedger(day: number): DayLedger {
  return {
    day,
    revenue: 0,
    salesCount: 0,
    soldAtLoss: 0,
    reactions: { happy: 0, neutral: 0, unhappy: 0, angry: 0 },
    walkouts: 0,
    restockSpend: 0,
    lootSpend: 0,
    donationsReceived: 0,
    payrollSpend: 0,
    repairRevenue: 0,
  };
}

export function recordSale(s: GameState, item: Item, price: number): void {
  s.ledger.revenue += price;
  s.ledger.salesCount += 1;
  if (price < item.baseValue) s.ledger.soldAtLoss += 1;
}

export function recordReactionSeen(s: GameState, reaction: Reaction): void {
  s.ledger.reactions[reaction] += 1;
}

export function recordWalkout(s: GameState): void {
  s.ledger.walkouts += 1;
}

export function recordRestock(s: GameState, cost: number): void {
  s.ledger.restockSpend += cost;
}

export function recordLootBuy(s: GameState, cost: number): void {
  s.ledger.lootSpend += cost;
}

export function recordDonation(s: GameState): void {
  s.ledger.donationsReceived += 1;
}

/** Hired-staff payroll (spec V2.9, issue #91): a cut of the day's revenue,
 *  paid out at rollover — see GameEngine.onNewDay, which calls this against
 *  the OUTGOING ledger before it rotates into history. */
export function recordPayroll(s: GameState, amount: number): void {
  s.ledger.payrollSpend += amount;
}

/** The forge's repair service (spec V2.9, issue #91): revenue collected
 *  when an adventurer pays to have gear repaired instead of buying new. */
export function recordRepairRevenue(s: GameState, amount: number): void {
  s.ledger.repairRevenue += amount;
}

/** Roll the ledger at the day boundary. */
export function rotateLedger(s: GameState, newDay: number): void {
  s.ledgerHistory.push(s.ledger);
  if (s.ledgerHistory.length > LEDGER_HISTORY_DAYS) {
    s.ledgerHistory.splice(0, s.ledgerHistory.length - LEDGER_HISTORY_DAYS);
  }
  s.ledger = freshLedger(newDay);
}

/** Player-facing insights derived from the ledger — plain sentences the
 *  night summary (or any panel) can show. Ordered most important first. */
export function ledgerInsights(l: DayLedger): string[] {
  const out: string[] = [];
  if (l.soldAtLoss > 0) {
    out.push(
      `⚠ ${l.soldAtLoss} of ${l.salesCount} sales went for LESS than restocking costs — you lose gold on those.`,
    );
  }
  const r = l.reactions;
  const seen = r.happy + r.neutral + r.unhappy + r.angry;
  if (seen > 0 && r.happy === seen && l.salesCount > 0) {
    out.push(
      "Every reaction today was a big smile — instant delight usually means your prices are lower than they need to be.",
    );
  }
  if (l.walkouts >= 2) {
    out.push(`${l.walkouts} customers walked out angry over prices — that spreads at the tavern.`);
  }
  if (seen > 0 && (r.unhappy + r.angry) / seen > 0.5) {
    out.push("Most shoppers frowned at your shelves today — the sweet spot is lower than this.");
  }
  const spend = l.restockSpend + l.lootSpend;
  if (spend > l.revenue && l.salesCount > 0) {
    out.push(
      `You spent ${spend}g stocking up against ${l.revenue}g of sales — fine if the shelves are full, a hole if it keeps up.`,
    );
  }
  if (l.donationsReceived > 0) {
    out.push("You're trading on charity right now — price above restock cost to climb out.");
  }
  if (l.payrollSpend > 0) {
    out.push(`Hired staff took ${l.payrollSpend}g in payroll today.`);
  }
  if (l.repairRevenue > 0) {
    out.push(`The forge brought in ${l.repairRevenue}g repairing gear instead of selling it new.`);
  }
  return out;
}
