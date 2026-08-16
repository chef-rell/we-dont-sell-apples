# We Don't Sell Apples 🍎

A browser shop simulation. You own the only shop in a small frontier town: price your stock, watch AI-driven adventurers react, sell them the gear they take into the wilderness, and buy back the loot they return with — if they return.

**Live:** https://web-production-b5454b.up.railway.app (auto-deploys `main`; runs in deterministic mode — no AI key)

## Status

Feature-complete v1 + v1.5 (all 8 phases of the spec) as of 2026-08-16, soak-tested. Next milestone: owner playtest → balance tuning. See `WDSA-game-spec.md` for the full design, including the §22 implementation-deviations log.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest — 44 tests
npm run build      # tsc + vite (must pass before any push)
npm run lint       # oxlint
npx tsx scripts/balance-report.ts 10   # headless economy report, N game days
```

**Optional AI mode:** put `VITE_ANTHROPIC_API_KEY=sk-ant-...` in `.env` (gitignored — NEVER commit or deploy a key), or enter a key in the in-game ⚙ Settings. The game is fully playable without one; Haiku adds morning-plan reasoning, adventure narration, and chat flavor. Client-side token budget caps usage at 200 calls / 100k tokens per real day.

Dev console: in `npm run dev` builds, `window.engine` exposes the live engine for driving time by hand (stripped from production).

## Architecture (the short version)

- **The contract:** `src/types/index.ts`. Game logic produces `GameState`; rendering/UI consume it. Never duplicate types.
- **The §6 invariant:** adventurer reactions and buy/pass verdicts are **deterministic** — markup bands ± a bounded ±15% personality/morale/loyalty shift, computed only in `src/game/Economy.ts`. The AI writes flavor text around verdicts; it can never decide one. Rendering only draws verdicts it is handed.
- **AI is never load-bearing:** every Haiku call (`src/entities/AdventurerAI.ts`) resolves `null` on any failure and a deterministic fallback is already acting. No API call blocks a game interaction.
- **Module ownership** (spec §20): Dev A (chef-rell) owns `src/game/`, `src/entities/`, `src/utils/`; Dev B (OverlookBoz) owns `src/rendering/`, `src/views/`, `src/ui/`, `src/audio/`. Shared: `src/types/index.ts`, `src/App.tsx`, config files.

```
src/
├── types/index.ts        # THE CONTRACT
├── game/                 # engine, economy, combat, morale, auto-pilot, offline sim, chat, save
├── entities/             # adventurer AI + behavior state machine, items, monsters
├── rendering/            # procedural pixel art (4px grid) — characters, buildings, items, monsters, particles
├── views/                # Town / Shop / Wilderness / GameOver
├── ui/                   # pricing, wholesale, loot offers, chat, settings, expansion, overlays
├── audio/                # Tone.js procedural SFX + ambient (dynamically imported)
└── utils/                # constants (ALL balance numbers), names, token budget
```

## Workflow

- Feature branches `dev-a/*` / `dev-b/*` → PR → review → squash-merge. `main` is protected.
- PR bar: `npm run build` and `npm test` pass; module boundaries respected; changes to the contract flagged in the description; no reverts from stale branch bases (rebase on current `main` before opening).
- Design changes get logged in spec §22 (spec §20 rule 4).
- Known cosmetic debt: 3 oxlint fast-refresh warnings from non-component exports in view files.

## Balance tuning

All numbers live in `src/utils/constants.ts`. Before/after any change, run `npx tsx scripts/balance-report.ts 10` — it plays 10 headless days at six markup strategies and prints gold/net-worth/sales/loyalty/morale. Watch for any single markup strictly dominating (that would mean the price-discovery game is shallow).

## v2 direction (do not build yet — spec §19)

Multiplayer towns, backend proxy for AI calls (key never in the browser), subscription model. The groundwork is already in: serializable `GameState`, UUID entity ids, transport-agnostic chat message bus, `makeDecision()` as the single AI seam.
