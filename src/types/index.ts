// ============================================================
// THE CONTRACT — shared interfaces for We Don't Sell Apples.
// Developer A's game logic PRODUCES these shapes.
// Developer B's rendering/UI CONSUMES them.
// Changes here must be flagged in PR descriptions (spec §20).
// ============================================================

// ---------- Time ----------

export type DayPhase = "dawn" | "morning" | "afternoon" | "evening" | "night";

export type GameSpeed = 0 | 1 | 1.5 | 2; // 0 = paused

// ---------- Items ----------

export type ItemCategory =
  | "weapon"
  | "armor"
  | "accessory"
  | "consumable"
  | "loot";

export interface Item {
  id: string; // UUID (spec §19: globally unique for multiplayer future)
  name: string;
  category: ItemCategory;
  baseValue: number; // hidden from player; learned through reactions
  salePrice: number | null; // player-set; null = not priced yet
  quality: number; // 1-10, drives combat math
  icon: string; // key into ItemRenderer's icon table
}

// ---------- Adventurers ----------

export type AdventurerClass =
  | "warrior"
  | "ranger"
  | "mage"
  | "rogue"
  | "cleric"
  | "veteran";

export type AdventurerState =
  | "resting"
  | "wandering"
  | "heading_to_shop"
  | "browsing"
  | "buying"
  | "selling_loot"
  | "heading_to_gate"
  | "adventuring"
  | "fighting"
  | "returning"
  | "dead";

export type SpendingStyle = "impulsive" | "careful" | "frugal" | "generous";

export interface PersonalityProfile {
  traits: string[];
  spendingStyle: SpendingStyle;
  riskTolerance: number; // 0-100
  haggleSkill: number; // 0-100
  preferredItems: ItemCategory[];
  quirks: string[];
}

export interface AdventurerMemory {
  lastPricePaid: Record<string, number>;
  timesOvercharged: number;
  timesFairlyTreated: number;
  favoriteItem: string | null;
  bestAdventureResult: string | null;
  grudges: boolean;
  daysInTown: number;
}

/** Pixel-grid position + movement, for rendering. Set by the behavior state machine. */
export interface Position {
  x: number; // world px
  y: number;
  facing: "up" | "down" | "left" | "right";
  moving: boolean;
}

export interface Adventurer {
  id: string; // UUID
  name: string;
  class: AdventurerClass;
  level: number; // 1-10
  gold: number;
  hp: number;
  maxHp: number;
  inventory: Item[];
  equipment: { weapon?: Item; armor?: Item; accessory?: Item };
  personality: PersonalityProfile;
  state: AdventurerState;
  position: Position;
  morale: number; // 0-100
  loyalty: number; // 0-100
  relationships: { shopkeeper: number }; // -100..100
  memory: AdventurerMemory;
  alive: boolean;
  daysSinceLastAdventure: number;
  nightOwl: boolean;
  /** Shelf item currently being examined; null outside browsing/buying.
   *  Mirrored from the behavior machine so views can draw reaction bubbles
   *  for the REAL item under consideration (issue #12, §6). */
  browsingItemId: string | null;
  // Appearance seeds so rendering is stable per-adventurer
  appearance: { skin: number; hair: number }; // indices into palette arrays
}

// ---------- Reactions (deterministic; spec §6) ----------

export type Reaction = "happy" | "neutral" | "unhappy" | "angry";

// ---------- Monsters ----------

export interface Monster {
  id: string;
  name: string;
  hp: number;
  damage: number;
  lootTable: string[]; // item names
  area: WildernessArea;
}

export type WildernessArea = "forest_edge" | "shadow_cave";

// ---------- Adventures & loot (spec §8) ----------

/** Deterministic combat outcome — computed by stats BEFORE any AI narration.
 *  The Wilderness View animates this; the AI describes it; neither alters it. */
export interface AdventureOutcome {
  adventurerId: string;
  area: WildernessArea;
  day: number;
  monsterName: string;
  monsterDefeated: boolean;
  damageTaken: number;
  survived: boolean;
  lootItemKeys: string[]; // ITEM_DEFS keys found
  goldFound: number; // coin injected by the wilderness (the economy's faucet)
  narration: string | null; // AI text, arrives async; null until then/fallback
}

/** A returning adventurer offering loot to the player. Dev B's
 *  buy-from-adventurer UI consumes this queue; accept/decline via engine. */
export interface LootOffer {
  id: string;
  adventurerId: string;
  adventurerName: string;
  item: Item;
  askPrice: number;
  day: number; // offers expire at the end of the day they're made
}

// ---------- Wholesale supply (spec §5 gold sinks / §15 Phase 2 restocking) ----------

/** The traveling wholesale supplier's daily offering. Present during the
 *  afternoon phase; player buys at base value via engine.buyWholesale(). */
export interface MerchantState {
  day: number; // day this stock was rolled
  stock: Item[]; // items for sale at their baseValue
}

// ---------- Pricing history (feeds §13 auto-pilot inference) ----------

export interface PriceRecord {
  itemCategory: ItemCategory;
  itemName: string;
  priceSet: number;
  baseValue: number;
  markupRatio: number;
  daySet: number;
}

// ---------- Chat (message bus from day one; spec §16) ----------

export type ChatMessageType =
  | "ambient"
  | "offer"
  | "request"
  | "reaction"
  | "story"
  | "social"
  | "mourning"
  | "player"
  | "system";

export interface ChatMessage {
  id: string;
  senderId: string; // adventurer UUID or "player"
  senderName: string;
  type: ChatMessageType;
  content: string;
  timestamp: number; // game time (day + timeOfDay), not wall clock
  day: number;
}

// ---------- Token budget (spec §7) ----------

export interface TokenBudget {
  dailyLimitCalls: number;
  dailyLimitTokens: number;
  callsToday: number;
  tokensToday: number;
  totalCallsAllTime: number;
  totalTokensAllTime: number;
  estimatedCostToday: number;
  estimatedCostAllTime: number;
  budgetExhausted: boolean;
  lastResetDate: string; // ISO date, for midnight reset
}

export type AIMode = "full" | "light" | "off";

// ---------- Views ----------

export type GameView = "town" | "shop" | "wilderness" | "gameover";

// ---------- Root state ----------

export interface GameState {
  day: number;
  timeOfDay: number; // 0-1 through the day cycle
  phase: DayPhase;
  speed: GameSpeed;
  view: GameView;
  gold: number;
  inventory: Item[]; // stockroom (not shelved)
  shelves: (Item | null)[]; // display slots; length = shopLevel capacity
  shopLevel: number; // 1-4
  adventurers: Adventurer[];
  messages: ChatMessage[];
  lootOffers: LootOffer[]; // pending buy-from-adventurer offers (spec §3b/§8)
  recentOutcomes: AdventureOutcome[]; // last few adventures, for wilderness view + summaries
  merchant: MerchantState | null; // wholesale supplier; non-null during afternoons
  pricingHistory: PriceRecord[]; // player price-setting log (auto-pilot learns from this)
  tokenBudget: TokenBudget;
  aiMode: AIMode;
  stats: {
    totalGoldEarned: number;
    itemsSold: number;
    adventurersServed: number;
    adventurersLost: number;
  };
  lastSavedAt: number | null; // wall-clock ms, for offline sim later
}
