# CLAUDE.md — agent guide for We Don't Sell Apples

Read `README.md` first for architecture. `WDSA-game-spec.md` is the design source of truth for v1 systems; `WDSA-v2-spec.md` governs the v2 pivot (scope, architecture, phase plan). Deviations logs: v1 spec §22, v2 spec V2.15 — update the relevant one when you change a design decision.

## Session start checklist (both devs — do this FIRST)

1. `git pull origin main` — always start on the latest code. Stale bases cause silent reverts (PR #13 incident).
2. `npm run build && npm test` — confirm main is green before starting new work.
3. `gh issue list --assignee <your-github-username> --state open` — check for assigned issues and prioritise them.
4. Start the issue monitor or scheduled agent (see "Issue monitoring" section below).
5. Dev A: also run `gh pr list --search "head:dev-b"` to check for PRs needing review.

## Commands

- `npm run build` — tsc + vite; MUST pass before any push
- `npm test` — vitest, currently 91 tests; MUST pass before any push
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

## Agent workflow

Use agents freely — announce what you're spinning up before launching. For coding tasks, use Opus as the orchestrator (planning, design, review) and delegate implementation to Sonnet agents (`model: "sonnet"`) to save tokens. Only use Opus-tier agents when the subtask needs deep reasoning.

## Issue monitoring (both devs)

Each dev's Claude agent should set up automated issue monitoring on session start. This keeps work flowing without waiting for someone to manually check GitHub.

**Setup:** Ask your Claude to run `/schedule` and create a recurring agent that:
1. Runs every 30 minutes during work hours
2. Checks `gh issue list --assignee <your-github-username> --state open --json number,title,labels`
3. Sends a PushNotification when new issues appear
4. Optionally begins planning/implementation on new issues in your domain

**Dev A (Mr. G / chef-rell):** monitors issues in `src/game/`, `src/entities/`, `src/utils/`
**Dev B (Basmine / OverlookBoz):** monitors issues in `src/rendering/`, `src/views/`, `src/ui/`, `src/audio/`

Alternatively, start a persistent Monitor in any session:
```bash
# Poll for new issues assigned to you
last=""; while true; do
  cur=$(gh issue list --assignee <you> --state open --json number,title 2>/dev/null)
  [ "$cur" != "$last" ] && [ -n "$last" ] && echo "$cur"
  last="$cur"; sleep 120
done
```

## Deployment

Railway auto-deploys `main` (project `we-dont-sell-apples`, service `web`, Node 22 pinned via `.nvmrc`/engines). Verify after merge: `railway status`, then curl the URL in README. Build failures so far have only ever been Node-version drift.
