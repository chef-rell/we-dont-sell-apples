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
  durability: number | null;    // null = non-gear (consumable/loot); 0 = broken
  maxDurability: number | null;
  timesRepaired: number;        // for future blacksmith; starts 0
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
  lowMoraleDays: number; // consecutive days ending below 30 — drives leaving town (§14)
}

/** Pixel-grid position + movement, for rendering. Set by the behavior state machine. */
export interface Position {
  x: number; // world px
  y: number;
  // v2 Phase 1 (WDSA-v2-spec.md V2.4, additive): "NE" | "NW" | "SE" | "SW"
  // are the iso diagonals CharacterRenderer now draws. Nothing writes them
  // yet — the iso TownView (issue #70) maps world facings to diagonals at
  // render time.
  facing: "up" | "down" | "left" | "right" | "NE" | "NW" | "SE" | "SW";
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
  brokenItems: string[];  // names of gear that broke during this adventure
}

// ---------- Adventure scripts (spec V2.5/V2.6, issue #76) ----------
//
// v2 combat: a party's whole afternoon is generated ONCE, with a stored
// seed, at the moment they set out. Facts (who lives, what breaks, what
// drops, how much gold enters town) are final the instant the script
// exists — `events` are presentation timestamps for the wilderness strip
// (issue #78) to play back at its own pace; nothing downstream re-decides
// anything. `memberOutcomes` are per-member `AdventureOutcome`s (same shape
// v1 produced solo) applied at the same point in the day v1 outcomes were.

export type AdventureScriptEventType =
  | "march"
  | "encounter"
  | "hit"
  | "monsterHit"
  | "gearBreak"
  | "death"
  | "lootDrop"
  | "goldDrop"
  | "victory"
  | "defeat"
  | "returnMarch"
  // spec V2.7 (issue #83): fired only on a full party wipe with the helper
  // along on the adventure track — the loot/gold that would otherwise be
  // lost with the party gets delivered to the PLAYER instead (the helper,
  // who never dies, drags the sack home alone). One event per gold total
  // (`value`) and per surviving item (`itemName`), same one-event-per-drop
  // shape as lootDrop/goldDrop above.
  | "helperCarry";

export interface AdventureScriptEvent {
  t: number; // 0..1 through the afternoon
  type: AdventureScriptEventType;
  actorId?: string; // adventurer UUID this event is about
  monster?: string; // monster name, for encounter/death/hit-shaped events
  itemName?: string; // for gearBreak/lootDrop
  value?: number; // damage/gold amount, event-dependent
}

export interface AdventureScript {
  id: string;
  day: number;
  seed: number; // stored so any client replays this exact script (spec V2.5)
  night: boolean;
  partyIds: string[]; // adventurer UUIDs, in marching order
  events: AdventureScriptEvent[];
  memberOutcomes: AdventureOutcome[]; // one per partyIds entry, final at generation
  /** Whether the helper tagged along on this script's trip (spec V2.7,
   *  issue #83). Additive; `loadGame()` defaults old persisted scripts to
   *  false. Drives the party-power boost and the full-wipe helperCarry
   *  beat in Combat.ts — never affects who's actually in `partyIds`, since
   *  the helper isn't a real party member (it can't die or be targeted). */
  helperAlong: boolean;
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

// ---------- Offline simulation (spec §13) ----------

/** What happened while the player was away. Produced by OfflineSim on load;
 *  Dev B's "While You Were Away" overlay consumes it and clears the field. */
export interface OfflineSummary {
  daysElapsed: number;
  goldStart: number;
  goldEnd: number;
  itemsSold: number;
  lootBought: number;
  adventurersLost: string[]; // names
  adventurersArrived: string[]; // names
  notableEvents: string[]; // human-readable lines
}

// ---------- The Helper (spec V2.7, issue #83) ----------

/** Creation-time aptitude: curious→craft, brave→adventure, charming→shop.
 *  Matching the PERMANENT track (below) grants a ×1.5 daily XP multiplier. */
export type HelperTrait = "curious" | "brave" | "charming";

/** The permanent, one-way specialization chosen at day 10+ via
 *  `engine.chooseTrack()`. "none" before that choice is made. "craft" is a
 *  valid track value in the contract (Phase 4 builds it out) but
 *  `chooseTrack()` rejects selecting it until then — see V2.15. */
export type HelperTrack = "none" | "shop" | "adventure" | "craft";

/** Today's job — one per day, sticky across days until
 *  `engine.setHelperAssignment()` changes it. Freely choosable among all
 *  three from day 1 (see PR body): `track` gates the PERMANENT commitment
 *  and its trait XP bonus, not which daily job is available. */
export type HelperAssignment = "chores" | "shop" | "adventure";

/** The player's second character (spec V2.7). Created once via
 *  `engine.createCharacters()` (issue #84 owns the creation UI); `null`
 *  means "not created yet" — every system treats that as a no-op, so the
 *  game plays identically to before this entity existed. */
export interface Helper {
  id: string; // UUID, consistent with every other entity in the contract
  name: string;
  appearance: { skin: number; hair: number };
  trait: HelperTrait;
  track: HelperTrack;
  level: number; // 1-5, thresholds in src/entities/Helper.ts
  xp: number;
  assignment: HelperAssignment;
  assignmentDay: number; // day setHelperAssignment last set it (display/analytics)
}

// ---------- Trade ledger (playtest feature: learn-from-stats, §17-safe) ----------

/** One day's trading record. Everything here is information the player could
 *  observe themselves (restock cost IS the wholesale price they pay), so it
 *  teaches without leaking hidden adventurer valuations. */
export interface DayLedger {
  day: number;
  revenue: number; // gold taken in from sales
  salesCount: number;
  soldAtLoss: number; // sales below what restocking that item costs
  reactions: { happy: number; neutral: number; unhappy: number; angry: number };
  walkouts: number; // angry customers who left over a price
  restockSpend: number;
  lootSpend: number;
  donationsReceived: number;
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

/** "wilderness" dropped as of issue #78 (spec V2.5): WildernessView is
 *  retired — the adventure strip panel (always visible, part of the
 *  triptych chrome) plays back GameState.currentScript in its place, so
 *  there's no longer a separate screen to route to. This is the one
 *  non-additive contract change in that PR; it's save-safe because
 *  GameStatePersistence.loadGame() force-resets `view` to "town" on every
 *  load (spec §4 rule: "the contract is sacred," change flagged there). */
export type GameView = "town" | "shop" | "gameover";

// ---------- Town buildings (spec V2.8; issue #56) ----------

/** Known kinds today; the union stays open (via the `string &` widening
 *  below) so v2 buildings (clinic, graveyard, competitor_store, garden,
 *  alchemy_lab, forge, ...) don't need a contract change to add. */
export type BuildingKind =
  | "shop"
  | "tavern"
  | "house"
  | "gate"
  | "square"
  | (string & {});

/** One piece of town geometry — fixed infrastructure today, player-built
 *  plots later (spec V2.8). Replaces the frozen `TOWN` literal that used to
 *  live in AdventurerBehavior.ts and the two hand-coded click bboxes that
 *  used to live in TownView.tsx. Units match what those used: world px. */
export interface TownBuilding {
  id: string;
  kind: BuildingKind;
  footprint: { x: number; y: number; w: number; h: number };
  /** Interaction/anchor point (a walk-to target), when the building has one
   *  distinct from its footprint origin — e.g. the shop's actual doorway. */
  door?: { x: number; y: number };
  clickable: boolean;
}

// ---------- Root state ----------

export interface GameState {
  /** Save-shape version (spec V2.11). v2 saves = 2, key `wdsa_save_v2`
   *  (active since Phase 1). v1 saves (= 1, key `wdsa_save_v1`) are never
   *  read, migrated, or deleted by v2 code. */
  saveVersion: number;
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
  ledger: DayLedger; // today's running trade ledger
  lastSalePriceByName: Record<string, number>; // proven-to-clear prices, feeds pricing defaults
  ledgerHistory: DayLedger[]; // previous days, most recent last (capped)
  merchant: MerchantState | null; // wholesale supplier; non-null during afternoons
  pricingHistory: PriceRecord[]; // player price-setting log (auto-pilot learns from this)
  autoPilotEnabled: boolean; // player toggle (§13); offline sim uses it regardless
  offlineSummary: OfflineSummary | null; // set on load after an away period; UI clears it
  reputation: number; // -1..1, shop's town-wide reputation (spec V2.9); recomputed and persisted each rollover
  buildings: TownBuilding[]; // town geometry registry (spec V2.8, issue #56); see defaultBuildings()
  /** The day's party AdventureScript, generated once at the afternoon-phase
   *  boundary (spec V2.5/V2.6, issue #76); null when nobody adventured today
   *  or after day rollover clears it. Additive; `loadGame()` defaults old
   *  saves to null. */
  currentScript: AdventureScript | null;
  /** The player's second character (spec V2.7, issue #83); `null` until
   *  `engine.createCharacters()` runs. Additive; `loadGame()` defaults old
   *  saves to null — every system already treats null as "no helper yet". */
  helper: Helper | null;
  /** The shopkeeper's own appearance, set alongside the helper at creation
   *  (spec V2.7). Additive; `loadGame()` defaults old saves to null. */
  shopkeeperAppearance: { skin: number; hair: number } | null;
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
