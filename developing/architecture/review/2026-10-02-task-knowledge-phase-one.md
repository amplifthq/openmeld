# Task Knowledge Phase One: Delivery Evidence

## Agent Context

- Purpose: Record the implementation boundary, reproducible evidence, and remaining acceptance gaps for the phase-one memory and task knowledge change.
- Read this when: Reviewing PR #1429 or continuing its isolated runtime acceptance.
- Update this when: A listed acceptance gap is verified or a review changes the implementation.
- Do not use this for: Production readiness, provider quality guarantees, or authorization to publish organization knowledge.
- Source of truth: The linked source owners, executable tests, and exact observations below.
- Removal condition: Remove this review record after independent acceptance; retain stable contracts in the product owner documents and final evidence in the PR.

Status: Draft implementation; independent review and full three-runtime acceptance pending.

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
| Plans and unadopted suggestions are not completion/decisions | Shared task guidance; model holdout still pending |
| Current approved document B outranks remembered A; historical A remains historical | Guidance plus noncached current reads; model conflict holdout pending |
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
chat accepted a Maple Lantern three-bullet update preference and replied. The
reply alone is not persistence evidence. Subsequent search and runtime outcomes
must be recorded before full acceptance.

Chrome Plugin and in-app browser were unavailable, so the prescribed Agent Browser
fallback was used. Rebuilding dependencies while Web was running triggered repeated
HMR restarts; the Web process exited with a 4 GiB JavaScript heap exhaustion.
Only this worktree's dev stack was stopped and restarted after builds completed.
Other worktrees and production `~/.openmeld` were not modified.

## Remaining Acceptance

Do not mark ready on these boundary tests alone. Complete normal-entry Center,
Local, and personal Remote checks for a directory-omitted document body, one exact
frozen Skill with a new input, document A-to-B across tasks, publication during a
task, and revocation before a new read. Complete private capture/search/injection/
correct-use and guidance holdouts; report any concrete environment blocker.
No claim is made about production ontology, long-run extraction quality, concurrent
model quality, or model forgetting.
