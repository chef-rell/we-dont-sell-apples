# CLAUDE.md — agent guide for We Don't Sell Apples

Read `README.md` first for architecture; `WDSA-game-spec.md` is the design source of truth (§22 = deviations log — update it when you change a design decision).

## Commands

- `npm run build` — tsc + vite; MUST pass before any push
- `npm test` — vitest, currently 44 tests; MUST pass before any push
- `npm run lint` — oxlint (3 known fast-refresh warnings in view files are accepted debt)
- `npx tsx scripts/balance-report.ts [days]` — headless economy comparison across markup strategies; run before/after balance changes

## Hard rules

1. **The §6 invariant is inviolable.** Reactions/verdicts are deterministic, computed only in `src/game/Economy.ts`. AI writes flavor around a stated-final outcome; rendering draws verdicts it is handed. Never let an AI response, a view, or a new feature decide or alter a verdict.
2. **AI is never load-bearing.** Any new Haiku decision point goes through `makeDecision()` in `src/entities/AdventurerAI.ts`, returns `null` on every failure path, and must have a deterministic fallback already acting before the call returns. No API call ever blocks an interaction.
3. **No secrets anywhere public.** The repo is public; Railway deploys are deterministic-only — never set an API key in Railway env vars (Vite inlines `VITE_*` into the client bundle). Keys live in local `.env` (gitignored) or the player's localStorage via `setApiKeyOverride()`.
4. **The contract is sacred.** All shared types in `src/types/index.ts`; changes must be additive where possible and flagged in the PR description. Loading old saves: add `??=` defaults in `GameStatePersistence.loadGame()` for every new field.
5. **Module ownership (spec §20).** Dev A: `src/game/`, `src/entities/`, `src/utils/`. Dev B: `src/rendering/`, `src/views/`, `src/ui/`, `src/audio/`. Don't edit the other domain — file an issue.

## PR review workflow (Dev A / Mr. G's agent)

On session start and periodically: `gh pr list --search "head:dev-b"`. For each PR:
1. `gh pr checkout N -f`, then `npm run build` and `npm test`
2. Check the branch base: `git log main..HEAD --oneline | wc -l` should be small; a stale base can silently revert merged work (this happened once — PR #13 reverted #11)
3. Check boundaries, contract changes, §6 compliance
4. `gh pr review N --approve -b "..."` then `gh pr merge N --squash --admin --delete-branch` (admin flag needed — owner self-approval doesn't satisfy branch protection), or `--request-changes` with specifics
5. Back on main: pull, build, test

## Gotchas learned the hard way

- **Capped buffers:** `state.messages` (100) and `state.recentOutcomes` (12) are trimmed; never compare `.length` across ticks to detect new entries — track the newest item's id.
- **Determinism vs liveliness:** idle/ambience behavior should use `Math.random()`; only §6 verdicts and combat math need determinism. A fully deterministic idle loop once froze every adventurer after one walk.
- **Gold faucet:** monsters drop gold. Without it the town's money supply is fixed and all sales stall — don't remove it while tuning.
- **Headless sims:** stub `localStorage` (see any `*.test.ts`), set `aiMode = "off"`, tick in 100ms steps (6000/day at 1×). Verify *visible* behavior (distance walked) not just transactions.
- **Sound:** Tone.js is dynamically imported (own chunk); audio must stay optional and gesture-gated.
- **Testing multi-day behavior in the browser:** background tabs suspend rAF; use the dev-only `window.engine` handle.

## Deployment

Railway auto-deploys `main` (project `we-dont-sell-apples`, service `web`, Node 22 pinned via `.nvmrc`/engines). Verify after merge: `railway status`, then curl the URL in README. Build failures so far have only ever been Node-version drift.
