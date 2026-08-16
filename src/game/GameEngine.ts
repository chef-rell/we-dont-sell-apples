// Main game loop and time management. Phase 3: adventurers run on the real
// behavior state machine; Haiku steers daily plans asynchronously with a
// deterministic fallback always in place (spec §7).

import type { Adventurer, AdventurerClass, AdventureOutcome, GameState } from "../types";
import { advanceTime, phaseFor } from "./DayNightCycle";
import { generateName } from "../utils/names";
import { loadBudget } from "../utils/TokenBudget";
import { makeItem, startingInventory } from "../entities/Item";
import { loadGame, saveGame } from "./GameStatePersistence";
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
  MIN_ADVENTURER_COUNT,
  REPLACEMENT_DAYS_MAX,
  REPLACEMENT_DAYS_MIN,
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

  constructor(resume = true) {
    // Continue from an existing save when one exists (spec §12); pass
    // resume=false for an explicit New Game.
    this.state = (resume ? loadGame() : null) ?? createInitialState();
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
    const dayRolled = t >= 1;
    for (const a of s.adventurers) {
      if (!a.alive) continue;
      const bc = this.contextFor(a.id);
      const result = stepAdventurer(a, bc, s, dt);
      for (const m of result.messages) this.pushMessage(m);
      if (result.outcome) this.handleOutcome(a, result.outcome);
      this.maybePlanWithAI(a);
    }
    this.updateMerchant();
    this.checkGameOver();
    if (dayRolled) this.onNewDay();
  }

  // ---------- Phase 4: adventure outcomes, death, arrivals, loot offers ----------

  private handleOutcome(a: Adventurer, outcome: AdventureOutcome): void {
    const s = this.state;
    s.recentOutcomes.push(outcome);
    if (s.recentOutcomes.length > 12) s.recentOutcomes.shift();

    if (!outcome.survived) {
      // Mourning (§14): the town feels the loss.
      for (const other of s.adventurers) {
        if (other.alive && other.id !== a.id) {
          other.morale = Math.max(0, other.morale - 12);
        }
      }
      this.replacementDueDay = s.day + REPLACEMENT_DAYS_MIN +
        Math.floor(Math.random() * (REPLACEMENT_DAYS_MAX - REPLACEMENT_DAYS_MIN + 1));
    }

    // AI narration (§7 decision point 4): fire-and-forget; the outcome is
    // final and stated in the prompt — the AI describes, never decides.
    if (s.aiMode === "off") return;
    const context =
      `You went to the ${outcome.area === "forest_edge" ? "Forest Edge" : "Shadow Cave"} today and ` +
      `${outcome.monsterDefeated ? "defeated" : "were beaten back by"} a ${outcome.monsterName}. ` +
      `You took ${outcome.damageTaken} damage${outcome.survived ? "" : " and did not survive"}. ` +
      `Loot found: ${outcome.lootItemKeys.length > 0 ? outcome.lootItemKeys.join(", ") : "none"}.`;
    void makeDecision("narrate_adventure", a, context, s.tokenBudget).then((d) => {
      if (d && "text" in d) {
        outcome.narration = d.text;
        this.pushMessage({
          id: `story-${outcome.day}-${a.id}`,
          senderId: a.id,
          senderName: a.name,
          type: "story",
          content: d.text,
          timestamp: this.state.timeOfDay,
          day: this.state.day,
        });
      }
    });
  }

  private replacementDueDay: number | null = null;

  private onNewDay(): void {
    const s = this.state;
    saveGame(s); // auto-save at the day rollover (§12)
    // Loot offers don't survive the night.
    s.lootOffers = s.lootOffers.filter((o) => o.day >= s.day);

    // Replacement arrivals (§7): due date passed, or town below minimum.
    const aliveCount = s.adventurers.filter((a) => a.alive).length;
    const due = this.replacementDueDay !== null && s.day >= this.replacementDueDay;
    if ((due || aliveCount < MIN_ADVENTURER_COUNT) && aliveCount < STARTING_ADVENTURER_COUNT) {
      this.replacementDueDay = null;
      const newcomer = createReplacementAdventurer();
      s.adventurers.push(newcomer);
      this.pushMessage({
        id: `sys-arrival-${s.day}`,
        senderId: "system",
        senderName: "Town",
        type: "system",
        content: `A new face in town: ${newcomer.name} the ${newcomer.class} has arrived.`,
        timestamp: s.timeOfDay,
        day: s.day,
      });
    }
  }

  // ---------- v1 completion: pricing API, wholesale, save, game over ----------

  /**
   * Set (or clear) an item's sale price. THE way to price items — records
   * pricing history for the §13 auto-pilot. Searches shelves and stockroom.
   */
  setPrice(itemId: string, price: number | null): boolean {
    const s = this.state;
    const item =
      s.shelves.find((it) => it?.id === itemId) ??
      s.inventory.find((it) => it.id === itemId);
    if (!item) return false;
    item.salePrice = price;
    if (price !== null) {
      s.pricingHistory.push({
        itemCategory: item.category,
        itemName: item.name,
        priceSet: price,
        baseValue: item.baseValue,
        markupRatio: price / item.baseValue,
        daySet: s.day,
      });
      if (s.pricingHistory.length > 500) s.pricingHistory.splice(0, s.pricingHistory.length - 500);
    }
    return true;
  }

  /** Buy one item from the wholesale merchant at base value. Puts it on the
   *  first empty shelf, else the stockroom. */
  buyWholesale(itemId: string): boolean {
    const s = this.state;
    if (!s.merchant) return false;
    const idx = s.merchant.stock.findIndex((it) => it.id === itemId);
    if (idx === -1) return false;
    const item = s.merchant.stock[idx];
    if (s.gold < item.baseValue) return false;

    s.gold -= item.baseValue;
    s.merchant.stock.splice(idx, 1);
    const empty = s.shelves.findIndex((slot) => slot === null);
    if (empty !== -1) s.shelves[empty] = item;
    else s.inventory.push(item);
    return true;
  }

  /** Roll the merchant's afternoon stock: a rotating basket of basics. */
  private updateMerchant(): void {
    const s = this.state;
    if (s.phase === "afternoon") {
      if (!s.merchant || s.merchant.day !== s.day) {
        const basics = ["iron_sword", "wooden_shield", "leather_armor", "health_potion", "rations", "travelers_cloak", "hunting_bow", "oak_staff", "iron_helmet", "simple_ring"];
        const count = 4 + (s.day % 3); // 4-6 items, rotating start point
        const stock = Array.from({ length: count }, (_, i) => makeItem(basics[(s.day * 3 + i) % basics.length]));
        s.merchant = { day: s.day, stock };
        this.pushMessage({
          id: `sys-merchant-${s.day}`,
          senderId: "system",
          senderName: "Town",
          type: "system",
          content: "The wholesale cart has rolled into the square — restock while it's here.",
          timestamp: s.timeOfDay,
          day: s.day,
        });
      }
    } else if (s.merchant) {
      s.merchant = null; // cart moves on when afternoon ends
    }
  }

  /** Failure condition (§5): no gold, nothing to sell, nothing in stock. */
  private checkGameOver(): void {
    const s = this.state;
    if (s.view === "gameover") return;
    const hasStock = s.shelves.some((it) => it !== null) || s.inventory.length > 0;
    if (s.gold <= 0 && !hasStock) {
      s.view = "gameover";
      s.speed = 0;
    }
  }

  /** Manual save; also called automatically at each day rollover. */
  save(): void {
    saveGame(this.state);
  }

  /** Player accepts a loot offer (Dev B's buy UI calls this). */
  acceptLootOffer(offerId: string): boolean {
    const s = this.state;
    const idx = s.lootOffers.findIndex((o) => o.id === offerId);
    if (idx === -1) return false;
    const offer = s.lootOffers[idx];
    if (s.gold < offer.askPrice) return false;
    const seller = s.adventurers.find((a) => a.id === offer.adventurerId);
    if (!seller) return false;

    s.gold -= offer.askPrice;
    seller.gold += offer.askPrice;
    seller.inventory = seller.inventory.filter((it) => it.id !== offer.item.id);
    s.inventory.push({ ...offer.item, salePrice: null });
    seller.morale = Math.min(100, seller.morale + 4);
    seller.relationships.shopkeeper = Math.min(100, seller.relationships.shopkeeper + 2);
    s.lootOffers.splice(idx, 1);
    this.pushMessage({
      id: `sys-bought-${offer.id}`,
      senderId: "system",
      senderName: "Town",
      type: "system",
      content: `You bought ${offer.item.name} from ${offer.adventurerName} for ${offer.askPrice}g.`,
      timestamp: s.timeOfDay,
      day: s.day,
    });
    return true;
  }

  /** Player declines a loot offer. The seller remembers (§14). */
  declineLootOffer(offerId: string): void {
    const s = this.state;
    const idx = s.lootOffers.findIndex((o) => o.id === offerId);
    if (idx === -1) return;
    const offer = s.lootOffers[idx];
    const seller = s.adventurers.find((a) => a.id === offer.adventurerId);
    if (seller) {
      seller.morale = Math.max(0, seller.morale - 3);
    }
    s.lootOffers.splice(idx, 1);
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
    lootOffers: [],
    recentOutcomes: [],
    merchant: null,
    pricingHistory: [],
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

/** A newcomer drawn from the cast templates with fresh identity and no history. */
function createReplacementAdventurer(): Adventurer {
  const c = STARTING_CAST[Math.floor(Math.random() * STARTING_CAST.length)];
  const [a] = buildAdventurers([c], TOWN.gate.x - 40, TOWN.gate.y + 30);
  return a;
}

function createStartingAdventurers(): Adventurer[] {
  return buildAdventurers(
    STARTING_CAST.slice(0, STARTING_ADVENTURER_COUNT),
    TOWN.square.x - 100,
    TOWN.square.y - 20,
  );
}

function buildAdventurers(
  cast: typeof STARTING_CAST,
  originX: number,
  originY: number,
): Adventurer[] {
  return cast.map((c, i) => ({
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
      x: originX + i * 45,
      y: originY + (i % 3) * 45,
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
    browsingItemId: null,
    nightOwl: c.risk >= 70,
    appearance: {
      skin: Math.floor(Math.random() * 4),
      hair: Math.floor(Math.random() * 5),
    },
  }));
}
