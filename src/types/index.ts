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
