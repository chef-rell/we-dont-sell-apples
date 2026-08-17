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

// ---------- Rarity, enchantments, origin (spec V2.9, issue #90) ----------

/** Forge ceiling is "uncommon" — rare/legendary are adventure-exclusive
 *  (spec V2.9). The ONLY place rarity touches the §6 economy is baseValue,
 *  computed once at item creation by `applyRarity()` in `entities/Item.ts`;
 *  `Economy.ts`'s verdict functions and REACTION_BANDS never change. */
export type ItemRarity = "common" | "uncommon" | "rare" | "legendary";

/** Drop on loot only (never forged/stock). Combat effects while equipped are
 *  documented at each application site in `game/Combat.ts`'s
 *  generateAdventureScript. */
export type Enchantment = "flame" | "lifesteal" | "warding" | "vigor";

/** Where an item came from — drives the durability split (spec V2.9):
 *  loot maxDurability ×0.7 (hits harder, breaks sooner), forged ×1.3
 *  (bread-and-butter), stock (today's shop/wholesale items) unchanged. */
export type ItemOrigin = "stock" | "loot" | "forged";

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
  // ---- spec V2.9 / issue #90 (additive) ----
  rarity: ItemRarity; // ??= "common" on load (GameStatePersistence.patchItem)
  enchantments: Enchantment[]; // ??= []
  origin: ItemOrigin; // ??= "stock"
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

/** Rolled rarity/enchantments for one loot drop (spec V2.9, issue #90).
 *  `key` matches the corresponding entry in `AdventureOutcome.lootItemKeys`
 *  (same index, same order) — kept as a separate parallel array rather than
 *  replacing `lootItemKeys` so every existing reader of that field (loot
 *  count/narration, `AdventureStripRenderer`) stays untouched. */
export interface LootRoll {
  key: string; // ITEM_DEFS key
  rarity: ItemRarity;
  enchantments: Enchantment[];
}

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
  /** spec V2.9/issue #90 (additive): rarity/enchantments rolled for each
   *  lootItemKeys entry, same order. Only `generateAdventureScript` rolls
   *  rarity (seeded rng, see Combat.ts); v1's resolveAdventure() fallback
   *  (stragglers/night runs) fills this with common-rarity, no-enchant
   *  entries — same shape, unrolled — a documented scope choice (issue #90
   *  PR body). ??= a common-rarity mapping of lootItemKeys on load. */
  lootRolls: LootRoll[];
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
  /** spec V2.9/issue #90 (additive): set alongside `itemName` on `lootDrop`
   *  and `helperCarry` events carrying loot — GameEngine's full-wipe carry
   *  path (`resolveHelperWipeCarry`) reads these to materialize the item
   *  with the SAME roll `generateAdventureScript` made, since that path
   *  only has the events to work from (no memberOutcome survives a wipe to
   *  read `lootRolls` off). Undefined on every other event type. */
  itemRarity?: ItemRarity;
  itemEnchantments?: Enchantment[];
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
 *  three (now four) from day 1 (see PR body): `track` gates the PERMANENT
 *  commitment and its trait XP bonus, not which daily job is available.
 *  "craft" added spec V2.9/issue #91 — drives that day's garden/lab/forge
 *  production (see `game/Property.ts`); exactly like shop/adventure, it's
 *  choosable pre-day-10 but only earns the trait/XP-curve treatment once
 *  `track === "craft"` is actually committed. */
export type HelperAssignment = "chores" | "shop" | "adventure" | "craft";

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
  /** Day `engine.chooseTrack()` committed the permanent track (spec V2.9,
   *  issue #91); null until that happens. The reference point for the
   *  "shop" hired-staff hire-eligibility window (day >= this + 12) — craft
   *  roles use their building's `TownBuilding.builtDay` instead, since
   *  craft has three separately-unlocked stages, not one. Additive; `??=
   *  null` on load for every pre-#91 save. */
  trackChosenDay: number | null;
}

// ---------- Hired staff (spec V2.9's escape hatch, issue #91) ----------

/** Which station a hire works. Mirrors the three craft buildings plus the
 *  shop itself — "any track's buildings/services can eventually be
 *  staffed" (spec V2.9). */
export type StaffRole = "garden" | "lab" | "forge" | "shop";

/** A hired townsperson (spec V2.9, issue #91): the helper path is strictly
 *  better (earlier, better output, cheaper) — staff exist as the escape
 *  hatch for the OTHER two tracks the player didn't commit their one helper
 *  to. Always drawn from a fixed townsfolk name pool (`utils/names.ts`),
 *  NEVER from the adventurer roster. */
export interface Staff {
  id: string; // UUID
  name: string;
  role: StaffRole;
  hiredDay: number;
  /** Fraction of that day's sales revenue paid as payroll at rollover
   *  (0.08 today — spec V2.9's "8% of daily sales"). Carried per-staff
   *  rather than read from a shared constant so a future differentiated
   *  rate change stays a data change, not a code change. */
  cut: number;
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
  /** spec V2.9/issue #91 (additive): gold paid out to hired staff as their
   *  cut of this day's revenue — computed and deducted at the FOLLOWING
   *  day's rollover, right before this ledger closes and rotates into
   *  history, so the payroll line lands on the same book its cut was read
   *  from (`GameEngine.onNewDay`). */
  payrollSpend: number;
  /** spec V2.9/issue #91 (additive): gold taken in from the forge's repair
   *  service this day (`AdventurerBehavior`'s repair errand). */
  repairRevenue: number;
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

// ---------- Weather (spec V2.9, issue #94) ----------

/** Rolled ONCE at each day rollover and stored — every downstream reader
 *  (Combat.ts's threat calc, party formation, the wholesale merchant) reads
 *  this field only, never rerolls. "storm" is a shop day: no party forms
 *  (GameEngine.formAfternoonParty). Faucet guard: two storms never land
 *  back to back (see `rollWeather` in game/Weather.ts) — a would-be second
 *  storm re-rolls to "clear" instead. */
export type WeatherKind = "clear" | "rain" | "fog" | "storm";

// ---------- NPC competitor stores (spec V2.10, issue #94) ----------

/** A rival shop (spec V2.10 — "deliberately shallow"): no full inventory
 *  simulation. `priceLevel` is a fixed markup multiplier (1.5-1.9× a basic
 *  item's baseValue, see `game/Competition.ts`'s `defaultCompetitors()`);
 *  rotating stock is computed on demand from `day` + `id` (deterministic,
 *  not persisted) rather than stored here. `till` accumulates gold from
 *  adventurer purchases through the day and pays out to the poorest
 *  adventurers at the next rollover ("the town spends its money in town",
 *  spec V2.9's gold recycling) — ledger-invisible, since it was never the
 *  player's money. */
export interface CompetitorStore {
  id: string;
  name: string;
  priceLevel: number;
  till: number;
}

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
  /** True for a player-built plot structure (garden/alchemy_lab/forge —
   *  spec V2.9, issue #91) as opposed to fixed town infrastructure.
   *  Additive; absent/undefined on every building that predates #91 and on
   *  every fixed-infrastructure entry from `defaultBuildings()`. */
  playerBuilt?: true;
  /** Day this player-built structure was completed (issue #91) — the
   *  reference point for its hired-staff hire-eligibility window (day >=
   *  this + 12) and its own once-per-day production/order cap. Additive;
   *  undefined for fixed infrastructure and for saves from before #91. */
  builtDay?: number;
  /** Last day this building actually produced/crafted something (issue
   *  #91) — caps the forge's player-triggered `forgeOrder()` at once per
   *  day (garden/lab production is naturally once-per-day already, since it
   *  only runs from `GameEngine.onNewDay()`). Additive. */
  lastProducedDay?: number;
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
  /** A night owl's solo run script (spec V2.9/Phase-2 deferral, issue #94):
   *  written in `AdventurerBehavior.resolveNightRun()` the moment a night
   *  run generates (dawn, the instant the day rolls over) so the strip
   *  (Phase 5b) can play it back during the FOLLOWING night phase; cleared
   *  right before that write, at the NEXT day's rollover (see
   *  `GameEngine.tick`'s `dayRolled` guard — timed deliberately ahead of
   *  onNewDay() so a script written this tick isn't erased in the same
   *  tick it's created). Distinct from `currentScript`, which is reserved
   *  for the day's one afternoon party. Additive; `??= null` on load. */
  nightScript: AdventureScript | null;
  /** The player's second character (spec V2.7, issue #83); `null` until
   *  `engine.createCharacters()` runs. Additive; `loadGame()` defaults old
   *  saves to null — every system already treats null as "no helper yet". */
  helper: Helper | null;
  /** The shopkeeper's own appearance, set alongside the helper at creation
   *  (spec V2.7). Additive; `loadGame()` defaults old saves to null. */
  shopkeeperAppearance: { skin: number; hair: number } | null;
  /** Hired townspeople (spec V2.9's escape hatch, issue #91); `[]` until
   *  `engine.hireStaff()` is called. Additive; `loadGame()` defaults old
   *  saves to `[]` — every system already treats an empty roster as "no
   *  hires yet". */
  staff: Staff[];
  /** NPC competitor stores (spec V2.10, issue #94); seeded via
   *  `defaultCompetitors()` in `game/Competition.ts`. Additive; `loadGame()`
   *  defaults old saves to a fresh `defaultCompetitors()` array. */
  competitors: CompetitorStore[];
  /** Today's committed weather (spec V2.9, issue #94), rolled once at
   *  rollover. Additive; `loadGame()` defaults old saves to `"clear"`. */
  weather: WeatherKind;
  /** Consecutive days (including today) at the current `weather` kind.
   *  Additive; `loadGame()` defaults old saves to `1`. */
  weatherStreak: number;
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
