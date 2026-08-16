// API call tracking, daily limits, cost estimation (spec §7).
// Persisted to localStorage; resets at local midnight.

import type { TokenBudget } from "../types";
import { DEFAULT_DAILY_LIMIT_CALLS, DEFAULT_DAILY_LIMIT_TOKENS } from "./constants";

const STORAGE_KEY = "wdsa_token_budget";

// Haiku 4.5 pricing, USD per million tokens (rough, for the settings display).
const INPUT_PER_M = 1.0;
const OUTPUT_PER_M = 5.0;

export function loadBudget(): TokenBudget {
  const fresh: TokenBudget = {
    dailyLimitCalls: DEFAULT_DAILY_LIMIT_CALLS,
    dailyLimitTokens: DEFAULT_DAILY_LIMIT_TOKENS,
    callsToday: 0,
    tokensToday: 0,
    totalCallsAllTime: 0,
    totalTokensAllTime: 0,
    estimatedCostToday: 0,
    estimatedCostAllTime: 0,
    budgetExhausted: false,
    lastResetDate: today(),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const b = { ...fresh, ...(JSON.parse(raw) as Partial<TokenBudget>) };
    return maybeReset(b);
  } catch {
    return fresh;
  }
}

export function saveBudget(b: TokenBudget): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    // storage full/unavailable — tracking is best-effort
  }
}

/** True if another API call is allowed right now. */
export function canCall(b: TokenBudget): boolean {
  maybeReset(b);
  return !b.budgetExhausted;
}

/** Record a completed call's usage. Mutates and persists. */
export function recordCall(b: TokenBudget, inputTokens: number, outputTokens: number): void {
  maybeReset(b);
  const total = inputTokens + outputTokens;
  const cost = (inputTokens * INPUT_PER_M + outputTokens * OUTPUT_PER_M) / 1_000_000;
  b.callsToday += 1;
  b.tokensToday += total;
  b.totalCallsAllTime += 1;
  b.totalTokensAllTime += total;
  b.estimatedCostToday += cost;
  b.estimatedCostAllTime += cost;
  if (b.callsToday >= b.dailyLimitCalls || b.tokensToday >= b.dailyLimitTokens) {
    b.budgetExhausted = true; // silent fallback to deterministic for the rest of the day
  }
  saveBudget(b);
}

function maybeReset(b: TokenBudget): TokenBudget {
  const t = today();
  if (b.lastResetDate !== t) {
    b.lastResetDate = t;
    b.callsToday = 0;
    b.tokensToday = 0;
    b.estimatedCostToday = 0;
    b.budgetExhausted = false;
    saveBudget(b);
  }
  return b;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
