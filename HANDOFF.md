# Handoff

Updated 2026-10-29.

## Working on

Branch `space-guide-tab`: the Space Guide tab.

Requirements, from the OpenMeld Space chat:

1. A Guide tab next to Messages / Tasks / Files, visible to members and Agents.
2. No visible length limit.
3. Owners edit and save it in the page.
4. The Center Agent reads and follows the Guide when it wakes.

## Done

- **Web.** The Guide tab sits after Files on normal Spaces.
  - Owners get "Write a guide" or Edit, with Save and Cancel.
  - Everyone else gets a read-only view.
  - An unsaved draft survives tab switches, and the browser warns before you leave with an unsaved draft.
  - The Guide is reread every time the tab opens.
  - Files: `space-guide-panel.tsx`, `space-guide-draft.ts`, `space-landing.tsx`.
- **Length.** We chose option A: keep the 100,000-character server cap and show no counter. An error appears only when a draft goes over the cap.
- **Agent prompt.** The Guide heading now tells Agents to follow it, with OpenMeld rules and safety taking precedence.
  - The heading lives in `SPACE_GUIDE_PROMPT_HEADING` in `packages/space-mesh/src/entry-brief.ts`.
  - Both Remote/Center Agents (`submission.ts`) and local CLI agents use it.
- **Center Agent DMs.** The Guide tab is hidden there, via `toCenterAgentSpaceView` in `space-view.ts`.
- **Tests.** Web, space-mesh, remote-agent, CLI and core guide tests pass, and web typecheck passes.
- **Manual check.** Checked on the local web app: the tab shows and the empty state works.

## Not done / next

- **Phone width.** The alignment check at phone width wasn't done, because the Chrome window would not resize.
- **Center Agent end to end.** Not tested locally, because the Remote Agent's AI binding needs Cloudflare. Check on staging or prod after merge: write a Guide, wake the Center Agent, and confirm it follows the Guide.
- **New-Space screen.** The temporary "just created" screen (`space-creation-conversation.tsx`) has no Guide tab. The normal Space page does. Decide whether to add it.
- **PR.** Open a PR. Before marking it ready, merge current `main`: it is 25 commits ahead.
- **Old test failures.** These fail on `main` too, so they weren't caused by this branch:
  - 3 in `space-conversation-panel.test.tsx`
  - 11 in `src/components/organizations`

## Local setup notes (this Mac)

- **Doppler.** Logged in to the Amplift workplace. `pnpm dev:doctor` passes.
- **Cloudflare.** `wrangler login` failed with "error fetching accounts", which likely means this Cloudflare user isn't in the OpenMeld account.
  - Workaround: add `"--local"` to `commonArgs` and to the remote-agent args in `scripts/dev/run-isolated-worker-dev.mjs`.
  - That change is local only. Never commit it.
- **Starting the app.** `pnpm dev:postgresql` did not start Web on its own, so also run `pnpm dev:web:worktree`. The app is at http://wt-9b955600b67a.localhost:29200.
- **Signing in.** Google sign-in is blocked on localhost. Use "Login with Magic Link", then read the token from `openmeld.verifications` in local Postgres. Open `/magic-link?token=<identifier>`.
- **pnpm.** Not installed globally, so use `corepack pnpm`.
