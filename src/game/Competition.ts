// NPC competitor stores (spec V2.10, issue #94) — "deliberately shallow":
// visible pricing pressure, a destination for angry customers, the socket a
// real player fills in multiplayer. Same shape as Property.ts/Forge.ts:
// pure decide-phase functions GameEngine/AdventurerBehavior wire in, plus
// one state-mutating execute-phase function per action. Store CHOICE is
// Economy-style pure (adventurer + state -> store id | null); the §6
// verdict functions in game/Economy.ts are never touched, and buying at the
// player's own shop is completely unchanged.

import type { Adventurer, CompetitorStore, GameState } from "../types";
import { ITEM_DEFS } from "../entities/Item";
import { makeRng } from "../utils/rng";
import { COMPETITOR_PRICE_LEVELS, COMPETITOR_RECYCLE_POOREST_FRACTION, COMPETITOR_STOCK_ROTATION_DAYS } from "../utils/constants";

/** Basics pool competitor stock rotates from — the same "basics" flavor as
 *  the wholesale merchant's rotating stock (GameEngine.updateMerchant). */
const COMPETITOR_BASICS = [
  "iron_sword",
  "wooden_shield",
  "leather_armor",
  "health_potion",
  "rations",
  "travelers_cloak",
  "hunting_bow",
  "oak_staff",
];

/** Two fixed rival stores (spec V2.10). `till` starts at 0 — see
 *  `recycleCompetitorGold` below for where it goes. Called fresh (not
 *  shared/mutated), same convention as `defaultBuildings()`. */
export function defaultCompetitors(): CompetitorStore[] {
  return [
    { id: "competitor-north", name: "Grimshaw's Wares", priceLevel: COMPETITOR_PRICE_LEVELS[0], till: 0 },
    { id: "competitor-east", name: "The Iron Kettle", priceLevel: COMPETITOR_PRICE_LEVELS[1], till: 0 },
  ];
}

/** Cheap, deterministic string hash — just needs to spread store ids apart
 *  in seed space, not resist collisions adversarially. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Today's stock at `store`: 3-4 basics, re-rolled every
 *  COMPETITOR_STOCK_ROTATION_DAYS days, deterministic from day + store id
 *  (spec V2.10) — no state to persist, computed fresh whenever it's needed.
 *  Priced at `store.priceLevel` × the item's real baseValue. */
export function competitorStock(store: CompetitorStore, day: number): { key: string; price: number }[] {
  const rotation = Math.floor(Math.max(0, day) / COMPETITOR_STOCK_ROTATION_DAYS);
  const rng = makeRng((hashId(store.id) + rotation * 7919) >>> 0);
  const count = 3 + Math.floor(rng() * 2); // 3-4 items
  const pool = [...COMPETITOR_BASICS];
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked.map((key) => ({ key, price: Math.round(ITEM_DEFS[key].baseValue * store.priceLevel) }));
}

/**
 * Store choice (spec V2.10, §6-style pure function): which competitor an
 * adventurer heads to, or null if none of today's rotating stock is
 * affordable anywhere. Deterministic given `a` + `s` — the CALLER decides
 * WHETHER a visit is warranted (an angry walkout this trip, or 2+
 * consecutive days of nothing affordable on the player's own shelves — see
 * AdventurerBehavior.ts's leaveShop()); this function only picks WHERE,
 * always preferring the cheapest affordable item across every store,
 * tie-broken by store id for a stable result.
 */
export function chooseCompetitorStore(a: Adventurer, s: GameState): string | null {
  let best: { id: string; price: number } | null = null;
  for (const store of s.competitors) {
    for (const item of competitorStock(store, s.day)) {
      if (item.price > a.gold) continue;
      if (!best || item.price < best.price || (item.price === best.price && store.id < best.id)) {
        best = { id: store.id, price: item.price };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Execute-phase: buys the cheapest affordable basic at `storeId` (spec
 * V2.10 — "buys a basic there, gold leaves their wallet, enters the
 * competitor's till"). Deliberately shallow: no Item materializes in the
 * adventurer's inventory, matching "no full inventory simulation" — the
 * mechanic's entire footprint is the gold movement + the flavor beat.
 * Returns the item key + price paid, or null if nothing there is
 * affordable any more (a race with another adventurer's own gold changes
 * between the decide and execute phases — same "trip converts to nothing"
 * shape as Property.ts's repair errand).
 */
export function resolveCompetitorPurchase(
  a: Adventurer,
  s: GameState,
  storeId: string,
): { itemKey: string; price: number } | null {
  const store = s.competitors.find((c) => c.id === storeId);
  if (!store) return null;
  const affordable = competitorStock(store, s.day)
    .filter((it) => it.price <= a.gold)
    .sort((x, y) => x.price - y.price || x.key.localeCompare(y.key));
  if (affordable.length === 0) return null;
  const chosen = affordable[0];
  a.gold -= chosen.price;
  store.till += chosen.price;
  return { itemKey: chosen.key, price: chosen.price };
}

/**
 * Gold recycling (spec V2.9): each rollover, every competitor till's
 * balance splits deterministically across the poorest half of the ALIVE
 * town (min 1 recipient), then resets to 0 — "the town spends its money in
 * town." Conserves total gold exactly (integer share + remainder, same
 * pattern as Combat.ts's goldDrop split) and never touches `s.gold` or
 * `s.ledger` — it was never the player's money, so it's ledger-invisible.
 * A no-op when nobody's alive to receive it (till carries over rather than
 * vanishing — conservation over convenience).
 */
export function recycleCompetitorGold(s: GameState): void {
  const alive = s.adventurers.filter((a) => a.alive);
  if (alive.length === 0) return;
  const sorted = [...alive].sort((a, b) => a.gold - b.gold || a.id.localeCompare(b.id));
  const n = Math.max(1, Math.ceil(sorted.length * COMPETITOR_RECYCLE_POOREST_FRACTION));
  const recipients = sorted.slice(0, n);
  for (const store of s.competitors) {
    const amount = store.till;
    if (amount <= 0) continue;
    store.till = 0;
    const share = Math.floor(amount / recipients.length);
    let remainder = amount - share * recipients.length;
    for (const a of recipients) {
      let amt = share;
      if (remainder > 0) {
        amt += 1;
        remainder -= 1;
      }
      a.gold += amt;
    }
  }
}
