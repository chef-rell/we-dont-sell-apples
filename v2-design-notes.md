# WDSA v2 Design Notes

> **Status:** vision capture. Build decisions were distilled into
> **`WDSA-v2-spec.md`** (2026-08-16) — where the two differ, the spec wins.

Tagged `v1.5-playtest` as the safe rollback point before this work begins.

## Core pivot: Isometric 3D + Triptych Layout

Three synchronized panels telling one story:

### Center — Iso Town (main gameplay surface)
- Isometric town view: player shop (gold roof), tavern, 2+ NPC competitor stores, town square with fountain, wilderness gate
- Clickable buildings — click shop to zoom into interior iso view for shelf management
- Click tavern to eavesdrop on adventurer chatter about prices/gear
- 10+ NPCs moving naturally between locations based on time phase
- Visual queue outside shop (max 3 inside, others wait/wander/visit competitors)
- NPCs carry visible gear — you see the sword you sold on their hip
- Smoke from chimneys, flickering tavern windows at night
- Reputation indicator on shop sign (stars/crowd)
- Graveyard that grows with dead adventurers — new NPCs visit it nervously

### Right Strip — Time Column
- Vertical sky gradient: dawn (top) to night (bottom)
- Sun/moon marker tracking current time
- Phase labels light up gold when active
- Event markers: sword icon at shopping time, boot at march, skull at boss
- Weather layer (rain/fog/snow) — affects adventure difficulty, creates "shop days" vs "adventure days"

### Bottom Strip — Adventure Scroll (side-scroller)
- Isolated section, own rendering system
- Party marches left→right through terrain: meadow → forest → cave (escalates with day count)
- Encounters: goblins (day 1-10), wolves, orcs, bosses at the far right
- Visible combat: HP bars, slash effects, death markers
- Gear drops with player's shop name AND price shown ("Iron Sword — 45g")
- Loot/gold arcs upward toward town panel when monsters die (visible faucet)
- Party composition matters — diverse gear = combo bonuses
- Return march: slower, limping, carrying injured — emotional beat
- Retreat if gear is bad, dropping broken gear along the way

## Day Loop

1. **Dawn–Morning (Shopping Phase)**
   - Adventurers wake, head to shops to gear up
   - Full shopping sequence: browse multiple items, walk to shelves, consider, react, bulk checkout
   - Max 3 in player shop at a time; others visit tavern, NPC stores, wander
   - Speech bubbles for price reactions (throttled, not spammy)
   - NPC stores perform poorly by default — adventurers prefer player shop unless pricing is bad
   - If player prices are bad, NPCs voice opinions and leave for NPC stores
   - Market data window showing demand/sentiment

2. **Noon (March Phase)**
   - Adventurers gather at the gate, form party/raid
   - Player can see who's going and what they bought
   - March out of town into the adventure strip

3. **Afternoon (Adventure Phase)**
   - Side-scroll combat plays out in real-time
   - Escalating encounters left→right, boss at the end
   - Gear degrades/breaks during combat
   - Injured NPCs retreat, dropping gear visibly
   - Some may perish (low rate early, increases with harder content)

4. **Dusk (Return Phase)**
   - Survivors march back left — slow, limping animations
   - Injured head to clinic
   - Successful ones hit the tavern

5. **Evening/Night (Recovery + Optional Night Raid)**
   - Tavern scene: adventurers drink, debrief
   - Post-adventure speech bubbles reference YOUR gear: "That sword held up!" / "Cheap armor nearly killed me"
   - Bold/drunk adventurers consider night raid — harder enemies, better loot, higher death risk
   - Night raiders form a smaller, riskier party

6. **Repeat**
   - Broken/lost gear means shopping every morning
   - Durability system drives recurring revenue
   - Day count escalates difficulty and loot quality

## Character Creation & The Helper

### The Shopkeeper (the player)
- Immortal — no one in town knows. Narrative hook that can pay off later (NPC figures it out at day 100? Questline?)
- Never ages, never adventures personally. Has run this shop "forever."
- Simple character creation at game start: skin color, hair color, male/female

### The Helper (your son/daughter — the player's avatar in the world)
- Created at game start alongside the shopkeeper
- Inherits appearance from character creation
- Visually distinct in both town and adventure panels (always spottable)
- One personality trait at creation affects aptitude:
  - **Curious** — craft track bonus
  - **Brave** — adventure track bonus
  - **Charming** — shop track bonus

### Helper Progression (ONE specialization after day 10)

**Days 1–10: General helper**
- Sweeping/cleanup (NPCs leave junk around)
- Basic chores — the tutorial phase
- Player decides where to invest them after day 10

**Shop Track:**
- Sweeping → manning register → pricing recommendations (from town chatter) → managing shop solo
- End state: helper runs the shop, freeing player to focus on expansion/strategy
- Speeds up queue throughput (moves outside line faster = more sales)

**Adventure Track:**
- Tag-along (observing, hangs at back of party) → fighter (contributes to combat) → scout (finds better loot routes) → raid leader (party performs better overall)
- Always survives even if NPC party fully wipes — drags loot back alone (powerful visual moment in the adventure strip)
- Gains XP per adventure, levels up combat stats
- As they level: visually moves from back of party to the front

**Craft Track:**
- Gardening (grow potion ingredients) → alchemy (brew potions to sell) → blacksmithing (repair gear, eventually forge new items)
- Each craft skill unlocks the ability to BUILD a corresponding structure on your plot

### Helper in the Adventure Strip
- Uses character creation colors — always visible
- Low level: hangs behind the party
- High level: at the front, dealing real damage
- Party wipe: solo return animation dragging a sack of loot through the strip
- Adventurers notice: "Your kid's getting strong!" / "Maybe keep them in the shop today..."
- Good performance = reputation boost (you have skin in the game)
- Near-death = some adventurers feel guilty → loyalty boost

### Helper Daily Assignment
- One job per day — the core tension
- Player assigns each morning: shop duty, adventure, craft task
- Can't do everything at once — different playthroughs feel different

## Property & Expansion System

### Player Plot
- Your shop sits on a plot that can expand outward
- Expansion doesn't impede NPC plots or other player plots (multiplayer-safe)
- New buildings constructed on YOUR plot, adjacent to shop:

**Garden** (unlocked by craft track: gardening)
- Visible growing area next to shop
- Produces potion ingredients over time
- Helper or hired NPC tends it

**Alchemy Lab** (unlocked by craft track: alchemy)
- Small building on your plot
- Brews potions from garden ingredients
- Potions sold in your shop — new product line

**Forge** (unlocked by craft track: blacksmithing)
- Visible smithy on your plot
- Repairs gear (limited times via existing timesRepaired field)
- Eventually crafts new gear from loot materials
- Replaces the need for a town blacksmith NPC

### Hired NPCs (staff system)
- After helper learns a skill to a certain level, you can HIRE a permanent NPC for that role
- Hired NPCs are weaker at the job than your leveled helper but free them up
- Creates staff management: shopkeeper (you, immortal) → helper (your character) → hired hands
- Payroll = new gold sink — wages paid from shop profits
- Hired NPCs are NOT adventurers — they're townsfolk (different pool)

## Economy Balance: Forge vs Loot

### The principle: forge fills the floor, loot fills the showcase

**Loot has a ceiling blacksmithing can't reach:**
- Loot drops with random **enchantments** (fire damage, life steal, damage resistance) — the forge works with metal, not magic
- Loot rarity tiers: common → uncommon → rare → legendary
- Forge maxes out at **uncommon** quality. Rare+ only drops from adventures.
- A day-10 forge sword matches a day-5 loot sword in raw stats, but the loot sword has "+8 fire damage" that no forge replicates

**Two-tier shop economy:**
- Forged items = reliable bread-and-butter stock. Consistent quality, always available, decent margins. Keeps adventurers geared for daily runs.
- Loot items = premium showcase. Rare, unpredictable, high-margin. Adventurers save up for these. A legendary drop sells for 10x a forged item.

**Durability keeps both relevant:**
- Forged gear has HIGHER durability (well-made vs found-in-a-cave) — adventurers buy forged for routine runs
- Loot gear breaks faster but hits harder (enchantments) — brought out for boss fights, deep caves, night raids
- Both get bought, neither makes the other obsolete

**Adventure stays essential because:**
1. **Gold faucet** — monsters are the primary source of new gold entering town
2. **Crafting materials** — forge needs monster drops (golem plates, core shards, bat wings) as raw materials. No adventuring = no crafting supplies
3. **Rare loot = highest profit margins** — best sales days come from stocking rare drops
4. **Day escalation** — harder monsters drop materials for better forge recipes. Day-30 forge gear requires day-30 monster parts
5. **Forge recipes unlock through adventure** — deeper zones discovered = new recipes available

### Item Rarity Visual System
- **Common** — no border, no effect (baseline gear)
- **Uncommon** — green border glow (forge ceiling, frequent loot drop)
- **Rare** — blue border glow + subtle sparkle particles
- **Legendary** — purple/gold border glow + persistent sparkle effect + item name in gold text
- Rarity visible everywhere: on shelves, in adventurer hands, dropped in adventure strip, in shop UI
- Enchantment icons shown as small symbols on the item sprite (flame, skull, shield, heart)

## NPC Competition System
- Other NPC-run stores visible on town map
- Perform poorly by default (bad pricing, limited stock)
- Adventurers compare prices before choosing where to shop
- If player is overpriced, NPCs shift to competitors and vocalize it
- Sets up future multiplayer: real players replace NPC stores

## Town & Server Architecture

### Town growth
- Towns grow physically with a max cap on buildings/plots
- Growth is organic — player chooses expansion direction from their plot
- Town has fixed infrastructure: tavern, clinic, square, gate, graveyard
- Player-buildable: shop expansions, garden, alchemy lab, forge

### Multiplayer (future phases)
- Different town/servers for players to join
- Real players replace NPC stores — competitive pricing between humans
- Each player's plot expands independently without impeding others
- Shared town economy: same adventurer NPCs visit all player shops
- Backend proxy (spec §19) enables this

### Hiring System
- Staff paid as **percentage of sales** (not flat wage)
- Creates natural scaling — busy shops pay more but earn more
- Hired NPCs are NOT adventurers — they're townsfolk (different pool)

## Prototypes
- Shop interior iso demo: artifact eb51892a
- Town iso demo: artifact 8764e4c8
- Full triptych demo: artifact d3d5517e
