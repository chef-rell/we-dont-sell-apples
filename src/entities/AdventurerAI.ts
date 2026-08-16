// Haiku agent integration (spec §7). Clean transport interface so v2 can
// swap direct API calls for a backend endpoint without touching callers:
// makeDecision(type, context) → Promise<Decision | null>.
//
// null means "no AI available" (no key, budget exhausted, error, timeout) —
// callers must always have a deterministic fallback ready. No call here ever
// blocks a game interaction (§7 latency rule): everything is fire-and-forget
// from the caller's perspective.

import type { Adventurer, TokenBudget } from "../types";
import { canCall, recordCall } from "../utils/TokenBudget";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 10_000;
const KEY_OVERRIDE_STORAGE = "wdsa_api_key_override";

export type DecisionType = "morning_plan" | "shop_flavor" | "loot_price" | "narrate_adventure";

export interface MorningPlanDecision {
  plan: "shop" | "adventure" | "rest";
  say?: string; // optional in-character line for the log
}

export interface FlavorDecision {
  text: string;
}

type Decision = MorningPlanDecision | FlavorDecision;

/** API key: settings-screen override in localStorage wins, else build-time env. */
export function getApiKey(): string | null {
  try {
    const override = localStorage.getItem(KEY_OVERRIDE_STORAGE);
    if (override) return override;
  } catch {
    // localStorage unavailable
  }
  const env = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
  return env && env !== "paste-your-key-here" ? env : null;
}

export function setApiKeyOverride(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_OVERRIDE_STORAGE, key);
    else localStorage.removeItem(KEY_OVERRIDE_STORAGE);
  } catch {
    // ignore
  }
}

/** Concise personality summary — a sentence, not a novel (§7 efficiency). */
function personaLine(a: Adventurer): string {
  return (
    `You are ${a.name}, a level ${a.level} ${a.class}. ` +
    `Personality: ${a.personality.traits.join(", ")}; ${a.personality.spendingStyle} spender. ` +
    `Gold: ${a.gold}g. HP: ${a.hp}/${a.maxHp}. Morale: ${a.morale}/100. Loyalty to shop: ${a.loyalty}/100.`
  );
}

function promptFor(type: DecisionType, context: string): { user: string; maxTokens: number } {
  switch (type) {
    case "morning_plan":
      return {
        user:
          `${context}\nDecide your plan for today. Respond with JSON: ` +
          `{"plan": "shop"|"adventure"|"rest", "say": "<one short in-character sentence>"}`,
        maxTokens: 150,
      };
    case "shop_flavor":
      return {
        user:
          `${context}\nWrite ONE short in-character line reacting to this shop visit. ` +
          `The buying decision is already made and stated above — do not change it. ` +
          `Respond with JSON: {"text": "<the line>"}`,
        maxTokens: 150,
      };
    case "loot_price":
      return {
        user: `${context}\nRespond with JSON: {"ask": <gold number>, "say": "<one short line>"}`,
        maxTokens: 150,
      };
    case "narrate_adventure":
      return {
        user:
          `${context}\nNarrate this adventure outcome in 2-3 sentences, past tense, in-character tone. ` +
          `The results above are final — describe them, do not alter them. ` +
          `Respond with JSON: {"text": "<the narration>"}`,
        maxTokens: 300,
      };
  }
}

/**
 * Ask Haiku for a decision. Resolves null on ANY failure path.
 * Budget is checked before the call and usage recorded after.
 */
export async function makeDecision(
  type: DecisionType,
  adventurer: Adventurer,
  context: string,
  budget: TokenBudget,
): Promise<Decision | null> {
  const key = getApiKey();
  if (!key || !canCall(budget)) return null;

  const { user, maxTokens } = promptFor(type, context);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system:
          `${personaLine(adventurer)} You live in a small frontier town with one shop. ` +
          `Respond ONLY with valid JSON, no other text.`,
        messages: [{ role: "user", content: user }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    recordCall(budget, data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);

    const text: string = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(extractJson(text));
    return validate(type, parsed);
  } catch {
    return null; // network error, timeout, bad JSON — caller falls back
  }
}

/** Tolerate stray prose around the JSON object. */
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON");
  return text.slice(start, end + 1);
}

function validate(type: DecisionType, v: unknown): Decision | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (type === "morning_plan") {
    return o.plan === "shop" || o.plan === "adventure" || o.plan === "rest"
      ? { plan: o.plan, say: typeof o.say === "string" ? o.say : undefined }
      : null;
  }
  return typeof o.text === "string" ? { text: o.text } : null;
}
