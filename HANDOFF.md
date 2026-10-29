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
  - An unsaved draft survives tab switches.
  - Leaving the Space with an unsaved draft asks first. In-app links show the shared `UnsavedChangesGuard` dialog, and refresh or close shows the browser warning. The guard lives in `SpaceLandingConversationShell`.
  - Text typed while a save is in flight is kept; see `onSaved` in `space-guide-draft.ts`.
  - The Guide is reread every time the tab opens.
  - Files: `space-guide-panel.tsx`, `space-guide-draft.ts`, `space-landing.tsx`.
- **Length.** We chose option A: a 100,000-character cap with no counter. An error appears only when a draft goes over the cap.
  - This raises the guide limit from 4,000. The Remote Agent turn envelope uses the same constant.
  - On rollout, deploy the Remote Agent, which accepts longer guides, before the producers that send them.
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
- **PRs.**
  - Guide: draft PR #330. All three of the reviewer's (mingyooagi) points are fixed. Merge `main` again before marking it ready.
  - Message-time hover tooltip: separate draft PR #331, on branch `message-time-tooltip`.
  - Neither PR has a Changelog entry yet.
- **Local dev gotcha.** Switching branches while the dev stack runs breaks the workers with "No matching export ... packages/schemas/dist". Run `pnpm dev:stop`, then restart.
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
