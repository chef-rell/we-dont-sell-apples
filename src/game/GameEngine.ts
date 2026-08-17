// Main game loop and time management. Phase 3: adventurers run on the real
// behavior state machine; Haiku steers daily plans asynchronously with a
// deterministic fallback always in place (spec §7).

import type {
  Adventurer,
  AdventurerClass,
  AdventureOutcome,
  Enchantment,
  GameState,
  HelperAssignment,
  HelperTrack,
  HelperTrait,
  Item,
  ItemRarity,
  StaffRole,
} from "../types";
import { advanceTime, phaseFor } from "./DayNightCycle";
import { generateUniqueName } from "../utils/names";
import { loadBudget } from "../utils/TokenBudget";
import { makeItem, startingInventory } from "../entities/Item";
import { loadGame, saveGame } from "./GameStatePersistence";
import { elapsedOfflineDays, runOfflineSim } from "./OfflineSim";
import { arrivalBonus, processDayEnd } from "./MoraleSystem";
import { generateAdventureScript } from "./Combat";
import { makeRng } from "../utils/rng";
import { accrueXp, createHelper, suggestPriceFor } from "../entities/Helper";
import { freshLedger, recordDonation, recordLootBuy, recordPayroll, recordRestock, rotateLedger } from "./Ledger";
import {
  buildCraftStructure,
  canBuildCraftStructure,
  canForgeOrder,
  canHireStaff,
  type CraftBuildingKind,
  forgeOrder as forgeOrderImpl,
  hireStaff as hireStaffImpl,
  runCraftProduction,
} from "./Property";
import { defaultCompetitors, recycleCompetitorGold } from "./Competition";
import { nextWeatherStreak, rollWeather } from "./Weather";
import {
  fallbackReply,
  freshChatterState,
  maybeChatter,
  playerChatResponders,
} from "./TownChat";
import { makeDecision, type MorningPlanDecision } from "../entities/AdventurerAI";
import {
  freshContext,
  stepAdventurer,
  applyPlanOverride,
  type BehaviorContext,
} from "../entities/AdventurerBehavior";
import {
  DEFAULT_DAILY_LIMIT_CALLS,
  DEFAULT_DAILY_LIMIT_TOKENS,
  EXPANSION_COSTS,
  MIN_ADVENTURER_COUNT,
  REPLACEMENT_DAYS_MAX,
  REPLACEMENT_DAYS_MIN,
  SHOP_SLOTS_BY_LEVEL,
  STARTING_ADVENTURER_COUNT,
  STARTING_GOLD,
} from "../utils/constants";
import { defaultBuildings, getBuilding } from "../utils/TownBuildings";

// Town geometry lives on GameState.buildings (spec V2.8, issue #56). This
// module-level registry backs the two spots below that need landmark
// coordinates before any GameState exists yet (initial/replacement spawns).
// The legacy TOWN shim that used to live here for TownView.tsx's rendering
// is gone — Phase 1's iso TownView reads GameState.buildings directly
// (spec V2.15 note 2, issue #70).
const REGISTRY = defaultBuildings();
const gateB = getBuilding(REGISTRY, "gate")!;
const squareB = getBuilding(REGISTRY, "square")!;

const MAX_MESSAGES = 100;

export class GameEngine {
  state: GameState;
  private contexts = new Map<string, BehaviorContext>();
  private plannedDay = new Map<string, number>(); // adventurer id → last day AI planning fired
  private chatter = freshChatterState();

  constructor(resume = true) {
    // Continue from an existing save when one exists (spec §12); pass
    // resume=false for an explicit New Game.
    const loaded = resume ? loadGame() : null;
    this.state = loaded ?? createInitialState();
    if (loaded) {
      // The world kept turning while the tab was closed (§13).
      const days = elapsedOfflineDays(loaded.lastSavedAt, Date.now());
      if (days > 0) runOfflineSim(this, days);
    }
  }

  /** Advance the simulation by a real-time delta (ms). */
  tick(deltaMs: number): void {
    const s = this.state;
    if (s.speed === 0) return;

    const prevPhase = s.phase;
    const t = advanceTime(s.timeOfDay, deltaMs, s.speed);
    if (t >= 1) {
      s.day += 1;
      s.timeOfDay = t - 1;
    } else {
      s.timeOfDay = t;
    }
    s.phase = phaseFor(s.timeOfDay);

    // v2 party formation (spec V2.5/V2.6, issue #76): the whole day's
    // AdventureScript is generated ONCE, right as afternoon begins, for
    // every adventurer whose day takes them adventuring. Facts are final
    // from this moment; stepAdventurer's per-member states (walk to gate,
    // "adventuring", resolve at evening) are untouched — they just read
    // their slice of this script instead of rolling their own solo outcome.
    if (prevPhase !== "afternoon" && s.phase === "afternoon") {
      this.formAfternoonParty();
    }
    // Full-wipe helper-carry beat (spec V2.7, issue #83): fires once, right
    // as the day crosses into evening — the same "facts are final at
    // generation, applied at the evening beat" timing every other
    // per-member script outcome already resolves at (AdventurerBehavior's
    // "adventuring" case, below). A wiped party has nobody left to run that
    // per-member path, so this is the one place that beat lands.
    if (prevPhase !== "evening" && s.phase === "evening") {
      this.resolveHelperWipeCarry();
    }

    const dt = (deltaMs / 1000) * s.speed;
    const dayRolled = t >= 1;
    // Night-raid script rollover (spec V2.9/Phase-2 deferral, issue #94):
    // clear YESTERDAY's stored night script here, BEFORE the adventurer
    // loop below can generate a fresh one straight over it. A night run
    // resolves the instant phase flips to "dawn" — exactly this tick, when
    // dayRolled is true — and AdventurerBehavior.resolveNightRun() writes
    // s.nightScript a few lines down, in the SAME tick as this clear AND
    // the SAME tick as onNewDay() (called at the bottom of this method,
    // also gated on dayRolled). Ordering matters: clearing here, ahead of
    // both, means a script written a few lines below survives untouched
    // for the entire day that follows — long enough for the strip (Phase
    // 5b) to play it back during that day's own night phase — and it's
    // NOT touched by onNewDay() (which intentionally never clears this
    // field; if it did, it would erase what this same tick just wrote).
    if (dayRolled) s.nightScript = null;
    for (const a of s.adventurers) {
      if (!a.alive) continue;
      const bc = this.contextFor(a.id);
      const result = stepAdventurer(a, bc, s, dt);
      for (const m of result.messages) this.pushMessage(m);
      if (result.outcome) this.handleOutcome(a, result.outcome);
      this.maybePlanWithAI(a);
    }
    const chat = maybeChatter(s, this.chatter);
    if (chat) this.pushMessage(chat);
    this.updateMerchant();
    this.checkGameOver();
    if (dayRolled) this.onNewDay();
  }

  /**
   * Form the day's party (spec V2.6): every alive adventurer whose plan for
   * today is "adventure" and hasn't already adventured marches together as
   * ONE AdventureScript (party of 1 is fine — solo adventurers still get a
   * script, just sized for one). Deterministic membership: who's in the
   * party is an engine fact decided here, not by walk timing. A `null`
   * script (nobody adventuring today) is a valid, common result.
   */
  private formAfternoonParty(): void {
    const s = this.state;
    // Storm = shop day (spec V2.9, issue #94): no party forms at all, no
    // matter who planned to adventure — AdventurerBehavior.ts's "wandering"
    // case also gates the gate-departure itself on `s.weather !== "storm"`,
    // so nobody's even mid-walk to the gate when this runs.
    if (s.weather === "storm") {
      s.currentScript = null;
      return;
    }
    const party = s.adventurers.filter((a) => {
      if (!a.alive) return false;
      const bc = this.contextFor(a.id);
      return bc.plan === "adventure" && !bc.adventured;
    });
    if (party.length === 0) {
      s.currentScript = null;
      return;
    }
    // Seed drawn live (spec V2.5: liveliness) but stored on the script so
    // any replay — a reload mid-afternoon, a future server — is exact.
    const seed = Math.floor(Math.random() * 2 ** 31);
    // Adventure-track helper (spec V2.7, issue #83): tags along only when a
    // real party is already marching — a "tag-along" needs a party to tag
    // along WITH. `undefined` (helper null/unassigned) reproduces pre-#83
    // scripts byte-for-byte — see Combat.ts's generateAdventureScript doc.
    const helperOpts =
      s.helper && s.helper.assignment === "adventure" ? { level: s.helper.level } : undefined;
    // Weather (spec V2.9, issue #94): rolled once at rollover, read here
    // into the threat multiplier only (rain/fog — see Weather.ts).
    s.currentScript = generateAdventureScript(
      party,
      s.day,
      { seed, helper: helperOpts, weather: s.weather },
      makeRng(seed),
    );
  }

  /** Full-wipe beat (spec V2.7, issue #83): reads the `helperCarry` events
   *  Combat.ts attached at script generation and delivers them to the
   *  PLAYER directly — nobody in the party survived to carry their own
   *  loot home. No-op when nobody adventured, nobody wiped, or the helper
   *  wasn't along; also the one place that records "was today a wipe day"
   *  for the adventure-track XP doubling `onNewDay()` applies at rollover. */
  private resolveHelperWipeCarry(): void {
    const s = this.state;
    const script = s.currentScript;
    if (!script) return;
    const wiped = script.events.some((e) => e.type === "defeat");
    this.helperWipeToday = wiped && script.helperAlong;
    if (!wiped || !script.helperAlong || !s.helper) return;

    let totalGold = 0;
    const items: { key: string; rarity: ItemRarity; enchantments: Enchantment[] }[] = [];
    for (const e of script.events) {
      if (e.type !== "helperCarry") continue;
      if (e.value) totalGold += e.value;
      // itemRarity/itemEnchantments travel on the event itself (spec V2.9,
      // issue #90) — this is the one loot-materialization path with no
      // surviving memberOutcome.lootRolls to read from (nobody made it
      // home), so the roll has to ride along on helperCarry directly.
      if (e.itemName) items.push({ key: e.itemName, rarity: e.itemRarity ?? "common", enchantments: e.itemEnchantments ?? [] });
    }
    s.gold += totalGold;
    for (const it of items) {
      const item = makeItem(it.key, { rarity: it.rarity, enchantments: it.enchantments, origin: "loot" });
      const empty = s.shelves.findIndex((slot) => slot === null);
      if (empty !== -1) s.shelves[empty] = item;
      else s.inventory.push(item);
    }
    const spoils =
      totalGold > 0 || items.length > 0
        ? ` — dragged home ${totalGold}g and ${items.length} item${items.length === 1 ? "" : "s"} the party never got to spend.`
        : ", empty-handed but alive.";
    this.pushMessage({
      id: `sys-helper-wipe-${s.day}`,
      senderId: "system",
      senderName: "Town",
      type: "system",
      content: `The party didn't make it back today. ${s.helper.name} did${spoils}`,
      timestamp: s.timeOfDay,
      day: s.day,
    });
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
      // Wipe stabilizer (spec V2.6, mandatory with parties): the graveyard
      // is functional, not flavor. Each death this wave pulls the next
      // replacement wave's due date in further (floor of 1 day out) and —
      // in onNewDay() below — enlarges it. A six-death wipe recovers in
      // days, not the dozen-plus it'd take trickling in one at a time.
      this.deathsSinceLastArrival += 1;
      const accel = Math.min(this.deathsSinceLastArrival - 1, REPLACEMENT_DAYS_MIN - 1);
      const dueSoonest =
        s.day + Math.max(1, REPLACEMENT_DAYS_MIN - accel) +
        Math.floor(Math.random() * (REPLACEMENT_DAYS_MAX - REPLACEMENT_DAYS_MIN + 1));
      this.replacementDueDay =
        this.replacementDueDay === null ? dueSoonest : Math.min(this.replacementDueDay, dueSoonest);
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
  /** Wipe stabilizer accumulator (spec V2.6): deaths since the last
   *  replacement wave landed; sizes and hastens the next one. */
  private deathsSinceLastArrival = 0;
  /** Set by resolveHelperWipeCarry() when today's script was a full wipe
   *  with the helper along; consumed once at the next onNewDay() rollover
   *  to double that day's adventure-track XP (spec V2.7, issue #83). */
  private helperWipeToday = false;

  private onNewDay(): void {
    const s = this.state;
    // Weather (spec V2.9, issue #94): rolled ONCE, right here, and stored —
    // every downstream reader (Combat.ts's threat calc, formAfternoonParty's
    // storm gate, updateMerchant's storm bonus) reads state only from this
    // point on. Faucet guard (rollWeather itself): two storms never land
    // back to back.
    const nextWeather = rollWeather(s.weather);
    s.weatherStreak = nextWeatherStreak(nextWeather, s.weather, s.weatherStreak);
    s.weather = nextWeather;

    // Competitor gold recycling (spec V2.9, issue #94): every till's
    // balance splits across the poorest half of the (alive) town —
    // deterministic, ledger-invisible ("the town spends its money in
    // town"). A no-op loop while every till is still 0 (no competitor
    // sales yet).
    recycleCompetitorGold(s);

    // Hired-staff payroll (spec V2.9, issue #91): each staffer's cut of
    // YESTERDAY's closing revenue, deducted and logged against that same
    // ledger entry right before it rotates into history — a no-op loop
    // while state.staff is empty (every pre-#91 save/game).
    for (const st of s.staff) {
      const pay = Math.round(st.cut * s.ledger.revenue);
      if (pay > 0) {
        s.gold -= pay;
        recordPayroll(s, pay);
      }
    }
    rotateLedger(s, s.day); // close yesterday's book before anything else
    s.currentScript = null; // the day's party script doesn't survive rollover (spec V2.5)

    // Craft production (spec V2.9, issue #91): garden/lab output, gated on
    // helper assignment or hired staff presence exactly per the issue's
    // rates. A complete no-op with zero craft buildings (every game before
    // a garden/lab is built, and the balance harness's no-craft path).
    runCraftProduction(s);

    // Helper XP accrual (spec V2.7, issue #83): once per rollover, off
    // whatever the sticky `assignment` was through the day that just ended
    // (nothing resets assignment mid-day, so it still reflects yesterday's
    // work at this point). Doubled if today closed out a full-wipe day the
    // adventure-track helper carried loot home from.
    if (s.helper) {
      const { xp, level } = accrueXp(s.helper, { wipeDay: this.helperWipeToday });
      s.helper.xp = xp;
      s.helper.level = level;
    }
    this.helperWipeToday = false;

    saveGame(s); // auto-save at the day rollover (§12)
    // Loot offers don't survive the night.
    s.lootOffers = s.lootOffers.filter((o) => o.day >= s.day);

    // Social pass (§14): morale drift, departures, reputation spread.
    const social = processDayEnd(s);
    for (const m of social.messages) this.pushMessage(m);
    if (social.departed.length > 0 && this.replacementDueDay === null) {
      this.replacementDueDay = s.day + REPLACEMENT_DAYS_MIN;
    }
    // A well-regarded shop attracts newcomers sooner (§14).
    if (this.replacementDueDay !== null) {
      this.replacementDueDay -= arrivalBonus(social.reputation);
    }

    // Charity (playtest finding): a shop grinding along with nothing to sell
    // and no coin to restock is soft-locked into a slog. When the player is
    // clearly struggling, a well-disposed adventurer donates a junk item —
    // relationships paying off (§14), and self-limiting: once per day, only
    // while genuinely broke, only from someone who doesn't resent you.
    const shelfValue = s.shelves.reduce((n, it) => n + (it?.baseValue ?? 0), 0);
    if (s.gold < 30 && shelfValue + s.inventory.reduce((n, it) => n + it.baseValue, 0) < 30) {
      const donors = s.adventurers.filter((a) => a.alive && a.relationships.shopkeeper >= 0);
      if (donors.length > 0) {
        const donor = donors[Math.floor(Math.random() * donors.length)];
        const junk = ["rusty_dagger", "crude_hide", "rations", "bat_wing"][
          Math.floor(Math.random() * 4)
        ];
        const item = makeItem(junk);
        const empty = s.shelves.findIndex((slot) => slot === null);
        if (empty !== -1) s.shelves[empty] = item;
        else s.inventory.push(item);
        recordDonation(s);
        this.pushMessage({
          id: `sys-charity-${s.day}`,
          senderId: donor.id,
          senderName: donor.name,
          type: "social",
          content: `${donor.name} left a ${item.name} on your counter. "Rough patch, eh? Pay me back in discounts."`,
          timestamp: s.timeOfDay,
          day: s.day,
        });
      }
    }

    // Replacement arrivals (§7): due date passed, or town below minimum.
    const aliveCount = s.adventurers.filter((a) => a.alive).length;
    const due = this.replacementDueDay !== null && s.day >= this.replacementDueDay;
    if ((due || aliveCount < MIN_ADVENTURER_COUNT) && aliveCount < STARTING_ADVENTURER_COUNT) {
      this.replacementDueDay = null;
      // Wipe stabilizer (spec V2.6): the wave size scales with deaths since
      // the last wave, capped by how many are actually missing — avengers
      // and fortune-seekers hear about a bad week and come in numbers,
      // instead of trickling in one at a time after a full wipe.
      const deficit = STARTING_ADVENTURER_COUNT - aliveCount;
      const waveSize = Math.max(1, Math.min(deficit, Math.ceil(this.deathsSinceLastArrival / 2)));
      this.deathsSinceLastArrival = 0;
      const names = s.adventurers.map((x) => x.name);
      for (let i = 0; i < waveSize; i++) {
        const newcomer = createReplacementAdventurer(names);
        names.push(newcomer.name);
        s.adventurers.push(newcomer);
        this.pushMessage({
          id: `sys-arrival-${s.day}-${i}`,
          senderId: "system",
          senderName: "Town",
          type: "system",
          content:
            waveSize > 1
              ? `A new face in town, drawn by word of the graveyard: ${newcomer.name} the ${newcomer.class} has arrived.`
              : `A new face in town: ${newcomer.name} the ${newcomer.class} has arrived.`,
          timestamp: s.timeOfDay,
          day: s.day,
        });
      }
    }
  }

  // ---------- Phase 3: helper entity + tracks (spec V2.7, issue #83) ----------
  // Small, delegating wrappers — the actual math/factory lives in
  // src/entities/Helper.ts (issue #83's own constraint: "keep GameEngine's
  // additions small and delegating").

  /** One-time character creation. Creation UI is issue #84's job; this is
   *  the deterministic entity/state its picks produce. Returns false if a
   *  helper already exists (creation only ever happens once per save). */
  createCharacters(
    shopkeeperAppearance: { skin: number; hair: number },
    helperName: string,
    helperAppearance: { skin: number; hair: number },
    trait: HelperTrait,
  ): boolean {
    const s = this.state;
    if (s.helper) return false;
    s.shopkeeperAppearance = shopkeeperAppearance;
    s.helper = createHelper(helperName, helperAppearance, trait, s.day);
    return true;
  }

  /** Today's job (spec V2.7): one per day, sticky until this is called
   *  again. All three jobs are choosable from day 1 — "days 1-10" gates
   *  the PERMANENT track choice below, not which daily job is available;
   *  see the PR body for the full reasoning (the issue's own shop/adventure
   *  effect rules key off `assignment`, not `track`). */
  setHelperAssignment(assignment: HelperAssignment): boolean {
    const s = this.state;
    if (!s.helper) return false;
    s.helper.assignment = assignment;
    s.helper.assignmentDay = s.day;
    return true;
  }

  /** Permanent, one-way specialization (spec V2.7): unlocks day 10+.
   *  "craft" was rejected through Phase 4a; unlocked as of #91 — garden/
   *  lab/forge build gates key off `helper.track === "craft"` (see
   *  game/Property.ts). Already having a track chosen makes this a no-op
   *  false — the choice can't be revisited. */
  chooseTrack(track: HelperTrack): boolean {
    const s = this.state;
    if (!s.helper) return false;
    if (s.day < 10) return false;
    if (s.helper.track !== "none") return false;
    if (track === "none") return false;
    s.helper.track = track;
    s.helper.trackChosenDay = s.day;
    return true;
  }

  // ---------- Phase 4b: craft property, production, hired staff (spec V2.9, issue #91) ----------
  // Small, delegating wrappers — the actual gating/production math lives in
  // src/game/Property.ts (same shape as Forge.ts's 4a repair math / #83's
  // Helper.ts split).

  /** Build a craft-track structure once its stage is unlocked: garden
   *  (150g, L1 gardening), alchemy_lab (400g + 2 echo_crystal, L2
   *  alchemy), forge (800g + 2 golem_plate + 1 core_shard, L3
   *  blacksmithing). Fixed plot adjacent to the shop; enters
   *  `state.buildings` clickable so a later phase can open its panel. */
  buildStructure(kind: CraftBuildingKind): boolean {
    const s = this.state;
    const built = buildCraftStructure(s, kind);
    if (!built) return false;
    this.pushMessage({
      id: `sys-build-${s.day}-${kind}`,
      senderId: "system",
      senderName: "Town",
      type: "system",
      content: `The ${buildingLabel(kind)} is built and ready.`,
      timestamp: s.timeOfDay,
      day: s.day,
    });
    return true;
  }

  /** Read-only affordability/gating check for a build-structure panel. */
  canBuildStructure(kind: CraftBuildingKind): boolean {
    return canBuildCraftStructure(this.state, kind);
  }

  /** Hire a townsperson for a craft/shop role (spec V2.9's escape hatch):
   *  200g fee, 8% of daily sales revenue as ongoing payroll (paid at
   *  rollover). Available once the corresponding stage's helper-unlock
   *  reference day + 12 has passed, or reputation >= 0.3 — whichever comes
   *  first (see `Property.staffHireUnlockDay`). */
  hireStaff(role: StaffRole): boolean {
    const s = this.state;
    const staff = hireStaffImpl(s, role);
    if (!staff) return false;
    this.pushMessage({
      id: `sys-hire-${s.day}-${staff.id}`,
      senderId: "system",
      senderName: "Town",
      type: "system",
      content: `${staff.name} has been hired to work the ${role}.`,
      timestamp: s.timeOfDay,
      day: s.day,
    });
    return true;
  }

  /** Read-only hire-eligibility check for a staffing panel. */
  canHireStaff(role: StaffRole): boolean {
    return canHireStaff(this.state, role);
  }

  /** Player-triggered forge crafting (spec V2.9): 2 monster materials +
   *  half baseValue in gold -> a forged (origin "forged", common rarity —
   *  see Property.ts's judgment-call doc) piece of gear, once per day.
   *  Helper-only; hired forge staff run repairs, never crafting. */
  forgeOrder(defKey: string): boolean {
    return forgeOrderImpl(this.state, defKey) !== null;
  }

  /** Read-only forge-order eligibility check for a crafting panel. */
  canForgeOrder(defKey: string): boolean {
    return canForgeOrder(this.state, defKey);
  }

  /** Deterministic pricing recommendation (spec V2.7, L3+ shop track only)
   *  — a recommendation surface for the pricing panel, NEVER an
   *  Economy.ts §6 input. Null whenever there's no helper eligible for it
   *  right now (no helper, not on shop duty today, or under level 3). */
  suggestPrice(item: Item): number | null {
    const s = this.state;
    if (!s.helper || s.helper.assignment !== "shop" || s.helper.level < 3) return null;
    return suggestPriceFor(s.pricingHistory, item);
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

  /** Best opening price for the pricing panel: the last price this item name
   *  actually SOLD at (proven to clear), else the last price the player set
   *  for it, else null (panel falls back to its own default). */
  suggestedPrice(itemName: string): { price: number; fromSale: boolean } | null {
    const sold = this.state.lastSalePriceByName[itemName];
    if (sold !== undefined) return { price: sold, fromSale: true };
    for (let i = this.state.pricingHistory.length - 1; i >= 0; i--) {
      if (this.state.pricingHistory[i].itemName === itemName) {
        return { price: this.state.pricingHistory[i].priceSet, fromSale: false };
      }
    }
    return null;
  }

  /** Move a stockroom item onto the first empty shelf (issue #46). */
  shelveItem(itemId: string): boolean {
    const s = this.state;
    const idx = s.inventory.findIndex((it) => it.id === itemId);
    if (idx === -1) return false;
    const slot = s.shelves.findIndex((sl) => sl === null);
    if (slot === -1) return false;
    s.shelves[slot] = s.inventory[idx];
    s.inventory.splice(idx, 1);
    return true;
  }

  /** Cost of the next shop expansion, or null at max level (§5). */
  nextExpansionCost(): number | null {
    return EXPANSION_COSTS[this.state.shopLevel - 1] ?? null;
  }

  /** Expand the shop one tier (§5): 300/600/1200g for levels 2-4. Adds shelf
   *  slots and moves stockroom overflow onto the new space. */
  expandShop(): boolean {
    const s = this.state;
    const cost = this.nextExpansionCost();
    if (cost === null || s.gold < cost) return false;
    s.gold -= cost;
    s.shopLevel += 1;
    const slots = SHOP_SLOTS_BY_LEVEL[s.shopLevel - 1];
    while (s.shelves.length < slots) {
      s.shelves.push(s.inventory.shift() ?? null);
    }
    this.pushMessage({
      id: `sys-expand-${s.day}-${s.shopLevel}`,
      senderId: "system",
      senderName: "Town",
      type: "system",
      content: `The shop has expanded! Now ${slots} display slots.`,
      timestamp: s.timeOfDay,
      day: s.day,
    });
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
    recordRestock(s, item.baseValue);
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
        // Storm faucet guard (spec V2.9, issue #94): storm days block the
        // wilderness faucet entirely (no party forms), so the merchant
        // brings a gold bonus instead — buys one loot/material item off a
        // random adventurer at base value. Fires exactly once per storm
        // day, same "day just rolled" gate as the stock roll above.
        if (s.weather === "storm") this.applyStormMerchantBonus();
      }
    } else if (s.merchant) {
      s.merchant = null; // cart moves on when afternoon ends
    }
  }

  /** The storm-day gold injection above — its own method so `updateMerchant`
   *  stays readable. Picks a random ALIVE adventurer holding a loot/material
   *  item (Math.random is fine: WHICH adventurer sells is liveliness, not a
   *  §6 verdict), removes one such item, credits them its baseValue in
   *  gold. A no-op (silently) if nobody's holding one — same "when eligible"
   *  shape as the day-rollover charity donation. */
  private applyStormMerchantBonus(): void {
    const s = this.state;
    const candidates = s.adventurers.filter((a) => a.alive && a.inventory.some((it) => it.category === "loot"));
    if (candidates.length === 0) return;
    const seller = candidates[Math.floor(Math.random() * candidates.length)];
    const idx = seller.inventory.findIndex((it) => it.category === "loot");
    const [item] = seller.inventory.splice(idx, 1);
    seller.gold += item.baseValue;
    this.pushMessage({
      id: `sys-storm-merchant-${s.day}`,
      senderId: "system",
      senderName: "Town",
      type: "system",
      content: `Storm's got everyone indoors, but the wholesale merchant bought ${seller.name}'s ${item.name} for ${item.baseValue}g anyway — gold has to move somehow.`,
      timestamp: s.timeOfDay,
      day: s.day,
    });
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

  /** Player retires the run (playtest finding: no exit from a soft-locked
   *  slog short of literal bankruptcy). Routes through the normal Game Over
   *  screen so the run's stats are shown and the restart button is there. */
  retireShop(): void {
    this.state.view = "gameover";
    this.state.speed = 0;
  }

  /** Manual save; also called automatically at each day rollover. */
  save(): void {
    saveGame(this.state);
  }

  /** The player speaks in town chat (§16). Appends their message and
   *  triggers reactive responses — AI-written in full mode, deterministic
   *  otherwise. Dev B's ChatPanel calls this. */
  sendPlayerChat(text: string): void {
    const s = this.state;
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;
    this.pushMessage({
      id: `player-${s.day}-${Math.round(s.timeOfDay * 10000)}`,
      senderId: "player",
      senderName: "Shopkeeper",
      type: "player",
      content: trimmed,
      timestamp: s.timeOfDay,
      day: s.day,
    });
    for (const responder of playerChatResponders(s, trimmed)) {
      const reply: GameState["messages"][number] = {
        id: `reply-${s.day}-${responder.id}-${Math.round(s.timeOfDay * 10000)}`,
        senderId: responder.id,
        senderName: responder.name,
        type: "social",
        content: fallbackReply(responder, trimmed),
        timestamp: s.timeOfDay,
        day: s.day,
      };
      this.pushMessage(reply);
      if (s.aiMode === "full") {
        const context =
          `The shopkeeper just said in town chat: "${trimmed}". ` +
          `Reply with one short in-character line.`;
        void makeDecision("shop_flavor", responder, context, s.tokenBudget).then((d) => {
          if (d && "text" in d) reply.content = d.text;
        });
      }
    }
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
    recordLootBuy(s, offer.askPrice);
    seller.gold += offer.askPrice;
    seller.inventory = seller.inventory.filter((it) => it.id !== offer.item.id);
    // Onto an empty shelf when there is one (playtest finding: the stockroom
    // has no UI yet — issue #46 — so shelved loot is loot the player can
    // actually see, price, and resell).
    const bought = { ...offer.item, salePrice: null };
    const emptySlot = s.shelves.findIndex((slot) => slot === null);
    if (emptySlot !== -1) s.shelves[emptySlot] = bought;
    else s.inventory.push(bought);
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
    saveVersion: 2,
    day: 1,
    // Open at dawn, not straight into the morning rush: §4 gives dawn to the
    // player to price the shelves before the first customer moves (#50).
    timeOfDay: 0.02,
    phase: "dawn",
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
    ledger: freshLedger(1),
    ledgerHistory: [],
    lastSalePriceByName: {},
    autoPilotEnabled: false,
    offlineSummary: null,
    reputation: 0,
    buildings: defaultBuildings(),
    currentScript: null,
    nightScript: null,
    helper: null,
    shopkeeperAppearance: null,
    staff: [],
    competitors: defaultCompetitors(),
    weather: "clear",
    weatherStreak: 1,
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

/** Player-facing name for a "the X is built" system message (issue #91). */
function buildingLabel(kind: CraftBuildingKind): string {
  if (kind === "garden") return "garden";
  if (kind === "alchemy_lab") return "alchemy lab";
  return "forge";
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
function createReplacementAdventurer(taken: string[]): Adventurer {
  const c = STARTING_CAST[Math.floor(Math.random() * STARTING_CAST.length)];
  const [a] = buildAdventurers([c], gateB.door!.x - 40, gateB.door!.y + 30, taken);
  return a;
}

function createStartingAdventurers(): Adventurer[] {
  return buildAdventurers(
    STARTING_CAST.slice(0, STARTING_ADVENTURER_COUNT),
    squareB.footprint.x - 100,
    squareB.footprint.y - 20,
    [],
  );
}

function buildAdventurers(
  cast: typeof STARTING_CAST,
  originX: number,
  originY: number,
  takenNames: string[] = [],
): Adventurer[] {
  const names = [...takenNames];
  return cast.map((c, i) => ({
    id: crypto.randomUUID(),
    name: (() => {
      const n = generateUniqueName(names);
      names.push(n);
      return n;
    })(),
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
      lowMoraleDays: 0,
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
