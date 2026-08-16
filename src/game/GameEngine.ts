// Main game loop and time management. Phase 3: adventurers run on the real
// behavior state machine; Haiku steers daily plans asynchronously with a
// deterministic fallback always in place (spec §7).

import type { Adventurer, AdventurerClass, GameState } from "../types";
import { advanceTime, phaseFor } from "./DayNightCycle";
import { generateName } from "../utils/names";
import { loadBudget } from "../utils/TokenBudget";
import { startingInventory } from "../entities/Item";
import { makeDecision, type MorningPlanDecision } from "../entities/AdventurerAI";
import {
  TOWN,
  freshContext,
  stepAdventurer,
  applyPlanOverride,
  type BehaviorContext,
} from "../entities/AdventurerBehavior";
import {
  DEFAULT_DAILY_LIMIT_CALLS,
  DEFAULT_DAILY_LIMIT_TOKENS,
  SHOP_SLOTS_BY_LEVEL,
  STARTING_ADVENTURER_COUNT,
  STARTING_GOLD,
} from "../utils/constants";

export { TOWN }; // single source of truth for town landmarks lives in AdventurerBehavior

const MAX_MESSAGES = 100;

export class GameEngine {
  state: GameState;
  private contexts = new Map<string, BehaviorContext>();
  private plannedDay = new Map<string, number>(); // adventurer id → last day AI planning fired

  constructor() {
    this.state = createInitialState();
  }

  /** Advance the simulation by a real-time delta (ms). */
  tick(deltaMs: number): void {
    const s = this.state;
    if (s.speed === 0) return;

    const t = advanceTime(s.timeOfDay, deltaMs, s.speed);
    if (t >= 1) {
      s.day += 1;
      s.timeOfDay = t - 1;
    } else {
      s.timeOfDay = t;
    }
    s.phase = phaseFor(s.timeOfDay);

    const dt = (deltaMs / 1000) * s.speed;
    for (const a of s.adventurers) {
      if (!a.alive) continue;
      const bc = this.contextFor(a.id);
      const result = stepAdventurer(a, bc, s, dt);
      for (const m of result.messages) this.pushMessage(m);
      this.maybePlanWithAI(a);
    }
  }

  private contextFor(id: string): BehaviorContext {
    let bc = this.contexts.get(id);
    if (!bc) {
      bc = freshContext();
      this.contexts.set(id, bc);
    }
    return bc;
  }

  /**
   * Morning planning via Haiku (§7 decision point 1) — fired once per
   * adventurer per game day at dawn/morning, fully async. The fallback plan
   * is already active; if the AI answers in time it refines the plan, and
   * its in-character line lands in the log. Light/off AI modes still plan
   * (it's a Light-AI decision point); "off" skips entirely.
   */
  private maybePlanWithAI(a: Adventurer): void {
    const s = this.state;
    if (s.aiMode === "off") return;
    if (s.phase !== "dawn" && s.phase !== "morning") return;
    if (this.plannedDay.get(a.id) === s.day) return;
    this.plannedDay.set(a.id, s.day);

    const gearQ =
      (a.equipment.weapon?.quality ?? 0) + (a.equipment.armor?.quality ?? 0);
    const context =
      `It is morning on day ${s.day}. Days since your last adventure: ${a.daysSinceLastAdventure}. ` +
      `Your gear quality score: ${gearQ}/10. The town shop ${
        s.shelves.some((it) => it !== null) ? "has items on its shelves" : "looks sparsely stocked"
      }.`;

    void makeDecision("morning_plan", a, context, s.tokenBudget).then((d) => {
      if (!d || !("plan" in d)) return; // fallback already in charge
      const md = d as MorningPlanDecision;
      applyPlanOverride(a, this.contextFor(a.id), md.plan);
      if (md.say) {
        this.pushMessage({
          id: `chat-${s.day}-${a.id}-plan`,
          senderId: a.id,
          senderName: a.name,
          type: "ambient",
          content: md.say,
          timestamp: s.timeOfDay,
          day: s.day,
        });
      }
    });
  }

  private pushMessage(m: GameState["messages"][number]): void {
    this.state.messages.push(m);
    if (this.state.messages.length > MAX_MESSAGES) {
      this.state.messages.splice(0, this.state.messages.length - MAX_MESSAGES);
    }
  }
}

// ---------- Initial state ----------

function createInitialState(): GameState {
  const slots = SHOP_SLOTS_BY_LEVEL[0];
  const shelves: GameState["shelves"] = new Array(slots).fill(null);
  // Starting stock goes straight onto the shelves, unpriced — the player's
  // first act is setting prices (spec §6). Unpriced items don't sell.
  for (const [i, item] of startingInventory().entries()) {
    if (i < slots) shelves[i] = item;
  }

  return {
    day: 1,
    timeOfDay: 0.1,
    phase: "morning",
    speed: 1,
    view: "town",
    gold: STARTING_GOLD,
    inventory: [],
    shelves,
    shopLevel: 1,
    adventurers: createStartingAdventurers(),
    messages: [],
    tokenBudget: {
      ...loadBudget(),
      dailyLimitCalls: DEFAULT_DAILY_LIMIT_CALLS,
      dailyLimitTokens: DEFAULT_DAILY_LIMIT_TOKENS,
    },
    aiMode: "light",
    stats: { totalGoldEarned: 0, itemsSold: 0, adventurersServed: 0, adventurersLost: 0 },
    lastSavedAt: null,
  };
}

// Starting cast per spec §7: warrior, ranger, rogue, mage, cleric, veteran.
const STARTING_CAST: Array<{
  cls: AdventurerClass;
  gold: number;
  traits: string[];
  spendingStyle: Adventurer["personality"]["spendingStyle"];
  risk: number;
  prefers: Adventurer["personality"]["preferredItems"];
}> = [
  { cls: "warrior", gold: 120, traits: ["brave", "loyal"], spendingStyle: "impulsive", risk: 70, prefers: ["weapon"] },
  { cls: "ranger", gold: 45, traits: ["cautious", "frugal"], spendingStyle: "frugal", risk: 30, prefers: ["consumable", "armor"] },
  { cls: "rogue", gold: 90, traits: ["reckless", "impulsive"], spendingStyle: "impulsive", risk: 90, prefers: ["weapon", "accessory"] },
  { cls: "mage", gold: 110, traits: ["studious", "careful"], spendingStyle: "careful", risk: 45, prefers: ["accessory"] },
  { cls: "cleric", gold: 50, traits: ["cheerful", "generous"], spendingStyle: "generous", risk: 35, prefers: ["consumable", "accessory"] },
  { cls: "veteran", gold: 200, traits: ["grizzled", "picky"], spendingStyle: "careful", risk: 55, prefers: ["weapon", "armor"] },
];

function createStartingAdventurers(): Adventurer[] {
  return STARTING_CAST.slice(0, STARTING_ADVENTURER_COUNT).map((c, i) => ({
    id: crypto.randomUUID(),
    name: generateName(),
    class: c.cls,
    level: 1 + Math.floor(Math.random() * 2),
    gold: c.gold,
    hp: 30,
    maxHp: 30,
    inventory: [],
    equipment: {},
    personality: {
      traits: c.traits,
      spendingStyle: c.spendingStyle,
      riskTolerance: c.risk,
      haggleSkill: 20 + Math.floor(Math.random() * 60),
      preferredItems: c.prefers,
      quirks: [],
    },
    state: "wandering",
    position: {
      x: TOWN.square.x - 100 + i * 45,
      y: TOWN.square.y - 20 + (i % 3) * 45,
      facing: "down",
      moving: false,
    },
    morale: 60,
    loyalty: 50,
    relationships: { shopkeeper: 0 },
    memory: {
      lastPricePaid: {},
      timesOvercharged: 0,
      timesFairlyTreated: 0,
      favoriteItem: null,
      bestAdventureResult: null,
      grudges: c.traits.includes("picky"),
      daysInTown: 0,
    },
    alive: true,
    daysSinceLastAdventure: 0,
    nightOwl: c.risk >= 70,
    appearance: {
      skin: Math.floor(Math.random() * 4),
      hair: Math.floor(Math.random() * 5),
    },
  }));
}
