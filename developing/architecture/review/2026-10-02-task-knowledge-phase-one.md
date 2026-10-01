# Task Knowledge Phase One: Delivery Evidence

## Agent Context

- Purpose: Record the implementation boundary, reproducible evidence, and remaining acceptance gaps for the phase-one memory and task knowledge change.
- Read this when: Reviewing PR #1429 or continuing its isolated runtime acceptance.
- Update this when: A listed acceptance gap is verified or a review changes the implementation.
- Do not use this for: Production readiness, provider quality guarantees, or authorization to publish organization knowledge.
- Source of truth: The linked source owners, executable tests, and exact observations below.
- Removal condition: Remove this review record after independent acceptance; retain stable contracts in the product owner documents and final evidence in the PR.

Status: Draft implementation; Local setup blocked and full three-runtime acceptance pending.

## Scope And Ownership

Base: `7864a7641beb30377a28578c8163400361450fd3`. Worktree:
`/Users/felix/Desktop/work/openmeld-worktrees/knowledge-phase-one`, branch
`codex/knowledge-phase-one`, draft [PR #1429](https://github.com/amplifthq/openmeld/pull/1429).

Memory remains a hint. Approved documents and immutable Skill releases retain
their existing Core owners and authorization. The task directory is a bounded
read projection, not a stored knowledge object or a new permission service.
Personal Remote continues to exclude the Center-only protected prompt and
Computer projection. Its ordinary approved document read uses the existing
verified-member RPC. Local dispatch reads as its owned active Agent Profile and
never changes an ordinary task's working directory or global Skill installation.

Automatic capture now exits for organization-shared and externally-shared
environments before provisioning or writing either scope. Private callbacks and
explicit authorized team saves retain their existing writers. No old records are
deleted, settings migrated, graphs rebuilt, or additional extraction model added.

The directory uses a 6,000-character starting display budget. Omitted counts cover
only visible metadata. Full list/read tools remain available. Full frozen Skill
selections and Flue mounts are preserved; description clipping is display-only.
Instructions and resources keep their exact release/digest. A revoked future read
is denied; this does not claim to remove material already read by a model.

## Contract Impact Audit

- Changed boundaries: additive Local dispatch read tools and an optional
  `organizationSkillReleases` field in the existing dispatch action context;
  owned-Agent read authorization on existing document/Skill APIs; Remote prompt
  composition and an exact-selection catalog search tool.
- Unchanged boundaries: setup, Wake transport, final Space action envelopes,
  RuntimeCoordinator ownership, service status, trace, diagnostics, and rescue
  commands. No new shared HTTP/RPC schema, database migration, or contract enum.
- Old cloud with new local: unsupported approved-document Agent reads return a
  visible unavailable directory; ordinary tasks still run. Existing exact Skill
  release reads retain the old API shape. No fallback to a human/Center identity.
- New cloud with old local: old tools and callbacks retain their payloads. Old
  local components do not gain the new directory but remain capable of existing
  setup/Wake/reply work. Optional dispatch context data is local to the matching
  preparation/tool-server pair; old contexts parse as no automatic selections.
- Rollout: Core read behavior before Remote caller deployment. The CLI and
  Service are stamped `available`; neither compatibility floor nor epoch changes.
  This PR does not deploy, merge, or publish a binary.
- Architecture check: no scoped architecture owner is displaced and no second
  source of execution, identity, readiness, publication, or authorization truth
  is introduced. Existing member authority remains the owner of knowledge reads.

## Independent Behavioral Expectations

The following expectations come from the accepted product contract, not generated
answers. Passing a deterministic boundary test does not certify model behavior.

| Scenario | Evidence / current limit |
| --- | --- |
| Six personal candidates still leave room for eligible team facts | Final envelope tests, including long text; baseline failed before the fix |
| An old process self-report does not justify suppressing all team context | Final-envelope noisy personal candidate control; no semantic extractor claim |
| A short recurring private preference can persist | Private callback tests; real Center turn observed; subsequent search recorded separately below |
| Long casual conversation may produce no useful new facts | Not established by this PR's live sample; no forced minimum extraction count |
| Plans and unadopted suggestions are not completion/decisions | Center and personal Remote correctly classified planned migrations; unadopted-suggestion holdout remains pending |
| Current approved document B outranks remembered A; historical A remains historical | Center and personal Remote read and applied updated B; separate historical-A question remains pending |
| Shared Space/Channel chat writes neither scope | Memory service tests across trusted environment/source variants |
| Explicit team save works when enabled and does not enable itself when disabled | Existing writer tests retained and passed |
| Mid-query deletion or opt-out prevents injection | Real Workerd/D1 integration tests; persisted rows remain unchanged by recall |
| A deleted subject is not revived by reading | Real Workerd/D1 integration and service tests |
| Unknown validity is unknown; record time is not approval time | SDK adapter metadata tests; no historical record deletion |
| Missing answers and uncertain same-name projects are not guessed | Guidance; model holdouts pending |
| Document refresh failure never uses cached protected content | Concurrent caller, denied refresh, malformed/wrong-org tests |
| Ordinary Agent can read approved body, not draft or management capability | Core document integration tests; personal Remote's Center-only context remains disabled |
| Directory omission does not uninstall an admitted Skill | Bounded display test, exact catalog search test, existing Flue activation test |
| Publishing a new Skill does not replace a frozen release; disablement denies reads | Core persisted-release integration plus current catalog read tests |
| Explicit authorized saves need no repeated approval; unadopted proposals do not take effect | Existing tools retained, shared guidance; full natural-language holdout pending |
| Private data and handoff references do not grant unrelated action authority | Existing identity/audience boundaries retained; full three-runtime privacy/action holdout pending |

## Commands And Observations

All commands run from the owned worktree. Local logs are in `dev-tmp/` and contain
no production evaluation data. They are not runtime dependencies.

```sh
pnpm dev:doctor
pnpm dev:worktree
pnpm dev:account
pnpm dev:seed
pnpm dev:web:worktree
npm exec --yes --package bun@1.3.14 -- pnpm cli:binary:serve:worktree
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm check:affected -- --concurrency=2
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm verify:release-ready
pnpm changelog:check
pnpm verify:docs -- --strict
```

Doctor: 13/13 required dev secrets available. Affected checks: 33 tasks passed.
Release-ready: packaged CLI build, 65 release contract tests, and manifest
verification passed. The official Windows helper artifact was verified against
the current source fingerprint. Changelog validation passed. A misplaced owner
document introduction was caught by strict docs validation and moved below its
required Agent Context block; the rerun passed.

Focused checks include memory service (31), SDK adapter (6), native completion
(127), Core documents (39), Core Skills (37), D1 memory (3), Remote document
refresh (5), Remote Skills (6), personal Remote tools (3), shared directory (2),
Local paged reads (9), and memory setting UI (2). Counts identify observed runs,
not an acceptance quota. New files are also typechecked.

### Live Provider Holdout

```sh
OPENMELD_LIVE_MEMORY_EVAL=dev-synthetic doppler run --project openmeld-core --config dev -- pnpm --filter @openmeld/core exec vitest run --config vitest.boundary.config.ts tests-node/knowledge-memory.live.test.ts --maxWorkers=1
```

At `2026-10-01T16:40:07.915Z`, a fresh UUID-isolated fictional Cedar Kite member
subject received a preference for two-column weekly reports. The provider accepted
the write in 1,119 ms. The third bounded search found the preference with its
original conversation/message source after 13,550 ms. The runner deleted only the
subject it created. This proves live adapter write/extraction/search, not product
callback, injection, or correct subsequent model use. One sample is not p95;
provider billing is not exposed by this adapter, so cost is unmeasured.

### Product Entry Smoke

Lane `wt-e7ed328ad1a0`, Web `http://wt-e7ed328ad1a0.localhost:30240`, isolated
state under this worktree's `.wrangler-dev-state/isolated/` and `.turbo/dev/isolated/`.
Normal seeded-account sign-in and onboarding were completed. No production
private conversations, memory, or organization knowledge were used.

At approximately `2026-10-01T16:35Z`, the synthetic Northstar Product Studio Center
chat accepted a Maple Lantern three-bullet update preference and replied. At
`16:57:59.938Z`, a new normal Web turn produced a successful tool result with three
matching member-memory items, all attributed to original message
`c8276a26-d8ff-43b6-a8cf-1b5628785be6` at `16:35:18.139Z`, capture method
`automatic_turn`. Submission: `53919d9c-b039-4294-b0d0-e97debf19178`.
Read-only inspection of the isolated Flue tool-outcome record corroborated the
visible reply; no reasoning records were used. One returned item was an
"Assistant confirmed" process summary. This is observed extraction noise, not
fixed or hidden by the budget correction.

At `17:00:27.054Z`, an explicitly authorized normal chat turn successfully saved
the new approved document `org_document_3c71981e-5d53-477b-ac4e-852a8cc65d7e`, then
read its exact body at `17:00:30.169Z`. The approved `updatedAt` was
`2026-10-01T17:00:27.016Z`. Submission:
`226b4b9e-247c-4451-826a-8fb8203ee96a`. There was no second approval request.
These are synthetic dev objects, not changes to official organization knowledge.

The same normal Center chat authored and installed `maple-status-check` at
`17:03:42.478Z`: release `org_skill_release_129c4c63eaf948dd05c303ee49b07a1b`, digest
`973c7d6e1e4d4721a2da57b47eca08b1a27d71ef5bd997c4c7a07e7f85f58d96`.
Center holdout submission `74fb0ff3-746c-4b05-b987-0e24a6b5c752` activated it, read
`references/example.md`, read the approved document, and correctly reported the
completed accessibility review, unrun Friday migration, and unknown vendor date.
The tool outcomes occurred at `17:05:15.794Z` through `17:05:15.869Z`; the visible
answer used the new facts rather than the resource's sample facts.

A personal Remote Agent was created through **Team > Agents > Create Agent >
Remote Agent** in the same synthetic organization. Its first Web DM submission
`da2b9a3b-1e52-4631-b12e-dff4ff1196ef` activated the same release, read the same
resource (`17:09:20.727Z`), and used ordinary document list/get
(`17:09:24.274Z`). It correctly classified a different held-out case: completed
backup rehearsal, unrun Monday migration, and unconfirmed vendor delivery. Its
reply cited the exact same document revision and Skill release/digest. A local
screenshot is `dev-tmp/personal-remote-skill-smoke.png`; the tool outcomes, not
the screenshot alone, establish the reads.

Observed Flue stream durations were 12.414 seconds for the Center holdout and
14.584 seconds for the personal Remote holdout, excluding admission and final
publication. Summed per-response token telemetry was respectively 91,386 and
32,273 tokens including cache reads/writes across model steps; these are not
unique context sizes or billable-token estimates. Runtime cost fields reported
zero, which is not verified billing. Monetary cost remains unmeasured.

Center then saved 32 explicitly requested synthetic directory-padding documents
through the existing save tool. With 33 documents, the shared display renderer
omits Maple Lantern from the bounded directory while the full member list still
contains it. This controlled display check supplements the subsequent normal
list/get smoke; it does not by itself prove a model discovered the omitted entry.

The document was updated through normal Center chat to B at
`2026-10-01T17:12:21.131Z`: a two-column State/Detail table replaces the older
three-bullet preference. Personal Remote submission
`a6377668-ffab-4277-9311-0156ae04c7f5` searched the full 33-document list at
`17:14:25.807Z`, read B at `17:14:28.308Z`, and returned a table separating a
completed security review from an unrun Tuesday migration and unspecified risk.
Center submission `3e9e43c5-271e-44c8-8be8-f844603a67e2` also found the omitted
document through the full list and read B at `17:15:27.440Z`. These tool outcomes
confirm current body retrieval; the personal Remote visible answer confirms the
new format was applied. The Remote chat entry is
`/o/northstar-product-studio-n6akyf/chats/0f184e44dcef51b979b56bd62e6984b78bdd2bb823b8785ef30be160c7317551`.

Chrome Plugin and in-app browser were unavailable, so the prescribed Agent Browser
fallback was used. Rebuilding dependencies while Web was running triggered repeated
HMR restarts; the Web process exited with a 4 GiB JavaScript heap exhaustion.
Only this worktree's dev stack was stopped and restarted after builds completed.
Other worktrees and production `~/.openmeld` were not modified.

Local runtime acceptance is blocked at the normal Web-generated dev-lane Setup
entry. Two commands, the second obtained with **Get a new setup command**, both
reported `computer authorization failed: Client ID mismatch`. Web reported
`prepare.authorization_failed`. Effective home was the isolated worktree home
above, not `~/.openmeld`. No credential copying, private token edit, or
authorization workaround was attempted. Reproduce from the dev lane's
`/o/northstar-product-studio-n6akyf/connect` page with the current binary server;
use a fresh generated command and never reuse the expired credentials from logs.

## Remaining Acceptance

Do not mark ready on these tests alone. Resolve the normal Local dev Setup blocker
and complete Local directory/body/Skill acceptance. Center and personal Remote
body discovery, exact resource use with new inputs, and document A-to-B checks
passed as recorded above. Publication during an active model task and revocation
before a new model read have persisted-contract tests but no full live runtime
smoke yet. Private callback and fresh retained search passed; this run does not
isolate automatic injection from existing chat history as the cause of model use.
Complete the remaining semantic/privacy holdouts listed in the scenario table.
No claim is made about production ontology, long-run extraction quality, concurrent
model quality, or model forgetting.
