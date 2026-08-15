// Main game loop and time management. Phase 1 scope: time advances through
// day phases, adventurers wander the town with idle waypoint movement.
// Shop logic, AI, and economy arrive in later phases.

import type { Adventurer, AdventurerClass, GameState } from "../types";
import { advanceTime, phaseFor } from "./DayNightCycle";
import { generateName } from "../utils/names";
import {
  DEFAULT_DAILY_LIMIT_CALLS,
  DEFAULT_DAILY_LIMIT_TOKENS,
  SHOP_SLOTS_BY_LEVEL,
  STARTING_ADVENTURER_COUNT,
  STARTING_GOLD,
  WORLD_H,
  WORLD_W,
} from "../utils/constants";

// Town landmarks in world px — rendering and movement both use these.
export const TOWN = {
  shop: { x: 120, y: 140 },
  tavern: { x: 640, y: 120 },
  houses: [
    { x: 200, y: 420 },
    { x: 360, y: 460 },
    { x: 560, y: 430 },
  ],
  gate: { x: 880, y: 300 },
  square: { x: 440, y: 280 },
} as const;

const WANDER_POINTS = [
  { x: 440, y: 300 }, // square
  { x: 500, y: 260 },
  { x: 380, y: 340 },
  { x: 660, y: 200 }, // near tavern
  { x: 260, y: 380 }, // near houses
  { x: 200, y: 220 }, // near shop
];

const WALK_SPEED = 60; // world px per second at 1×

interface WanderTarget {
  x: number;
  y: number;
  idleUntil: number; // game timeOfDay to idle until after arriving
}

export class GameEngine {
  state: GameState;
  private targets = new Map<string, WanderTarget>();

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
      if (a.alive) this.wander(a, dt);
    }
  }

  /** Phase 1 idle behavior: pick a point, walk there, linger, repeat.
   *  At night, head home and stop. Replaced by the real behavior state
   *  machine in Phase 3. */
  private wander(a: Adventurer, dt: number): void {
    const s = this.state;
    const night = s.phase === "night";
    let target = this.targets.get(a.id);

    if (night) {
      const home = TOWN.houses[a.appearance.skin % TOWN.houses.length];
      target = { x: home.x + 20, y: home.y + 60, idleUntil: 2 };
      a.state = "resting";
    } else if (!target || target.idleUntil < s.timeOfDay) {
      const p = WANDER_POINTS[Math.floor(Math.random() * WANDER_POINTS.length)];
      target = {
        x: p.x + Math.floor(Math.random() * 80) - 40,
        y: p.y + Math.floor(Math.random() * 60) - 30,
        idleUntil: s.timeOfDay + 0.02 + Math.random() * 0.04,
      };
      a.state = "wandering";
    }
    this.targets.set(a.id, target);

    const dx = target.x - a.position.x;
    const dy = target.y - a.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      a.position.moving = false;
      return;
    }
    const step = Math.min(dist, WALK_SPEED * dt);
    a.position.x += (dx / dist) * step;
    a.position.y += (dy / dist) * step;
    a.position.moving = true;
    a.position.facing =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0 ? "right" : "left"
        : dy > 0 ? "down" : "up";
  }
}

// ---------- Initial state ----------

function createInitialState(): GameState {
  return {
    day: 1,
    timeOfDay: 0.1, // start at morning
    phase: "morning",
    speed: 1,
    view: "town",
    gold: STARTING_GOLD,
    inventory: [], // starting items land in Phase 2 with the Item model
    shelves: new Array(SHOP_SLOTS_BY_LEVEL[0]).fill(null),
    shopLevel: 1,
    adventurers: createStartingAdventurers(),
    messages: [],
    tokenBudget: {
      dailyLimitCalls: DEFAULT_DAILY_LIMIT_CALLS,
      dailyLimitTokens: DEFAULT_DAILY_LIMIT_TOKENS,
      callsToday: 0,
      tokensToday: 0,
      totalCallsAllTime: 0,
      totalTokensAllTime: 0,
      estimatedCostToday: 0,
      estimatedCostAllTime: 0,
      budgetExhausted: false,
      lastResetDate: new Date().toISOString().slice(0, 10),
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
}> = [
  { cls: "warrior", gold: 120, traits: ["brave", "loyal"], spendingStyle: "impulsive", risk: 70 },
  { cls: "ranger", gold: 45, traits: ["cautious", "frugal"], spendingStyle: "frugal", risk: 30 },
  { cls: "rogue", gold: 90, traits: ["reckless", "impulsive"], spendingStyle: "impulsive", risk: 90 },
  { cls: "mage", gold: 110, traits: ["studious", "careful"], spendingStyle: "careful", risk: 45 },
  { cls: "cleric", gold: 50, traits: ["cheerful", "generous"], spendingStyle: "generous", risk: 35 },
  { cls: "veteran", gold: 200, traits: ["grizzled", "picky"], spendingStyle: "careful", risk: 55 },
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
      preferredItems: [],
      quirks: [],
    },
    state: "wandering",
    position: {
      x: 300 + i * 60,
      y: 260 + (i % 3) * 50,
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

// Bounds guard used by movement
export function clampToWorld(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(WORLD_W - 40, x)),
    y: Math.max(0, Math.min(WORLD_H - 64, y)),
  };
}
