# 1e Permission-mode advisor external review

Package: Phase 1 · 1e of `design-plans/member-agent-program.md` (§4.8).
Reviewer: Codex CLI (`gpt-6-astra`, reasoning high),
`codex exec --sandbox read-only`, 2026-10-18.
Question: find, with file:line evidence, (1) a path where a task whose
requester is not the Agent Profile owner receives the advisory block, opens
the suggestion card, or applies or changes a permission mode; (2) a counter
input that double-counts one interaction or counts the owner's own
approvals; (3) a suggestion more permissive than the harness's next step, or
ever Bypass permissions or Full access; (4) anything contradicting red line 8;
(5) SQL correctness (claim race, cooldown, card state) and contract
compatibility with older CLI and Service versions under strict schemas.
Each finding was checked against the code before acting.

## Findings

| # | Finding | Verdict | Disposition |
| --- | --- | --- | --- |
| 1 | A colleague's task on the owner's Computer can run the real `openmeld profile update … --agent-controller-permission-mode` with the owner's CLI login; the existing write checks the signed-in account, not the task requester | Verified, pre-existing | Not changed in 1e. This is the §4.7 risk window that Phase 5 (5a0–5c) closes. The advisor adds no new write path: the task never writes settings, and the card's Apply runs in the owner's Web session |
| 2 | A pending card stayed actionable after the owner changed the mode elsewhere, so Apply could skip the next step (card `acceptEdits → auto` applied from `default`) | Verified | Fixed: the card list keeps only cards whose recorded starting mode is still the Binding's effective mode (`listCurrentPermissionModeSuggestions`); integration test added |
| 3 | Center Agent confirmation for a permission-mode change is prompt guidance only; Core accepts the runtime-settings write without confirmation evidence | Verified, pre-existing | Not changed in 1e. The brief scopes 1e to guidance. A Core-bound confirmation (bound to member, target and input, as `organizations-and-center-agent.md` Permission model requires) belongs with the Phase 3b root-requester enforcement; reported as a program correction |
| 4 | The Service advertises `permissionModeAdvisoryPrompt`; strict capability schemas in an older Core or older CLI reject an unknown key | Verified, existing rollout contract | Not changed. Same pattern as `workingLanguagePrompt` (`c13d0e464b`): Core and schemas ship before the CLI and Service release that advertises the capability. Recorded for the Contract Impact Audit at release |
| 5 | Apply saved the mode before confirming the card was still pending, so a card dismissed in another tab could still change the mode | Verified | Fixed: Apply resolves the card on the server first and calls the existing permission-mode write only after that succeeds; Web test added |
| 6 | The weekly claim happens before delivery, so a Wake that never reaches the Agent uses up the week's suggestion | Verified, by design | Not changed. Under-suggesting is the safe failure for an optional advisory; releasing the claim would allow two suggestions in one week when a redelivery later succeeds. A redelivery of the same dispatch still receives the same block |

Category 2 (double counting, owner approvals): no finding. Category 3 next-step
mapping: no finding; no path suggests Bypass permissions or Full access. Claim
race: no finding; the conditional upsert admits one winner.

## Checks after fixes

- `pnpm -r --filter './packages/*' run build` and `./runtime/**`: pass.
- `pnpm run typecheck` in schemas, agent-runtime, db, api-client, core,
  gateway, openmeld-cli, web, remote-agent: pass.
- Biome on all changed files: clean.
- agent-runtime `tests/permission-mode-advisor.test.ts`: 20 passed.
- openmeld-cli `tests/parse-dispatch-task.test.ts`,
  `tests/resolve-local-service-capabilities.test.ts`: 28 passed.
- core (local PostgreSQL) `tests/permission-mode-advisor.integration.test.ts`,
  `src/__tests__/runtime-transport-client.test.ts`,
  `src/__tests__/dispatch-execution-service.test.ts`: 64 passed.
- web `space-pending-agent-actions.test.tsx`,
  `use-space-pending-agent-actions.test.tsx`: pass.
- remote-agent `tests/prompt.test.ts`: 46 passed.
- gateway full suite: 3 failures in `tests/http-forwarding.test.ts`
  (dispatch trace version, AccountSpaces); they fail identically with the 1e
  routes removed, so they are pre-existing.
