# We Don't Sell Apples 🍎

A browser shop simulation, told across three panels at once. You own the only shop in a small frontier town: price your stock, watch AI-driven adventurers react, sell them the gear they take into the wilderness, and buy back the loot they return with — if they return. A helper child grows alongside your shop; a rival store two doors down means bad prices cost you a customer, not just a sale; weather picks the day's shape; and the town keeps living in the corner of your eye — smoke over the chimneys, stars over your sign, and a graveyard that remembers who didn't make it back.

**Live:** https://web-production-b5454b.up.railway.app (auto-deploys `main`; runs in deterministic mode — no AI key)

## Status

v2.0 isometric pivot, tagged through Phase 4 (`v2.4-economy`); this build adds Phase 5 — weather, night raids, the graveyard, competitor stores, and an ambience/audio pass — completing the v2.0 release candidate (see `WDSA-v2-spec.md`, especially V2.12's phase table and V2.15's deviations log). v1 (all 8 phases, tagged `v1.5-playtest`) remains the rollback point if the pivot ever needs to back out.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest — 282 tests
npm run build      # tsc + vite (must pass before any push)
npm run lint       # oxlint
npx tsx scripts/balance-report.ts 10   # headless economy report, N game days
```

**Optional AI mode:** put `VITE_ANTHROPIC_API_KEY=sk-ant-...` in `.env` (gitignored — NEVER commit or deploy a key), or enter a key in the in-game ⚙ Settings. The game is fully playable without one; Haiku adds morning-plan reasoning, adventure narration, and chat flavor. Client-side token budget caps usage at 200 calls / 100k tokens per real day.

Dev console: in `npm run dev` builds, `window.engine` exposes the live engine for driving time by hand (stripped from production).

## What's here

- **The triptych.** One game loop, three synchronized panels: an isometric town (center), a day/weather/phase readout (right column), and a side-scrolling adventure strip (bottom) that plays back the day's run — and, after dark, last night's raid — like a screen you're watching, not a screen you're piloting. `src/App.tsx` owns the single tick loop; every panel is a read-only view over the same `GameState`.
- **Parties, not soloists.** Everyone whose plan is "adventure" marches out together as one `AdventureScript` — a whole trip's worth of march/encounter/loot/death events, generated once and replayed identically by the strip, the same way a server could generate and every client replay it (the multiplayer prerequisite this pivot was built to satisfy without multiplayer yet existing).
- **The helper.** Your second character, chosen at creation, grows on a shop/adventure/craft track and can eventually staff any building — hired specialist townsfolk are the escape hatch for whichever tracks the helper didn't take, always one step behind (later, worse, pricier) so the helper stays worth having.
- **Rarity, enchantments, and a real craft economy.** Loot rolls rarity and enchantments that live entirely in `baseValue` — the deterministic verdict math never learns rarity exists. Forge, garden, and alchemy lab buildings turn monster materials and grown ingredients into gear and repairs; the forge's ceiling stops at uncommon on purpose, so a trip to the cave is still worth more than a trip to the workbench.
- **Competitors and weather.** Two rival stores exist for the moment your prices are bad enough that an adventurer walks — visibly — somewhere else instead. Weather (rolled once at each dawn) picks shop days from adventure days, tints the whole scene to match, and never lets a storm run two days straight.
- **A town that keeps breathing.** Chimney smoke, flickering tavern windows, night owls gathering at the tavern door before they slip out, a functional graveyard that fills in as the town loses people, reputation stars over your own sign — none of it is simulated, all of it reads `GameState`.

## Architecture (the short version)

- **The contract:** `src/types/index.ts`. Game logic produces `GameState`; rendering/UI consume it. Never duplicate types.
- **The §6 invariant:** adventurer reactions and buy/pass verdicts are **deterministic** — markup bands ± a bounded ±15% personality/morale/loyalty shift, computed only in `src/game/Economy.ts`. Extended by the v2 spec (V2.2) to combat and every other outcome the strip plays back: nothing a renderer draws was ever decided by the renderer. The AI writes flavor text around verdicts; it can never decide one.
- **AI is never load-bearing:** every Haiku call (`src/entities/AdventurerAI.ts`) resolves `null` on any failure and a deterministic fallback is already acting. No API call blocks a game interaction.
- **Module ownership** (v1 spec §20, adapted for v2 in `WDSA-v2-spec.md` V2.13): Dev A (chef-rell) owns `src/game/`, `src/entities/`, `src/utils/`; Dev B (OverlookBoz) owns `src/rendering/`, `src/views/`, `src/ui/`, `src/audio/`, on an availability basis — Dev A carries owner-sanctioned work in Dev B's domains when needed, flagged in the PR. Shared: `src/types/index.ts`, `src/App.tsx`, config files.

```
src/
├── types/index.ts        # THE CONTRACT
├── game/                 # engine, economy, combat/AdventureScript, weather, competitors, property/craft, morale, save
├── entities/             # adventurer AI + behavior state machine, helper, items, monsters
├── rendering/            # procedural pixel art (4px grid) — iso projection, characters, buildings, the adventure strip, particles, weather FX
├── views/                # Town (iso) / Shop / GameOver / adventure-strip panel
├── ui/                   # time column, pricing, wholesale, loot offers, chat, settings, helper, staff, forge, build panels
├── audio/                # Tone.js procedural SFX + ambient beds (dynamically imported)
└── utils/                # constants (ALL balance numbers), the town building registry, names, token budget
```

## Workflow

- Feature branches `dev-a/*` / `dev-b/*` → PR → review → squash-merge. `main` is protected.
- PR bar: `npm run build` and `npm test` pass; module boundaries respected; changes to the contract flagged in the description; no reverts from stale branch bases (rebase on current `main` before opening).
- Design changes get logged in `WDSA-game-spec.md` §22 (v1 systems) or `WDSA-v2-spec.md` V2.15 (v2 pivot), per each spec's own §20/V2.15 practice.
- Known cosmetic debt: 3 oxlint fast-refresh warnings from non-component exports in view files.

## Balance tuning

All numbers live in `src/utils/constants.ts`. Before/after any change, run `npx tsx scripts/balance-report.ts 10` — it plays 10 headless days at six markup strategies and prints gold/net-worth/sales/loyalty/morale. Watch for any single markup strictly dominating (that would mean the price-discovery game is shallow).

## Multiplayer posture (do not build yet — v1 spec §19, unchanged by v2 spec V2.14)

Multiplayer towns, backend proxy for AI calls (key never in the browser), subscription model. The groundwork is already in: serializable `GameState`, UUID entity ids, transport-agnostic chat message bus, `makeDecision()` as the single AI seam, and — new in v2 — seeded, serializable `AdventureScript`s a server could generate and every client replay identically.
