// Save/load (spec §12). GameState is fully serializable (a §19 requirement),
// so persistence is JSON in localStorage. Auto-saved at each day rollover and
// on demand; behavior contexts are intentionally NOT saved — adventurers
// resume their day from the state machine's defaults on load.

import type { GameState } from "../types";
import { freshLedger } from "./Ledger";
import { defaultBuildings } from "../utils/TownBuildings";

const SAVE_KEY = "wdsa_save_v1";

export function saveGame(state: GameState): void {
  try {
    state.lastSavedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable/full — the game continues unsaved
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    // Minimal sanity check — a corrupt save is worse than a fresh start.
    if (typeof state.day !== "number" || !Array.isArray(state.adventurers)) return null;
    // Forward-compat: fields added after a save was written get defaults.
    state.saveVersion ??= 1;
    state.reputation ??= 0;
    state.buildings ??= defaultBuildings(); // registry added in #56; old saves get today's fixed geometry
    state.lootOffers ??= [];
    state.recentOutcomes ??= [];
    state.merchant ??= null;
    state.pricingHistory ??= [];
    for (const a of state.adventurers) {
      a.browsingItemId ??= null;
      a.memory.lowMoraleDays ??= 0;
    }
    for (const o of state.recentOutcomes) o.goldFound ??= 0;
    state.autoPilotEnabled ??= false;
    state.offlineSummary ??= null;
    state.ledger ??= freshLedger(state.day);
    state.ledgerHistory ??= [];
    state.lastSalePriceByName ??= {};
    // Durability forward-compat: items in all collections get defaults.
    const patchItem = (it: any) => {
      if (!it) return;
      it.durability ??= null;
      it.maxDurability ??= null;
      it.timesRepaired ??= 0;
    };
    for (const it of state.inventory) patchItem(it);
    for (const it of state.shelves) patchItem(it);
    if (state.merchant) for (const it of state.merchant.stock) patchItem(it);
    for (const a of state.adventurers) {
      for (const it of a.inventory) patchItem(it);
      if (a.equipment.weapon) patchItem(a.equipment.weapon);
      if (a.equipment.armor) patchItem(a.equipment.armor);
      if (a.equipment.accessory) patchItem(a.equipment.accessory);
    }
    for (const o of state.recentOutcomes) o.brokenItems ??= [];
    for (const lo of state.lootOffers) patchItem(lo.item);
    state.speed = 1; // never resume paused or fast-forwarded
    state.view = "town";
    return state;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
