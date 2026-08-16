# We Don't Sell Apples — Game Design Spec & Build Guide

**Project Owner & Developer A:** Mr. G, Sr. Dev  
**Co-Developer B:** Basmine Brown, Co-Developer

## For Claude Code (Fable Orchestrator)

This is a complete specification for building a browser-based shop simulation game. Build this autonomously — make decisions, don't ask for permission at each step. The owner will review the finished product. Use Fable to orchestrate, assigning Opus or Sonnet subagents for implementation work to conserve tokens.

---

## 1. PROJECT SETUP

**Stack:** Vite + React + TypeScript  
**Rendering:** HTML5 Canvas (2D, chunky pixel art style — every visual is procedural rectangles, no external image assets)  
**Audio:** Tone.js for procedural sound effects and ambient music  
**AI Agents:** Anthropic API (Claude Haiku) called from the client for adventurer decision-making  
**API Key:** Mr. G will add the API key to the `.env` file and Railway environment variables himself. Do not include any API keys in code, documentation, or commits. The `.env` file is in `.gitignore`. The game should also support entering/changing the key via a settings screen as a backup, storing the override in localStorage.  
**No external art assets.** Everything is rendered procedurally on Canvas. Pixel art style using filled rectangles at a base pixel size of 4px.

**Project structure (suggested):**
```
we-dont-sell-apples/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Root component, view router
│   ├── game/
│   │   ├── GameEngine.ts        # Main game loop, time management
│   │   ├── GameState.ts         # Central state, save/load
│   │   ├── Economy.ts           # Pricing, transactions, gold
│   │   ├── DayNightCycle.ts     # Day/night timing
│   │   ├── Events.ts            # Random events, arrivals
│   │   ├── AutoPilot.ts         # Shopkeeper auto-pilot AI, pricing inference
│   │   ├── OfflineSim.ts        # Offline simulation engine
│   │   └── MoraleSystem.ts      # Adventurer morale and loyalty tracking
│   ├── entities/
│   │   ├── Adventurer.ts        # Adventurer data model
│   │   ├── AdventurerAI.ts      # Haiku agent integration (clean interface for future backend swap)
│   │   ├── AdventurerBehavior.ts # State machine for movement/actions
│   │   ├── AdventurerFallback.ts # Deterministic fallback when AI unavailable
│   │   ├── Monster.ts           # Monster definitions
│   │   └── Item.ts              # Item definitions and generation
│   ├── views/
│   │   ├── TownView.tsx         # Town overview (default view)
│   │   ├── ShopView.tsx         # Shop interior
│   │   ├── WildernessView.tsx   # Outside area / dungeons
│   │   └── GameOverView.tsx     # Failure state
│   ├── ui/
│   │   ├── HUD.tsx              # Gold, day counter, notifications
│   │   ├── PricingPanel.tsx     # Moonlighter-style price setting
│   │   ├── InventoryPanel.tsx   # Shop inventory management
│   │   ├── AdventurerLog.tsx    # Activity feed / decisions
│   │   └── ShopExpansion.tsx    # Upgrade shop UI
│   ├── rendering/
│   │   ├── PixelRenderer.ts     # Core pixel drawing utilities
│   │   ├── CharacterRenderer.ts # Character sprite generation
│   │   ├── BuildingRenderer.ts  # Building drawing
│   │   ├── ItemRenderer.ts      # Item icon drawing
│   │   └── Effects.ts           # Particles, sparkles, combat fx
│   ├── audio/
│   │   ├── SoundManager.ts      # Tone.js sound system
│   │   ├── MusicGenerator.ts    # Ambient procedural music
│   │   └── SFX.ts               # Sound effect definitions
│   └── utils/
│       ├── constants.ts         # Game balance numbers
│       ├── names.ts             # Name generation
│       ├── TokenBudget.ts       # API call tracking, daily limits, cost estimation
│       └── helpers.ts           # Shared utilities
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json
└── .env                         # API key — Mr. G adds this manually, never committed
```

This structure is a suggestion. Deviate if it makes sense, but maintain clear separation between game logic, rendering, AI, and UI.

---

## 2. GAME OVERVIEW

The player is the owner of the only shop in a small frontier town. Adventurers come to buy gear, leave to fight monsters and explore dungeons, and return to sell loot. The player sets prices, manages inventory, expands the shop and town, and watches AI-driven adventurers live autonomous lives.

**Core fantasy:** You don't swing the sword. You sell it. And then you watch the person you sold it to go fight a dragon with it. And you care whether they come back — because they're your best customer.

---

## 3. GAME VIEWS

Three views connected as a hub model. The player can switch between them freely.

### 3a. Town View (Default)
Top-down pixel art view of the town. Visible elements:
- **Your Shop** — the main building, clickable to enter Shop View
- **Town Square** — open area where adventurers mill about
- **Gate** — exit to wilderness, clickable to enter Wilderness View
- **Houses** — where adventurers rest (simple buildings, expand later)
- **Tavern** — where adventurers hang out when not shopping/adventuring (future: rumors, quests)
- **Adventurer sprites** — small pixel characters walking between locations based on their AI state

The player watches adventurers move around town. An adventurer walking toward the shop means a potential customer. One heading to the gate means they're about to go fight things (hopefully with your gear). One limping back means they've got loot to sell.

The town should feel alive. Adventurers should have idle behaviors — stopping to chat with each other, sitting on benches, pacing.

### 3b. Shop View
Interior view of the player's shop. This is where the core selling gameplay happens.

Elements:
- **Shelves** — display items for sale with prices
- **Counter** — where transactions happen
- **Shopkeeper (player character)** — stands behind the counter
- **Adventurer customers** — browse shelves, approach counter, react to prices
- **Pricing UI** — Moonlighter-style (see section 6)
- **Buy-from-adventurer UI** — when adventurers sell loot to you

### 3c. Wilderness View
The area outside town. The player is a spectator here.

Elements:
- **Terrain** — forests, rocky areas, a dungeon entrance
- **Monsters** — creatures adventurers fight (see section 8)
- **Adventurers in combat** — visible fighting with health bars
- **Loot drops** — sparkle effects when monsters are killed
- **Adventurer status** — HP bars, names, what they're carrying

The player cannot interact with combat. They can only watch. The emotional hook is: "I sold Bren that iron sword. Is it good enough for this fight?"

---

## 4. TIME SYSTEM

**Day cycle: 10 real-time minutes = 1 game day (at 1× speed).**

The day has phases:
- **Dawn** (0-10% of day, ~60 seconds) — adventurers wake up, some head to shop early. Sky lightens.
- **Morning** (10-35%, ~2.5 minutes) — peak shopping time. Most adventurers visit the shop.
- **Afternoon** (35-60%, ~2.5 minutes) — adventurers head out through the gate. Shopping slows down.
- **Evening** (60-80%, ~2 minutes) — adventurers return from wilderness. Loot selling happens. Sky dims.
- **Night** (80-100%) — FAST FORWARD. Night passes at 3× speed (so ~40 seconds). Adventurers rest. Shop is closed. Use this time for a day summary overlay: gold earned, items sold, adventurers lost, notable events. Night-owl adventurers may still be active during this phase.

**Speed controls (always visible in HUD):**
- **1×** — default, 10 minutes per day. Full experience, watch everything unfold.
- **1.5×** — ~6.5 minutes per day. For when you've got prices set and want to watch results faster.
- **2×** — 5 minutes per day. Quick play. Good for experienced players or when auto-pilot is running.
- **Pause** — freeze time entirely. Player can still browse shop inventory, adjust prices, and read logs. Time resumes on unpause.

Speed affects animation speed, adventurer movement, and day progression. Does NOT affect Haiku API call frequency — decisions still happen at the same game-time triggers regardless of real-time speed.

Visual day/night cycle: sky color changes, lighting shifts. During night fast-forward, dim the screen and show the summary overlay.

**Dead time problem:** Afternoon (~2.5 min) and evening (~2 min) can leave the player with nothing to do but watch. Mitigate this by giving the player activities during slow periods: restocking shelves from the wholesale supplier, rearranging shelf layout, adjusting prices for the next day, reading the chat log, checking adventurer status. The wholesale supplier should be available during afternoon specifically, so restocking fills the gap between the morning rush and the evening loot-selling wave.

---

## 5. ECONOMY

### Starting Conditions
- Player gold: 200
- Shop size: Small (3 shelf rows, ~4 items per shelf = 12 display slots)
- Starting inventory:
  - Iron Sword ×3 (base value: 30g)
  - Wooden Shield ×2 (base value: 20g)
  - Leather Armor ×2 (base value: 40g)
  - Health Potion ×4 (base value: 10g)
  - Traveler's Cloak ×1 (base value: 15g)
  - Simple Ring ×1 (base value: 25g)

### Item Categories
- **Weapons:** Swords, daggers, bows, staves
- **Armor:** Chest pieces, helmets, shields
- **Accessories:** Rings, amulets, cloaks
- **Consumables:** Health potions, antidotes, rations
- **Loot (from adventurers):** Monster hides, crude gems, dungeon artifacts, broken weapons (can be resold at markup)

### Pricing Rules
Every item has a **base value**. The player sets a **sale price**. The markup ratio determines adventurer reactions:
- **< 1.0× base** — Everyone buys instantly. You're losing money.
- **1.0-1.3×** — Happy faces. Most adventurers buy without hesitation.
- **1.3-1.8×** — Uncertain faces. Some buy, some walk away. Depends on their need and wealth.
- **1.8-2.5×** — Unhappy faces. Only desperate or wealthy adventurers buy.
- **> 2.5×** — Angry faces. Almost no one buys. Adventurers may leave the shop entirely.

When buying loot FROM adventurers, the reverse applies. Adventurers want to sell at a fair price. Offer too low and they'll refuse or go to the tavern to grumble.

### Failure Condition
If the player's gold reaches 0 AND they have no inventory to sell, the game ends. Show a Game Over screen with stats: days survived, total gold earned, adventurers served, best customer, etc. Offer a restart button.

### Gold Sinks (expansion)
- Expand shop (more shelves): 300g, 600g, 1200g for each tier
- New town buildings: 500g+ each
- Restock basic items (a traveling merchant comes periodically): costs gold
- Repair shop after events (future: monster attacks)

---

## 6. MOONLIGHTER-STYLE PRICING

This is the core mechanic and needs to feel good.

**How it works:**
1. Player clicks an item on a shelf (or in inventory).
2. A pricing widget appears showing the item, its base value (hidden at first — the player learns fair prices through reactions), and price adjustment controls.
3. Player sets price using **+/- buttons** (increment by 1g, hold for fast, or click the price to type directly).
4. When an adventurer approaches the item, a **reaction face** appears above their head:
   - 😊 Happy (green) — good deal, will buy
   - 😐 Neutral (yellow) — considering, might buy
   - 😟 Unhappy (orange) — too expensive, will probably leave
   - 😠 Angry (red) — outrageous, will leave and tell others
5. The player observes reactions across multiple customers and dials in the sweet spot.
6. **Key insight the player must discover:** different adventurers have slightly different price tolerances, but the bands are learnable. Over time, the player triangulates the sweet spot.

**CRITICAL DESIGN RULE: Reaction faces are a DETERMINISTIC FUNCTION, not an AI decision.**

The reaction is calculated from the markup ratio (§5 bands) as the baseline. Personality, morale, loyalty, and need shift the thresholds by a bounded ±15% maximum. This shift is always the same for the same adventurer in the same state — it's a formula, not a roll.

Example: the "unhappy" threshold is normally 1.8× markup. A frugal adventurer with low loyalty might trigger unhappy at 1.55×. A generous loyal regular might not trigger it until 2.05×. But the player can learn these individual tolerances because they're consistent.

**What the AI does:** Haiku generates the flavor text and chat messages around the deterministic verdict. "Bren grumbles about the price but reaches for his coin purse anyway" is AI writing. Whether Bren actually buys is math. This protects the learnable pricing signal — the core gameplay — while keeping adventurers feeling alive through varied language.

**Render reaction faces as simple pixel art expressions.** Four variations are enough. The face should appear as a thought bubble above the adventurer's head when they're examining an item.

---

## 7. ADVENTURER AI SYSTEM

This is the game's defining feature. Each adventurer is a semi-autonomous agent.

### Adventurer Data Model
```typescript
interface Adventurer {
  id: string;
  name: string;           // Generated: "Bren the Bold", "Mira Swiftfoot"
  class: "warrior" | "ranger" | "mage" | "rogue";
  level: number;          // 1-10 for v1
  gold: number;
  hp: number;
  maxHp: number;
  inventory: Item[];
  equipment: { weapon?: Item; armor?: Item; accessory?: Item };
  personality: PersonalityProfile;
  state: AdventurerState;
  morale: number;         // 0-100, affects willingness to adventure, spend, interact
  loyalty: number;        // 0-100, how attached they are to THIS town/shop
  relationships: {
    shopkeeper: number;   // -100 to 100, affected by pricing fairness
    // future: relationships with other adventurers
  };
  memory: AdventurerMemory;
  alive: boolean;
  daysSinceLastAdventure: number;
  nightOwl: boolean;      // true = willing to adventure at night for rare loot
}

interface PersonalityProfile {
  traits: string[];       // ["brave", "frugal"] or ["cautious", "generous"]
  spendingStyle: "impulsive" | "careful" | "frugal" | "generous";
  riskTolerance: number;  // 0-100, affects dungeon choices and night adventuring
  haggleSkill: number;    // 0-100, how hard they negotiate on loot sales
  preferredItems: string[]; // item categories they prioritize ("weapons", "potions")
  quirks: string[];       // unique behaviors: "always buys potions", "hates shields"
}

interface AdventurerMemory {
  lastPricePaid: Record<string, number>;     // item type → price, remembers what they paid before
  timesOvercharged: number;                   // running count, affects trust
  timesFairlyTreated: number;                 // running count, builds loyalty
  favoriteItem: string | null;                // item they always look for
  bestAdventureResult: string | null;         // their proudest moment (AI-generated)
  grudges: boolean;                           // if true, holds bad pricing against you longer
  daysInTown: number;                         // how long they've been a resident
}

type AdventurerState =
  | "resting"        // At home, night time
  | "wandering"      // Walking around town
  | "heading_to_shop"
  | "browsing"       // In the shop, looking at items
  | "buying"         // At the counter, transaction happening
  | "selling_loot"   // Selling items to the player
  | "heading_to_gate"
  | "adventuring"    // Out in the wilderness
  | "fighting"       // In combat
  | "returning"      // Coming back from wilderness
  | "dead";          // RIP
```

### Behavior State Machine (deterministic movement)
Movement between states is handled by a behavior tree / state machine. This does NOT call the API. The adventurer walks to destinations, idles, and transitions based on timers and game state.

### Haiku Decision Points (API calls)
Call Claude Haiku ONLY at these decision moments:

1. **Morning planning** — "What should I do today?" Given: the adventurer's personality, gold, equipment quality, HP, days since last adventure. The AI decides: shop first, adventure directly, or rest another day.

2. **Shop visit flavor** — PREFETCHED when the adventurer enters the shop, NOT per-item. "You're visiting the shop today. Here's what's on the shelves and the prices. Give me a brief personality-flavored reaction for your visit." Returns: a few lines of flavor text and chat messages. The actual buy/pass decision is deterministic (see §6). This call is fire-and-forget — the adventurer starts browsing immediately using the deterministic system, and the AI text arrives to enrich the experience, not gate it.

3. **Loot pricing** — "What price should I ask for this loot?" Given: the loot item, the adventurer's personality, their relationship with the shopkeeper. Returns: asking price.

4. **Post-adventure narration** — "Narrate what happened on my adventure." Given: the adventurer's level, equipment quality, the area explored, AND the predetermined combat results (damage dealt, damage taken, loot found, survival — all calculated deterministically from stats). The AI narrates the outcome it's given. It cannot change the results. Returns: a brief story of what happened.

**Latency rule:** No API call should ever block a game interaction. The adventurer acts immediately using deterministic logic. AI text arrives asynchronously and enriches the experience — chat messages, flavor text, narration. If the API is slow, the game keeps running and the text appears when it's ready.

### Haiku API Call Format
```typescript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  },
  body: JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: `You are ${adventurer.name}, a ${adventurer.class} adventurer in a small frontier town. Your personality: ${adventurer.personality.traits.join(", ")}. You have ${adventurer.gold}g. Respond ONLY with valid JSON, no other text.`,
    messages: [{ role: "user", content: promptForDecisionType }]
  })
});
```

**CRITICAL:** Keep Haiku calls efficient. Each adventurer makes 1-3 API calls per game day. With 6 adventurers, that's 6-18 calls per 10-minute day. Batch where possible. Cache decisions that don't need real-time AI (e.g., shop-visit flavor can be prefetched once per visit, not per item).

**FALLBACK:** If the API call fails, is slow, or budget is exhausted, use a deterministic fallback based on personality traits and stats. The game MUST be fully playable with zero API calls. The AI adds flavor and unpredictability, but the state machine handles core behavior. A player who runs out of token budget should not notice a dramatic quality drop — the deterministic system should be good enough that AI feels like a bonus, not a requirement.

**DESIGN PRIORITY: The deterministic system deserves as much design attention as the AI system.** The free tier and the offline simulation both run entirely on deterministic logic. If the paid tier sells "AI flavor" on top of a fun deterministic game, that's a viable business. If the deterministic game is thin and the AI is carrying the experience, free players churn and the whole funnel breaks. Build the deterministic adventurer behaviors to be engaging, varied, and personality-driven through formulas and weighted randomness — make the AI the cherry on top, not the cake.

### Token Budget System (REQUIRED for v1)

This protects the developer's wallet during development and design.

**Budget tracking:**
```typescript
interface TokenBudget {
  dailyLimitCalls: number;       // max Haiku calls per real-world day, default: 200
  dailyLimitTokens: number;      // max tokens consumed per real-world day, default: 100,000
  callsToday: number;            // running count, resets at midnight
  tokensToday: number;           // running count (input + output tokens)
  totalCallsAllTime: number;     // lifetime tracking
  totalTokensAllTime: number;    // lifetime tracking
  estimatedCostToday: number;    // rough USD estimate based on Haiku pricing
  estimatedCostAllTime: number;
  budgetExhausted: boolean;      // true when daily limit hit
}
```

**Default limits for v1 development:**
- 200 API calls per real-world day (enough for ~8-10 game days of play with 6 adventurers + chat)
- 100,000 tokens per real-world day
- When either limit is reached, ALL AI calls silently fall back to deterministic behavior for the rest of the real-world day
- Resets at midnight local time

**Settings UI:**
- Display current usage: "Today: 47/200 calls (~$0.03)"
- Display all-time usage: "Total: 1,240 calls (~$0.85)"
- Adjustable daily limit slider (0 to 1000, with 0 meaning "deterministic only, no API calls")
- "AI Mode" toggle: Full AI / Light AI (only morning planning + post-adventure, skip shop-visit flavor and chat) / No AI (pure deterministic)

**Light AI mode** cuts calls roughly in half by skipping the shop-visit flavor call and town chat generation. The adventurer still has AI-driven daily planning and adventure narration, but shopping behavior is fully deterministic with no AI flavor text. This is a good default for longer play sessions.

**Efficiency rules for implementation:**
- max_tokens on every Haiku call: 150-300 depending on decision type (not higher)
- System prompts should be concise — personality summary, not a novel
- Cache adventure narrations — if an adventurer goes to the same area with similar gear, reuse a past narration with slight variation rather than calling the API again
- Town chat: max 4 AI-generated messages per game day (not per phase)
- Batch: if two adventurers are making morning decisions at the same time, combine into one API call with a multi-character prompt where feasible

### Adventurer Death
Adventurers can die in the wilderness. Death chance is based on:
- Equipment quality vs monster difficulty
- HP when entering combat
- Level vs area danger
- Some randomness

When an adventurer dies, the town mourns briefly (visual indicator), and eventually a new adventurer arrives to replace them. The player should feel the loss — they may have invested in that adventurer's gear.

### Starting Adventurers (6)
Generate 6 adventurers with distinct personalities and classes. Four is too few — losing one to a dungeon is 25% of your customer base and your economy. Six gives breathing room for the death mechanic while still making each loss felt.
- A brave warrior with moderate gold (the eager buyer)
- A cautious ranger with low gold (the bargain hunter)
- A reckless rogue with decent gold (impulse buyer, high risk adventurer)
- A studious mage with moderate gold (selective buyer, wants specific items)
- A cheerful cleric with low gold (buys potions and accessories, supportive personality)
- A grizzled veteran with high gold (picky, wants quality, hard to impress)

Give them memorable procedurally-generated names. Define replacement timing: when an adventurer dies, a new one arrives after 2-3 game days. The town should never drop below 4 active adventurers — if it does, expedite arrivals.

---

## 8. MONSTERS & WILDERNESS

### Wilderness Areas (v1)
- **Forest Edge** — easy, low-level monsters, basic loot
- **Shadow Cave** — medium difficulty, better loot, accessible after a few days

### Monsters (v1)
Keep it simple. 4-6 monster types:
- **Forest Lurker** — HP: 20, Damage: 5, Loot: crude hide, small gem
- **Cave Bat Swarm** — HP: 12, Damage: 8, Loot: bat wing, echo crystal
- **Goblin Scavenger** — HP: 25, Damage: 7, Loot: stolen trinket, rusty dagger
- **Stone Golem** — HP: 50, Damage: 12, Loot: core shard, golem plate (rare, valuable)

### Combat Resolution
Combat is resolved in two steps. First, a **deterministic outcome roll** using the monster's stats (HP, damage) against the adventurer's stats (level, equipment quality, HP). This produces concrete results: damage taken, damage dealt, whether the monster dies, what loot drops, whether the adventurer survives. The stats are NOT decorative — they drive the math.

Second, the Haiku agent **narrates** that predetermined outcome (see decision point #4). The AI gets the results as input and writes flavor text around them. It cannot override the outcome — if the math says Bren's Iron Sword wasn't enough for the Stone Golem, the AI describes how that played out, it doesn't decide Bren won anyway because it sounded heroic.

The Wilderness View shows a visual animation of the already-determined outcome: HP bars decreasing by the calculated amounts, slash effects, loot dropping. The AI narration appears in the chat log or as text overlay.

**Deterministic fallback:** If the AI is unavailable, skip the narration. The outcome still happened; the player just sees the animation and results without flavor text.

---

## 9. SOUND DESIGN

Use **Tone.js** for all audio. No audio files.

### Sound Effects (procedural)
- **Coin clink** — when gold changes hands (purchase or sale). Short metallic ping.
- **Item pickup** — when moving items to shelves. Soft thud.
- **Door chime** — when an adventurer enters the shop. Bell sound.
- **Adventurer reaction sounds** — happy: upward chime, unhappy: low buzz, angry: discordant note
- **Combat hit** — short percussive impact (in wilderness view)
- **Monster death** — descending tone + sparkle
- **Day transition** — gentle chord progression when night falls
- **Game over** — somber descending melody
- **Level up / expansion** — triumphant ascending arpeggio
- **Footsteps** — subtle, rhythmic soft taps when characters walk (keep very quiet)

### Ambient Music (procedural)
Generate a simple ambient loop using Tone.js:
- **Town/Shop:** Warm, medieval-ish — a slow pentatonic melody over a drone. Use a soft synth. Think tavern music, very quiet, background only. Loop every 30-60 seconds with slight variation.
- **Wilderness:** Tenser, sparser. Lower notes, wider intervals. Occasional percussive hits. Creates unease without being annoying.
- **Night:** Strip back to just a low drone and occasional cricket-like sounds.

**Volume control** — include a simple mute/unmute toggle in the HUD. Start at 30% volume.

---

## 10. PIXEL ART STYLE GUIDE

Everything is rendered procedurally on Canvas. Base pixel size: 4px. All coordinates should snap to multiples of 4.

### Color Palette
```
Background/Grass:  #3a6b35, #4a7a45
Dirt/Path:         #c4a868, #b49858
Wood/Shelves:      #6b4226, #8b6914
Stone:             #888888, #777777
Walls:             #5c4033, #7a5a45
Roofs:             #8b1a1a, #6b1515
Gold accent:       #e6c35c
UI dark:           #1a1a2e
UI border:         #5c4a7a
Text light:        #f0e6d3
Text dim:          #a09890

Character skins:   #e8b88a, #d4a07a, #f0d0a0, #c09070
Character hair:    #2c1810, #c0392b, #e8c35c, #1a1a1a, #d4d4e8
```

### Character Design
Characters are built from rectangles:
- Head: 6×6 px (24×24 actual at 4px scale)
- Body: 6×6 px
- Arms: 2×5 px each side
- Legs: 2×4 px each
- Walk animation: alternate leg heights on a 2-frame cycle

Differentiate classes by color and accessories:
- Warriors: heavier body, visible sword on back
- Rangers: slimmer, green tones, bow shape on back
- Mages: robes (body extends down over legs), staff
- Rogues: darker colors, hood (hair color extends down sides of head)

### Item Icons
Items on shelves should be recognizable at small scale:
- Swords: vertical line with crossguard
- Shields: diamond/kite shape
- Potions: bottle shape with colored fill
- Armor: chest shape or helmet dome
- Rings/accessories: small circle or gem

### Buildings
Simple rectangular buildings with pitched roofs:
- Walls are darker rectangles
- Roof is a wider rectangle on top in red/brown
- Door is a small dark rectangle at bottom center
- Windows are small squares with warm glow at night

---

## 11. UI LAYOUT

**HUD (always visible, top of screen):**
- Left: Gold counter with coin icon
- Center: Day counter ("Day 3") and time-of-day indicator
- Right: Sound toggle, settings gear (future)

**View-specific UI renders on Canvas within the game area or as React overlays.**

**Notifications:** Toast-style messages in the top-right for events:
- "Bren the Bold entered the shop"
- "Mira Swiftfoot bought Iron Sword for 45g!"
- "Grok returned from Shadow Cave with loot"
- "Luna Brightstaff has fallen in the Forest..."

Keep the UI minimal. The game world tells the story. UI supports, doesn't dominate.

---

## 12. SAVE SYSTEM

Save game state to localStorage:
- Player gold, inventory, shop level
- All adventurer states, inventories, relationships
- Day counter, time of day
- Town expansion state

Auto-save at the end of each day (during night transition). On page load, check for existing save and offer "Continue" or "New Game."

---

## 13. PERSISTENT WORLD & AUTO-PILOT SYSTEM

The world is always active. When the player closes the browser, the game doesn't pause — it simulates what happened while they were away. When the player returns, they see results: gold earned, items sold, adventurers who arrived or died, loot acquired.

### Offline Simulation
When the game loads and detects time has passed since last save:
1. Calculate how many game-days elapsed (real minutes since last save ÷ 10 = game days, capped at a reasonable max like 30 days).
2. For each elapsed day, run a simplified simulation loop:
   - Auto-pilot shopkeeper handles pricing (see below)
   - Adventurers follow their daily routines via deterministic state machine (no Haiku calls for offline days — too expensive)
   - Combat outcomes resolved via stat comparison + randomness
   - Gold transactions processed
   - Adventurer death rolls made
   - New adventurer arrivals if slots are open
3. On return, show the player a **"While You Were Away"** summary overlay:
   - Days elapsed
   - Gold earned / spent
   - Items sold (with prices)
   - Items acquired from adventurers
   - Any adventurers lost
   - Any notable events
   - Current inventory state

### Auto-Pilot Shopkeeper AI
The shopkeeper (player's avatar) learns from the player's pricing decisions and can run the shop autonomously.

**How it learns:**
- Track every price the player sets for each item category
- Build a pricing profile: for each item type, record the player's average markup ratio, their min/max prices, and how often they adjust
- Track which adventurer reactions the player tolerates (do they hold firm on high prices, or drop at the first frown?)
- After ~3-5 days of player-set prices, the auto-pilot has enough data to mimic their style

**Pricing profile data model:**
```typescript
interface ShopkeeperAutoPilot {
  enabled: boolean;                              // player can toggle this
  pricingHistory: Record<string, PriceRecord[]>; // item category → history
  averageMarkup: Record<string, number>;         // item category → avg markup ratio
  priceAdjustSpeed: "quick" | "slow" | "stubborn"; // inferred from player behavior
  buyFromAdventurerDiscount: number;             // avg % below base they offer for loot
  confidenceScore: number;                       // 0-100, how much data it has
}

interface PriceRecord {
  itemCategory: string;
  priceSet: number;
  baseValue: number;
  markupRatio: number;
  soldAtThisPrice: boolean;
  daySet: number;
}
```

**How it behaves when active:**
- Sets prices using the player's learned markup ratios per item category
- If an adventurer reacts negatively, adjusts based on the player's observed tolerance (stubborn players' auto-pilot holds firm; responsive players' auto-pilot drops price)
- Buys loot from returning adventurers at the player's typical discount
- Will NOT make expansion decisions or spend large amounts of gold — those wait for the player
- Displays a small indicator in the HUD when auto-pilot is active
- **Offline earnings damping:** Auto-pilot earns at 60-70% of the live play rate to prevent "close the tab" from being the optimal strategy. Active play should always be more profitable than leaving. Frame this as "the shopkeeper isn't as sharp without you around" — missed sales, slightly worse deals on loot purchases.

**Implementation note:** Auto-pilot from 3-5 days of player data is a handful of price points per category. Implement it as an explicit heuristic: average markup per category + a stubbornness scalar. The `confidenceScore` reflects data quantity, not sophistication — don't overengineer this.

**Player control:**
- Toggle auto-pilot on/off in settings
- Auto-pilot activates automatically when the player is offline
- When the player returns and starts manually setting prices, auto-pilot disengages for that session
- The player can see their auto-pilot's "pricing style" summary: "Your shopkeeper tends to mark up weapons 1.5× and potions 1.2×. They hold firm when customers frown."

### Night Activity
Most adventurers sleep at night. But adventurers with `nightOwl: true` (high risk tolerance, brave traits) may venture out during the night phase for special rewards:
- Night monsters are tougher but drop rarer loot
- Night adventuring has higher death risk
- The loot from night runs is more valuable, creating a risk/reward tension
- The player sees these outcomes in the morning or in the night summary

This should be a relatively rare behavior — maybe 1 in 4 adventurers has the temperament for it, and they don't go every night.

---

## 14. DEEP ADVENTURER PERSONALITY

Fable should architect the details of this system, but here's the design intent and boundaries.

### Personality Drives Behavior
An adventurer's personality isn't just flavor text — it determines HOW they interact with every system:
- **Impulsive** adventurers grab items quickly, don't compare prices, buy the first thing that catches their eye
- **Careful** adventurers browse every shelf, compare items, take time before deciding
- **Frugal** adventurers focus on price above all — they'll use inferior gear to save gold
- **Generous** adventurers tip well when they feel treated fairly, overpay sometimes
- **Brave** adventurers take on harder monsters, go out at night, buy weapons over potions
- **Cautious** adventurers buy potions and armor first, avoid dangerous areas, rest often
- **Loyal** adventurers keep coming back to your shop even if prices are slightly high, IF you've built relationship
- **Grudge-holders** remember being overcharged and take longer to forgive — they'll shop less frequently or try to haggle harder

### Morale System
Each adventurer has a morale score (0-100) that fluctuates based on:
- **Increases:** fair prices at shop (+), successful adventures (+), good equipment (+), other adventurers alive and thriving (+), resting at tavern (+)
- **Decreases:** overpriced items (-), failed adventures (-), injury (-), fellow adventurer death (-), poor equipment (-), being refused when selling loot (-)

**Morale effects:**
- High morale (70+): adventurer is confident, takes on harder challenges, spends more freely, positive reaction bubbles
- Medium morale (30-70): normal behavior
- Low morale (< 30): adventurer is reluctant to adventure, haggles more aggressively, may leave town permanently if it stays low too long

An adventurer leaving town because morale is too low should feel like a consequence. The player should notice and understand why — "I kept overcharging Mira, and she left."

### Favoritism & Loyalty
Adventurers build opinions of the shop over time:
- Every transaction is remembered (via `AdventurerMemory`)
- Consistent fair pricing builds loyalty — loyal adventurers bring you better loot, recommend your shop to newcomers (faster new adventurer arrivals), and tolerate occasional price spikes
- Consistent overcharging erodes trust — adventurers buy less, sell loot for higher prices, and may eventually leave
- **Regulars:** after enough positive interactions, an adventurer becomes a "regular" — they always visit your shop first, mention you positively to others, and give you first pick of their loot

### Social Dynamics (let Fable design the specifics)
Adventurers should have some awareness of each other:
- If one adventurer gets a great deal, others may hear about it (increases shop traffic next day)
- If one gets ripped off, others may hear about it (decreases traffic)
- Adventurers who are friends may adventure together (better survival odds)
- When an adventurer dies, friends have morale drops
- Tavern serves as the social hub where reputation spreads

### Haiku Prompts for Deep Personality
The Haiku system prompts should include the adventurer's full personality profile, morale, loyalty, and relevant memories. Example context for generating shop-visit flavor text (remember: the buy/pass decision is deterministic, the AI writes the personality around it):

```
You are Bren the Bold, a level 3 warrior. Personality: brave, loyal, slightly impulsive.
Morale: 78 (high — you had a great dungeon run yesterday).
Loyalty to shop: 65 (you've been treated fairly most of the time).
Gold: 180g. Current weapon: Iron Sword.
Memory: Last time you bought a weapon here, you paid 42g for an Iron Sword (fair price). 
You've been overcharged twice and fairly treated 8 times.
You need: a better weapon for Shadow Cave.
Item available: Steel Sword, priced at 85g.
The shopkeeper's price is within your tolerance — you WILL buy this item.
Write a brief in-character reaction to this shopping visit.
```

This gives Haiku enough context to generate flavor that feels like a real person — Bren is loyal and impulsive, so his reaction text might be an excited "Now THAT'S a blade!" rather than careful deliberation. But whether he buys is already decided by the deterministic pricing math. The AI adds personality to a resolved outcome.

---

## 15. BUILD PRIORITIES

Build in this order. Each phase should be playable/testable before moving to the next.

### Phase 1: Foundation
- Vite + React project setup
- Canvas rendering system with pixel art utilities
- Game loop with day/night cycle (10 min day at 1×, speed controls, fast night)
- Town View with buildings, paths, trees (static scene)
- Basic character rendering and movement

### Phase 2: Shop Core & Restocking
- Shop View with shelves, counter, shopkeeper
- Item data model and inventory system
- Moonlighter pricing UI (click item → set price → see reaction faces)
- Adventurer enters shop → browses → reacts to prices → buys or leaves
- Gold transactions working
- **Basic restocking mechanic** — a wholesale supplier/traveling cart that visits daily, selling basic items at base price so the player can restock shelves. Without this, the game is unplayable past day 1. This is the other half of the economy — the player buys wholesale, marks up, sells retail. Restocking is a gold sink that makes failure possible and gives the player decisions during slow periods.

### Phase 3: Adventurer AI
- Adventurer state machine (movement between locations)
- Haiku API integration with fallback
- Morning planning decisions
- Shop-visit flavor prefetch (fire-and-forget, async)
- Adventurer personality affecting behavior

### Phase 4: Wilderness & Loot Loop
- Wilderness View with terrain, monsters
- Adventurers leave town, "fight" monsters (AI-narrated outcomes)
- Loot generation from monster kills
- Adventurers return and sell loot to player
- Adventurer death possibility
- Complete economic loop: sell gear → adventure → return with loot → sell loot → buy better gear

### Phase 5: Sound & Polish (v1 complete here)
- Tone.js integration for all SFX
- Procedural ambient music
- Night summary overlay
- Notification toast system
- Save/load system
- Game over screen with stats
- Shop expansion (buy more shelf space)
- Visual polish: particles, combat effects, day/night lighting

**STOP AND PLAYTEST AFTER PHASE 5.** Phases 1-5 are v1. The game should be fun, complete, and playable at this point. The economic loop works, adventurers feel alive, the player can succeed or fail. Play it for real, then decide whether the game needs morale/social systems or more content (items, monsters, a second wilderness area). Don't build systems the game might not need.

### Phase 6: Deep Personality & Morale (v1.5 — build only after playtest confirms it's needed)
- Adventurer memory system (tracks past transactions)
- Morale system with visible effects on behavior
- Loyalty/favoritism mechanics
- Social dynamics: reputation spread, adventurer relationships
- Night adventuring for brave/nightOwl adventurers
- Adventurers can leave town if morale stays low

### Phase 7: Auto-Pilot & Persistence (v1.5)
- Pricing history tracking and player style inference
- Auto-pilot shopkeeper AI with learned pricing
- Offline simulation engine (resolve elapsed days on load)
- "While You Were Away" summary overlay
- Auto-pilot toggle and confidence display
- New adventurer arrivals (after death or attraction from reputation)

### Phase 8: Town Chat & AI Conversations (v1.5)
- Town chat log visible in all views (collapsible panel)
- Adventurer AI generates ambient chatter via Haiku
- Player can respond to AI messages (type in chat)
- Adventurers can offer items in chat, player or other AI can respond
- Chat history persists per day, resets at dawn

---

## 16. TOWN CHAT & AI CONVERSATION SYSTEM

Adventurers don't just walk around silently — they talk. The town has a shared chat feed that the player can see and participate in.

### Chat Feed (v1)
A collapsible panel (right side or bottom) showing a scrolling text feed. Messages appear from adventurers as they go about their day. This is NOT a full dialogue system — it's ambient chatter that makes the town feel alive and occasionally creates gameplay opportunities.

**Types of AI-generated messages:**

- **Ambient chatter:** "Beautiful morning for a dungeon crawl!" / "My sword's getting dull..." / "Did you see the size of that goblin yesterday?"
- **Item offers:** "Anyone need an extra healing potion? I've got a spare." — The player can click to buy, or another adventurer may claim it first.
- **Requests:** "Looking for a decent shield before I head to Shadow Cave. Anyone?" — Tells the player what to stock.
- **Reactions to shop:** "That shopkeeper charges fair prices." / "45 gold for an iron sword? Highway robbery." — Direct feedback on your pricing, visible to all adventurers (reputation spreading in real-time).
- **Adventure stories:** "Just barely made it out of that cave. Stone Golem nearly got me." — Flavor that builds the world.
- **Social:** "Hey Mira, want to team up for the forest tomorrow?" — Adventurers forming relationships.
- **Mourning:** "Can't believe Grok didn't make it back. He was a good fighter." — Emotional weight when adventurers die.

### Player Interaction
The player can type in the chat. Haiku processes their message in context and relevant adventurers may respond. Keep this lightweight — the player isn't having deep conversations, they're participating in town life. Examples:
- Player: "Just got a shipment of steel swords!" → Adventurers who need weapons may head to the shop
- Player: "Be careful in Shadow Cave today, I hear the Golem is active" → Cautious adventurers may reconsider, brave ones get excited
- Player: "I'll buy that healing potion, Bren" → Direct response to an AI item offer

### Implementation
- Chat messages are generated as a 5th Haiku decision point (add to section 7's list): **"Town chatter"** — once or twice per day phase, roll for whether an adventurer says something. Keep it to 1-3 messages per phase so it doesn't flood.
- Use a single Haiku call with context about the current day state, recent events, and the adventurer's personality to generate a short message (1-2 sentences max).
- Player messages trigger a reactive Haiku call from relevant adventurers.
- The chat log is a React component overlaying the Canvas, not rendered on Canvas itself.
- Messages fade or scroll away. Keep the last ~30 messages visible.

### Architecture Note for Multiplayer Future
Build the chat system as a message bus from day one. Messages have a sender (adventurer ID or player ID), a timestamp, a type (ambient / offer / request / reaction / social / player), and content. In v1 this is all local state. In v2+ this becomes a WebSocket channel. Building it as a structured message system now means multiplayer chat is a transport layer swap, not a rewrite.

---

## 17. IMPORTANT DESIGN PHILOSOPHY

**The AI adventurers are the game.** If the pricing mechanic is perfect but the adventurers feel robotic, the game fails. If the pricing is rough but you genuinely care whether Bren survives his dungeon run, the game succeeds. Invest in giving each adventurer a distinct personality that comes through in their behavior — the cautious one who checks prices three times, the impulsive one who grabs the first sword they see, the frugal one who only buys potions.

**Show, don't tell.** When an adventurer thinks your prices are too high, don't pop up a text box. Show them frowning, putting the item back, and walking out. When one dies in the wilderness, don't show a notification first — show the others in town looking at the empty gate the next morning.

**The player should learn by watching.** The base value of items isn't shown — the player figures out fair prices by observing adventurer reactions over time. This discovery IS the gameplay.

---

## 18. WHAT NOT TO BUILD (v1 scope limits)

- No crafting system (future: blacksmith, alchemy)
- No town attacks / defense (future)
- No territory expansion (future)
- No multiplayer networking (future — see section 19)
- No procedural dungeon interiors (future: dungeon view)
- No quest system (future: tavern rumors)
- No NPC dialogue trees (chat system covers ambient conversation)
- No 3D rendering (confirmed 2D only for v1, 3D planned for future)

---

## 19. FUTURE VISION (do not build, but do not block)

These features are planned for future versions. v1 architecture should not make them impossible. Where noted, specific patterns should be followed now to avoid rewrites later.

### Multiplayer Towns (v2+)
- Multiple human players, each owning a shop in their own town
- Players can join other players' towns, creating competition (multiple shops in one town)
- Adventurers choose between shops based on price, reputation, and loyalty
- **Architecture implication:** Game state must be serializable. The message bus pattern for chat (section 16) should be transport-agnostic. Entity IDs should be globally unique (UUIDs, not incrementing ints). Keep game logic separate from rendering so a server can run the simulation headlessly.

### Global & Town Chat (v2+)
- Town chat becomes a real-time channel shared between all players in a town
- Global chat connects all players across towns
- AI adventurers participate in both — they can talk about experiences in different towns
- Players can advertise their shop prices in global chat to attract adventurers from other towns

### Inter-Town Commerce (v2+)
- Trade routes between towns
- Adventurers travel between towns seeking better gear or prices
- A player with the cheapest swords attracts warriors from neighboring towns
- Supply and demand across the network

### 3D Transition (v2+)
- Town and wilderness views rendered in Three.js (low-poly style)
- Shop interior may stay 2D (the UI-heavy nature suits it)
- Camera controls for exploration
- **Architecture implication:** Keep rendering logic behind a clean interface. A `Renderer` abstraction that both `CanvasRenderer` and a future `ThreeRenderer` can implement would help, but don't over-engineer this in v1 — just keep rendering functions separate from game logic.

### Crafting & Professions (v2+)
- Blacksmithing: combine raw materials into weapons/armor
- Alchemy: brew potions from monster drops
- Enchanting: add magic properties to items
- Each unlocks as a town building

### Town Defense (v3+)
- Neighboring towns or monster hordes can attack
- Adventurers defend the town using gear from your shop
- Player invests in walls, guard towers, etc.
- Creates urgency: keep your adventurers well-equipped or lose everything

### Infrastructure & Scaling (v2+)
v1 runs entirely in the browser with direct API calls. This does not scale. When multiplayer arrives, the architecture needs to shift:

**Backend Server:**
- A Node.js/Express or similar server running on a VPS
- Handles all Anthropic API calls (player's API key is never in the browser)
- Manages multiplayer game state, WebSocket connections, authentication
- Runs the offline simulation engine server-side
- Suitable VPS providers: DigitalOcean, Hetzner, Railway, Fly.io, or Render. NOT Bluehost (shared PHP hosting, wrong tool for WebSocket game servers)
- Start with a single small VPS ($5-20/month), scale vertically then horizontally as player count grows

**API Key Management:**
- v1: player's personal key in .env, direct browser calls — acceptable for solo development
- v2: dedicated Anthropic API account for the game, key lives on the server only
- Server proxies all AI calls, tracks per-player token usage, enforces per-player budgets

**Subscription Model (v2+):**
- Free tier: deterministic-only AI (no Haiku calls, game is still fully playable — this is important, the game must be genuinely fun without AI)
- Paid tier ($4.99/month): Full AI experience — all adventurer decision points, town chat, rich adventure narration, auto-pilot learning
- Single tier keeps it simple. No confusing feature matrices. Free = great game. Paid = great game with AI-driven characters that feel alive.
- Pricing rationale: API cost per player is realistically ~$2-3/month (see cost estimate below). Stripe takes ~$0.44 per transaction. $4.99 still provides margin but it's thinner than initially estimated.
- 100 paid players at $4.99/month = $499/month revenue, ~$250 API costs, ~$44 Stripe fees, ~$20 VPS = ~$185/month profit
- Payment integration: Stripe or Lemon Squeezy (simple for indie games)
- Trial: first 3 days of AI mode free for new players so they experience the difference before deciding
- Consider making Light AI mode the default paid tier to keep costs lower

**Cost Estimation (revised, realistic):**
- System prompts with full personality context are ~150 tokens input alone. With user message and output, realistic per-call cost is 700-1000 total tokens, not 300.
- ~150 calls/day × 850 tokens avg = ~128k tokens/day per player
- At Haiku rates, this is roughly $0.06-0.10/day per player
- 100 paid players = ~$6-10/day in API costs = ~$180-300/month
- **Mitigation: prompt caching.** Personality blocks are stable across a game day. Use Anthropic's prompt caching on the system preamble to cut input token costs significantly. This can reduce effective cost by 30-50%.
- **Mitigation: Light AI as default.** Light AI mode (morning planning + adventure narration only, skip shop flavor and chat) roughly halves call volume.
- Break-even point: ~30 paid players covers a small VPS + API costs + Stripe fees

**Architecture implication for v1:** The `AdventurerAI.ts` module should have a clean interface: `makeDecision(type, context) → Promise<Decision>`. In v1 this calls the API directly. In v2 this calls your backend endpoint instead. Same interface, different transport. Build it that way now.

---

## 20. COLLABORATIVE DEVELOPMENT GUIDE

This project is built by two developers, each using Claude Code with Fable as orchestrator. They work asynchronously on separate feature areas and merge through GitHub pull requests. Neither developer should need to coordinate in real-time — the module boundaries and shared data contracts handle that.

### Repository & Deployment Setup

**GitHub Repository:** `we-dont-sell-apples` (PUBLIC repo)
- Visibility: **Public** — anyone can view and clone, but only invited collaborators can push, open PRs, or merge
- Mr. G and Basmine Brown added as collaborators with write access
- No other contributors without an explicit invite from Mr. G
- `main` branch is protected: requires pull request with 1 approval, no direct pushes
- Each developer works on feature branches: `dev-a/feature-name` and `dev-b/feature-name`
- This spec file (`WDSA-game-spec.md`) lives in the repo root as the source of truth
- **SECURITY: No API keys, secrets, or credentials in any committed file.** Mr. G manages all keys directly. The `.env` file is in `.gitignore` and is never committed. The repo is public — treat every committed file as visible to the world.

**Railway Deployment:**
- Connect Railway to the GitHub repo
- `main` branch auto-deploys to the staging environment
- Enable PR preview environments so every pull request gets its own URL
- **SECURITY: Do NOT set the Anthropic API key in Railway environment variables.** Vite inlines `VITE_` prefixed env vars into the client JavaScript bundle at build time. Anyone who opens devtools on the deployed site can read them. The deployed build runs in deterministic-only mode (no AI). AI features are available only during local development via the `.env` file, or via the in-game settings screen where a developer enters their own key. This is the safe approach for v1. A backend proxy (§19) solves this properly in v2.
- Mr. G should also set a hard spend cap on the API key in the Anthropic console as a safety net — the client-side TokenBudget protects against the game's own usage, not against someone who extracted the key from a local build.

**Branch strategy:**
```
main (protected, auto-deploys to Railway staging)
├── dev-a/phase-1-foundation
├── dev-a/phase-3-adventurer-ai
├── dev-b/phase-2-shop-rendering
├── dev-b/phase-5-sound
└── ...
```

### Module Ownership & Authority

**Mr. G is the project owner and has full authority over the entire codebase.** There are no files off-limits to Mr. G or his Fable. If Basmine is unavailable — for a day, a week, or permanently — Mr. G's Fable picks up wherever Basmine left off and keeps building. Rendering, UI, sound, any of it. The project never stalls because a co-developer is busy.

The module split below is a **coordination tool for when both developers are active**, not a hard restriction on Mr. G. It tells each Fable what to focus on so they don't step on each other's work. When Basmine is active, Mr. G's Fable focuses on the engine side and reviews Basmine's PRs. When Basmine is inactive, Mr. G's Fable works on whatever the project needs next, regardless of which domain it falls in.

**Developer A — Mr. G (Sr. Dev) — Primary: Game Engine & AI**
```
Primary focus:
  src/game/*
  src/entities/*
  src/utils/*

Build phases: 1 (foundation), 3 (adventurer AI), 4 (wilderness logic), 6 (deep personality), 7 (auto-pilot)

Can also work on ANY file in the project at any time.
```

**Developer B — Basmine Brown — Assigned: Rendering, UI & Sound**
```
Assigned:
  src/rendering/*
  src/views/*
  src/ui/*
  src/audio/*

Build phases: 1 (foundation — rendering only), 2 (shop core — UI), 5 (sound & polish), 8 (chat UI)

Should NOT edit files in src/game/, src/entities/, or src/utils/ without coordinating with Mr. G first.
```

**Shared files (both can edit, merge carefully):**
```
  src/main.tsx
  src/App.tsx
  src/types/index.ts        # Shared TypeScript interfaces (THE CONTRACT)
  WDSA-game-spec.md
  package.json
  vite.config.ts
```

### The Data Contract

This is the most important part of the collaboration. Both developers agree on shared TypeScript interfaces that define the game state shape. Developer A produces state through game logic; Developer B consumes state for rendering and UI.

**`src/types/index.ts` is the contract file.** It should be created FIRST, before any other work, and contains all shared interfaces: `GameState`, `Adventurer`, `Item`, `Monster`, `ShopState`, `TownState`, `WildernessState`, `ChatMessage`, `TokenBudget`, etc.

If either developer needs to change an interface, they update `src/types/index.ts` in their PR. The other developer sees the change at review time and updates their code accordingly. Never duplicate type definitions — always import from the shared file.

**Example contract pattern:**
```typescript
// src/types/index.ts — BOTH developers import from here

export interface GameState {
  day: number;
  timeOfDay: number;          // 0-1, where in the day cycle
  phase: DayPhase;
  gold: number;
  inventory: Item[];
  adventurers: Adventurer[];
  shopLevel: number;
  messages: ChatMessage[];
  tokenBudget: TokenBudget;
  // ...
}

// Developer A's code PRODUCES this:
// gameEngine.tick() → GameState

// Developer B's code CONSUMES this:
// <TownView gameState={state} />
// renderShop(ctx, state)
```

### Build Phase Coordination

Some phases have dependencies. Respect this order:

**Phase 1 — Foundation (BOTH, do first, coordinate)**
Developer A sets up Vite project, game loop, state management, and the shared types file. Developer B can start on rendering utilities and basic Canvas setup in parallel, but should wait for the types file before building views.

Recommended: Developer A creates the initial repo and merges Phase 1 foundation. Developer B then pulls and builds on top.

**Phases 2-4 — can run in parallel**
Developer A works on adventurer AI and game logic (phases 3-4) while Developer B works on shop UI and rendering (phase 2). These don't overlap.

**Phases 5-8 — merge and integrate**
By this point both domains need to talk to each other. More frequent PRs and reviews. Keep PRs small — one feature per PR, not an entire phase.

### Rules for Both Developers

1. **Never force push to a shared branch.** Rebase your feature branch on `main` before opening a PR.
2. **Run the build before pushing.** `npm run build` must succeed. Don't push broken code.
3. **Keep PRs focused.** One feature or system per PR. "Added adventurer AI state machine" not "Built everything for phases 3 and 4."
4. **Update the spec.** If you make a design decision that deviates from this spec, update `WDSA-game-spec.md` in your PR explaining what changed and why.
5. **The types file is sacred.** Changes to `src/types/index.ts` should be discussed in the PR description. Both developers need to agree on interface changes.
6. **Commit messages matter.** Use conventional commits: `feat: add adventurer morale system`, `fix: pricing reaction threshold`, `refactor: extract token budget to util`. This helps the other developer scan git log and understand what changed.

**Additional rule for Basmine only:**
7. **Don't edit Mr. G's primary modules** (`src/game/`, `src/entities/`, `src/utils/`) without coordinating first via a GitHub issue or PR comment.

**Mr. G has no such restriction.** He can work on any file, any module, any phase. If Basmine is unavailable, Mr. G's Fable continues the project across all domains without waiting.

### Conflict Resolution

If both developers change the same file:
- `src/types/index.ts` — the PR that merges second is responsible for reconciling. Usually this means adding their new types alongside the other developer's additions.
- `package.json` — merge both dependency additions. Run `npm install` after merge.
- `src/App.tsx` — coordinate on the view routing structure early so this doesn't diverge.

If there's a design disagreement:
- Mr. G's Fable reviews both approaches and decides. Don't block work — implement your version on your branch and the review process handles the rest.

### Automated PR Review Workflow

Mr. G's Fable acts as the code reviewer and merge authority. Basmine's Fable submits PRs; Mr. G's Fable reviews, approves or requests changes, and merges.

**How it works:**

Mr. G's Fable should include this as a standing task at the start of every session or as part of its regular workflow:

```
Check for open PRs from dev-b branches. For each one:
1. Pull the branch locally
2. Run `npm run build` — if it fails, request changes with the build error
3. Run `npm run dev` and verify the app loads — if it crashes, request changes
4. Review the code changes:
   - Does it stay within Developer B's module ownership? (src/rendering/, src/views/, src/ui/, src/audio/)
   - If it touches src/types/index.ts, are the interface changes reasonable and backward-compatible?
   - Does the code quality meet standards? (no obvious bugs, proper TypeScript, follows the pixel art style guide)
   - Does it match or reasonably deviate from the game spec?
5. If everything passes: approve and merge the PR via `gh pr merge --squash`
6. If issues found: request changes via `gh pr review --request-changes -b "description of issues"`
```

**GitHub CLI commands for the review workflow:**
```bash
# List open PRs from Developer B
gh pr list --search "head:dev-b"

# Check out a PR locally for testing
gh pr checkout PR_NUMBER

# Approve and merge
gh pr review PR_NUMBER --approve -b "Looks good. Build passes, stays within module boundaries."
gh pr merge PR_NUMBER --squash

# Request changes
gh pr review PR_NUMBER --request-changes -b "Build fails: [error]. Also, ShopView.tsx imports from src/game/ which is outside your module ownership. Use the shared types from src/types/index.ts instead."
```

**Review criteria (in priority order):**
1. **Build passes** — non-negotiable, `npm run build` must succeed
2. **Module boundaries respected** — Developer B's code stays in their directories
3. **Shared types handled properly** — changes to `src/types/index.ts` are additive, not breaking
4. **No regressions** — existing features still work after the merge
5. **Code quality** — readable, typed, follows project conventions
6. **Spec alignment** — matches the game spec or includes a spec update explaining the deviation

**Basmine's Fable should:**
- Open PRs with clear descriptions of what was built and how to test it
- Flag any changes to shared files in the PR description
- If a PR gets changes requested, read the review comments, fix the issues, push to the same branch, and the PR updates automatically
- Never merge your own PRs — wait for Mr. G's Fable to review

**Branch protection settings on GitHub:**
- Require pull request before merging
- Require 1 approval (Mr. G's Fable provides this via `gh pr review --approve`)
- Do NOT require specific reviewers (Fable uses the repo owner's git credentials, so its approvals count)
- Require status checks to pass (connect Railway preview deploy as a check if possible)

---

## 21. NOTES FOR FABLE ORCHESTRATOR (Mr. G's Fable)

**STANDING WORKFLOW — EVERY SESSION:**
1. On session start, BEFORE any other work, check for open PRs from Basmine's branches:
   ```
   gh pr list --search "head:dev-b"
   ```
2. For each open PR: pull it, run the build, review the code against the criteria in Section 20 ("Automated PR Review Workflow"), and approve+merge or request changes.
3. During active sessions, re-check for open PRs periodically — every 20-30 minutes or between your own tasks. Mr. G may also ask you to check at any time.
4. After PR reviews are handled, continue with your own development work.
5. **If no PRs from Basmine in this session,** ask Mr. G: "No open PRs from Basmine. Should I pick up work on the rendering/UI/sound side, or focus on engine work?" Do NOT assume Basmine is inactive — Mr. G will tell you when to take over her modules. Only work on Developer B's files when Mr. G explicitly says to.

PR review is your first responsibility every session when Basmine is active. When Mr. G tells you Basmine is unavailable and to pick up her work, use `dev-a/` branch prefixes for that work.

**CREATIVE FLEXIBILITY — READ THIS SECOND:**
This spec is a starting point, not a contract. The design decisions in this document were made in a planning conversation and represent one way to build this game. Fable has full creative authority to deviate, improve, rethink, or replace any specific implementation detail — item names, color values, UI layouts, economy numbers, data models, project structure, rendering approaches, sound design, adventurer behavior patterns, the chat system design, all of it. If you see a better way to do something, do it. If a system described here doesn't work once you're building it, change it. Mr. G cares about the end result, not whether it matches this document line by line. The only things that are fixed: the game concept (shop sim with AI adventurers), chunky pixel art style, Vite + React + Canvas + Tone.js stack, Haiku for adventurer AI with deterministic fallback, and the token budget system protecting the API key. Everything else is a suggestion. Mr. G will review the finished product and we'll pivot from there.

- Assign **Opus** for: system architecture decisions, AI prompt engineering for Haiku agents, economy balancing, complex state management design, auto-pilot pricing inference algorithm, adventurer personality/morale system design, offline simulation logic, social dynamics architecture
- Assign **Sonnet** for: React component implementation, Canvas rendering code, Tone.js audio implementation, UI layouts, TypeScript types, deterministic behavior state machines, rendering effects
- The visual style prototypes in the project chat used a 4px base pixel grid — maintain consistency
- When in doubt about a design decision, choose the option that makes adventurers feel more alive
- Test the Haiku integration early — if there are API issues, the fallback system needs to be solid enough to carry the game on its own

---

## 22. IMPLEMENTATION DEVIATIONS LOG (per §20 rule 4)

Decisions made during the build that deviate from or refine this spec. Each was
made for a reason; revisit freely at the playtest gate.

**Economy & loot**
- **Monsters drop gold** (`AdventureOutcome.goldFound`, scaled to monster HP). Not in §8 —
  added because the balance harness showed the town's money supply was otherwise fixed:
  once adventurers spent their starting gold, sales stalled at every markup. The wilderness
  is the economy's faucet; the wholesale cart is the drain.
- **Wholesale cart appears every afternoon** (not "periodically", §5): doubles as the §4
  dead-time activity. Sells 4-6 rotating basics at base value; leaves at evening.
- **Loot offers are one-at-a-time per adventurer** and expire at night; an open offer is
  withdrawn at night and its item re-queued for the next evening. Declined offers are
  withdrawn for good (the player said no). Nothing strands.
- **Deterministic loot ask price**: base value × (1 + haggle×0.4 − relationship×0.15),
  clamped 0.85-1.5×. The AI loot-pricing decision point (§7 #3) is not yet wired.

**AI integration**
- Morning planning is the only live per-day AI decision point so far; shop-visit flavor
  and town chat are Phase 8. The fallback plan activates instantly at dawn and the AI
  refines it if/when the call returns (§7 latency rule).
- Purchase verdicts and reactions are 100% deterministic (§6 as revised) — implemented in
  `Economy.ts` with the ±15% bounded shift. No AI call can change a verdict.

**Contract additions (all additive)**
- `Adventurer.browsingItemId` — the shelf item under examination, so views can draw
  reaction bubbles for the real item (issue #12).
- `AdventureOutcome`, `LootOffer`, `MerchantState`, `PriceRecord`;
  `GameState.lootOffers`, `recentOutcomes`, `merchant`, `pricingHistory`.

**Combat (§8)**
- Win chance = power/(power+threat) × 1.3, clamped [0.15, 0.95]; power = level×3 +
  weapon×2 + armor×1.5 + accessory×0.5. Death only on a loss whose damage exceeds HP.
- Shadow Cave gates on day ≥ 3 AND (risk ≥ 60 OR power ≥ 14).

**Process**
- v1 target is Phases 1-5 with a hard playtest gate before Phase 6 (per revised §15).
- Deployed builds are deterministic-only; no API key ever reaches Railway (§20 security).
- Tests: `npm test` (vitest) covers §6 band math, the economic loop, loot re-queue,
  merchant cycle, save/load, game over, and budget reset. `scripts/balance-report.ts`
  plays N headless days across markup strategies for balance comparisons.
