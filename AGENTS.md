## Purpose

`AGENTS.md` is the high-signal router for coding agents in this repository.

Read this file first, then read only the scoped owner documents under
`developing/` that match the task. Do not use this file as a full architecture
manual, implementation guide, migration plan, or debugging runbook.

For the documentation system itself, read `developing/README.md`.
For stable repository vocabulary, read `developing/glossary.md`.

## Engineering Judgment

For implementation, diagnosis, review, or planning that requires engineering
judgment, use the public
[Practical Engineering](https://github.com/lumpinif/practical-engineering)
skill (`practical-engineering`). Use it to keep scope outcome-first, choose the
smallest coherent root-cause correction, match validation effort to real risk,
and stop when the requested result is honestly proven.

If the skill is not installed and its public source cannot be reached, do not
block the task on setup. Apply those four principles directly from this router
and continue with the smallest evidence-backed path to the requested outcome.

This skill is decision guidance, not extra ceremony. It does not replace
explicit user instructions, OpenMeld owner documents, production guardrails,
or delivery and release rules. Skip it for factual answers and purely
mechanical edits.

## Production Guardrails

- Workstation Wakes follow RuntimeCoordinator; Remote Agent native
  delivery is the only exception:

```text
OpenMeld Web Space Wake -> RuntimeCoordinator -> current-account local OpenMeld Service / daemon -> local agent execution -> Space reply, explicit visible stopped outcome, or explicit visible failure
```

- Production constraints apply. Do not assume broad unsafe changes,
  compatibility breaks, migration shortcuts, or state rewrites are acceptable.
- RuntimeCoordinator is the in-flight workstation Wake execution truth.
- Current Wakeability and one concrete Wake execution are separate facts.
  Current Wakeability must not hide a real Wake failure.
- A running execution must not be failed by a fixed total wall-clock timeout
  while RuntimeCoordinator receives fresh accepted/running lifecycle or progress
  evidence.
- D1 dispatch records are a durable ledger and query projection. They record
  what happened; they do not decide in-flight execution truth.
- The Space durable dispatch outbox is the reliable workstation Wake conveyor.
  Queue is scoped to hosted recovery and other Queue message families; neither
  owns execution or final outcome.
- Local OpenMeld Service is the local execution carrier and trust boundary. It does
  not own Space truth, Agent Profile identity, final Wakeability, or
  RuntimeCoordinator execution truth.

## Context Routing

Start narrow:

1. Read `developing/README.md` when you need the documentation map.
2. Read only the owner docs that match the touched scope.
3. Read source code, schemas, and tests before trusting a document that might be
   stale.

In an isolated worktree without a local CodeGraph index, use `rg` for bounded
source discovery. Initialize CodeGraph only when deeper structural or call-path
analysis justifies a separate worktree-local index; never link another
worktree's index into the current checkout.

Use these owner documents:

| Scope | Read before changing |
| --- | --- |
| Product promise, core vocabulary, setup/readiness/diagnostics product meaning | `developing/product/product-model.md` |
| Experience judgment: status honesty, banner precision, guidance flow, copy tone | `developing/product/experience-principles.md` |
| Settled decisions that must not be relitigated or "optimized" away | `developing/decisions.md` |
| Agent Profile identity, Binding surface semantics, workspace and Default Project preferences, Agent Controller Permission Mode, local agent selection, reply recovery | `developing/product/agent-profiles.md` |
| Agent Profile model/reasoning selection, vendor-model catalog, cross-client selection contract | `developing/product/agent-model-selection.md` |
| Space Board/Entry Brief, membership/Direct Messages, Wake/Reference, threads, replies, and publication actions | `developing/product/space-collaboration.md` |
| Onboarding: Web first-run, in-Space "Get set up" checklist, `openmeld start`/`openmeld setup`/`openmeld doctor` behavior, start planner boundary | `developing/product/onboarding.md` |
| Organization tenancy, Center Agent identity/designation/delegation policy, Channels and Apps product semantics, Organization Documents and draft review, Information Protection, session sync, MVP scope and red lines | `developing/product/organizations-and-center-agent.md` |
| Projects: Organization-scoped identity, permissions, local connections, discovery, repository fingerprints, Default Project resolution, and Project-aware Wake failures | `developing/product/projects.md` |
| Agent Activity, local session observation, metadata privacy, presence, digests, retention, snapshots, canonical Project references, and Center Agent awareness | `developing/product/agent-activity.md` |
| Center Agent Routines: Routine/Run semantics, authority, scheduling, target Space, native delivery, tool policy, and client surfaces | `developing/product/center-agent-routines.md` |
| Organization Skills: portable Agent Skills bundles, permissions, immutable releases, GitHub import, Center Agent/Flue use, Web management, CLI loading, and local-agent delegation | `developing/product/organization-skills.md` |
| Feedback Inbox, Feedback Issue, submission privacy, delivery modes, handling boundaries | `developing/product/feedback-loop.md` |
| Opportunities: Center Agent recommendation review, member decisions, Inbox projection, and recommendation-versus-execution boundary | `developing/product/opportunities.md` |
| Workspace Inbox, unread and attention counts, item lifecycle, source coverage, browser delivery, urgent email, notification preferences | `developing/product/inbox.md` |
| Progressive disclosure, context selector, personal-context rules, Wake-access authorization UX, visibility presentation | `developing/product/presentation-progressive-disclosure.md` |
| Remote/hosted agent execution: runtime families (workstation vs native), native delivery, Message Channel ingress/publication, model-visible tools, App actions, guardrails, expansion path | `developing/product/remote-agent-runtime.md` |
| Wake execution, Wakeability, RuntimeCoordinator, Runtime Transport boundaries, local Agent human interaction, final outcome, dispatch trace baseline | `developing/architecture/agent-transport-contract.md` |
| OpenMeld Service / daemon lifecycle, RuntimeTransportHub fast paths and current-device Project operations, account/device/lane alignment, Prepare, service health, Agent Controller Interface instruction delivery, reporting, task callbacks, and update states | `developing/architecture/local-openmeld-service.md` |
| Data ownership, D1 projections, Opportunities, Agent Task Coordination, Dispatch Ledger, evaluation reports, native delivery and Message Channel ledgers, App connection ownership, trace selectors, Diagnostic Reports, Cloudflare evidence | `developing/architecture/data-and-observability.md` |
| Current D1 binding topology and future observability-only split direction | `developing/architecture/physical-db-split.md` |
| Shared schemas, Opportunity RPC contracts, live invalidation frames, Agent Controller Interface snapshots, Agent Task Coordination, Message Channel and App connection contracts, Prepare `setupBootstrap.facts`, shared packages, cross-client reuse, Space password contract | `developing/architecture/shared-contracts.md` |
| Shared UI primitives, design tokens, Fluid components, and cross-client UI package ownership | `developing/clients/shared-ui.md` |
| Cross-client app shell, unified Settings IA, shell/sidebar terminology, Settings capability gating | `developing/clients/shell-and-settings.md` |
| OpenMeld Web navigation topology and route placement, Organization-switch preservation, browser read-cache persistence, Center Agent Channels/Apps, Space UX, Wake details, setup handoff, and diagnostic surfaces | `developing/clients/web.md` |
| OpenMeld CLI command boundaries, Human View / Agent View, setup handoff, trace, lane safety | `developing/clients/cli.md` |
| Desktop GUI thin local control surface, tray/status/setup, GUI-to-CLI contract, desktop release component | `developing/clients/desktop.md` |
| Desktop preview download page, R2 artifact binding, and production Web download/update routes | `developing/clients/desktop.md`, `developing/clients/web.md`, `developing/engineering/development-workflow.md` |
| CLI binary release, R2 manifest, Web download route, and setup `dist=` distribution switch | `developing/engineering/cli-binary-release.md`, `developing/clients/cli.md`, `developing/clients/web.md` |
| Agent-native development, Final Candidate validation, Actions-unavailable fallback, optional review support, merge, release concurrency, health, smoke, evidence, and failure recovery | `developing/engineering/agent-native-delivery.md` |
| Production release lane selection, scoped local/GitHub deploys, D1 production sequencing, CLI rollout choice, health checks, and release reporting | `developing/engineering/production-release.md` |
| OpenMeld Changelog authoring, publication, historical backfill, generated projections, and GitHub release-note handoff | `developing/engineering/changelog.md`, then `.agents/skills/openmeld-changelog/SKILL.md` |
| Environment variables, Doppler local development, secret ownership, contributor onboarding, and production secret readiness | `developing/engineering/environment-and-secrets.md` |
| Internal staging scope, isolation, guarded deployment, and staging evidence | `developing/engineering/staging-environment.md` |
| Parallel-agent worktree ownership, agent-chosen OpenMeld development Spaces, coordination, unattended execution, local lanes, validation gates, contract rollouts, `OPENMELD_HOME`, real-user smoke, local component releases, DB workflow, Fresh Web Start | `developing/engineering/development-workflow.md` |
| Code style, lint, and formatting standards (Ultracite/Biome) | `developing/engineering/code-standards.md` |
| Repo-specific anti-patterns for tests, mocks, status logic, timeouts, keepalive | `developing/engineering/anti-patterns.md` |
| Blessed example files to copy for routes, services, DO alarms, CLI commands, queries, mocks, logging | `developing/engineering/exemplars.md` |

## Core Invariants

- Human UX and agent UX are first-class requirements.
- Product-facing copy targets North American users and must be natural,
  clear, native-level English.
- Use one stable term for one concept across code, schemas, APIs, docs, and
  product copy.
- Prefer explicit contracts, single sources of truth, and root-cause fixes over
  fallback behavior, duplicated state, or local patches.
- Treat duplicate facts, parallel authority paths, and dual-track state as
  high-severity product risks. If a change introduces or preserves two sources
  for readiness, execution, identity, routing, Binding, Space reply placement,
  or diagnostics, report it directly.
- Do not hard-splice behavior by reading private implementation state across
  owner boundaries when a contract or projection should exist. Local hard reads
  can pass tests while creating hidden coupling, drift, and fragile bugs.
- Model correctness belongs at the architecture boundary first: one canonical
  owner, one writer, one read projection, and explicit contracts before local
  convenience.
- Optimize for the main product link and user need before local engineering
  neatness: a user can Wake an Agent Profile, the correct local OpenMeld Service runs
  it, and the Space shows a reply, explicit stopped outcome, or explicit
  failure.
- Do not add fallback/default behavior unless the owning contract explicitly
  calls for it.
- Fail closed when identity, ownership, readiness, or execution evidence is
  missing or mismatched.
- Preserve diagnostic context. Do not swallow errors or hide broken data behind
  generic success states.
- Keep user-facing progress simple: current outcome, one next action, and a
  diagnostic path when useful.

## Codebase Clarity For Coding Agents

This repository is implemented and evolved primarily by coding agents. Agents
infer architecture from existing names, file structure, and patterns, so every
change must leave those signals cleaner and less ambiguous.

- Avoid "temporarily correct" implementations that pass the current task while
  preserving inconsistent terminology, half-migrated structure, stale files,
  duplicated patterns, or cleanup debt.
- Use one stable name for one concept across files, directories, symbols,
  schemas, APIs, tests, docs, and product copy. If a concept is `patterns`, do
  not introduce `templates`, `rules`, `flows`, or `strategies` for the same
  concept.
- Make file names and directory layout reflect the current architecture and
  ownership, not implementation history.
- Clean obsolete names, unused helpers, stale files, misleading test fixtures,
  and abandoned branches of logic when they are part of the touched scope.
- Do not leave half-renamed, half-migrated, or semantically misleading
  structures behind.
- When introducing a new pattern, make the owner boundary, naming, and intended
  extension point clear from the surrounding code.
- If existing structure is misleading but cleanup is larger than the task, avoid
  reinforcing it and call out the follow-up clearly.

## Source-Of-Truth Rules

- Shared cross-service, cross-package, cross-process, HTTP, RPC, WebSocket, CLI
  JSON, or diagnostic payloads must use `packages/schemas`.
- Use `zod/v4`, derive shared types from schemas, prefer `safeParse` on
  runtime/request paths, and preserve shared external error semantics.
- Reuse `packages/agent-runtime` for Agent Controller refs, Agent Controller
  Permission Modes, OpenMeld Service Runtime identity, registry contracts, Prepare
  readiness summaries, Binding projections, command eligibility, and Core claim
  eligibility.
- User-facing Wakeability must come from the Core-owned projection defined by
  `developing/architecture/agent-transport-contract.md`; clients do not derive
  it from route-online, Binding existence, service health, completed Prepare
  evidence, Agent Activity, or one Wake's historical outcome.
- RuntimeCoordinator finalization envelopes must use the shared schema. Do not
  hand-build finalization payloads or expose token secrets in diagnostics.
- Live invalidation frames are refresh signals, not state. Clients must read the
  owning Space/Core snapshots or projections after an invalidation instead of
  deriving membership, readiness, Binding, service liveness, or execution truth
  from the frame.
- Binding command eligibility and Core claim eligibility are policy projections
  only. They must not reserve leases, start execution, accept results, consume
  queues, or publish Space replies.
- Space password text is normalized through the shared Space password schema.
  Do not compare, store, or forward raw password strings with leading or
  trailing whitespace.
- Observability correlation is a read model, not a writer or authority.
  `runtimeCoordinatorExecutionId` is not a token, credential, or execution
  authority.

## Task Rules

- Before starting a task, re-read the user goal and choose the scoped owner docs
  that apply.
- Before requesting final validation, merging, or releasing, follow the complete
  lifecycle in `developing/engineering/agent-native-delivery.md`. Do not infer a
  second delivery process from workflow YAML, tool output, or old task history.
- When an Agent personally encounters a problem in any OpenMeld product
  surface, App, client, Service, runtime, integration, developer workflow,
  CI/CD, release, or validation path, record that occurrence through
  [Agent Experience Occurrence Feedback](developing/engineering/agent-native-delivery.md#agent-experience-occurrence-feedback).
  Use the authorized Felix Human Profile path, identify the actual
  Agent/model/session and context, and continue the main task unless the issue
  is a real blocker. Do not search for duplicates; recording is evidence
  capture, not authorization to fix.
- Use focused checks while implementation or blocker-capable review can still
  change the code. Treat broad affected, integration, release-ready, and Final
  Candidate runs as closeout evidence after the practical scope is stable, not
  as an iteration loop. For late findings, apply the value-and-scope boundary
  in `developing/engineering/agent-native-delivery.md`: fix a high-value,
  coherent finding when practical, and preserve separable follow-ups without
  reopening the candidate.
- Commit hooks check staged files; development push hooks must pass focused
  checks on the exact clean commit. Do not bypass failures. Keep PRs draft while
  developing; mark ready only after risk-appropriate behavior validation.
- Standard Final Candidate certifies identity, trusted control, repository
  contracts, and path-owned database/release readiness; it does not repeat broad
  workspace tests. The commands, rationale, and batch flow live only in
  [Agent-Native Delivery](developing/engineering/agent-native-delivery.md#daily-workflow).
- Before declaring a user-, operator-, integrator-, or contributor-visible
  change done, decide whether it needs an OpenMeld Changelog entry and, when it
  does, follow `.agents/skills/openmeld-changelog/SKILL.md`.
- Before declaring a change done, answer explicitly: does this change violate
  any rule in the scoped `developing/architecture/` owner documents? For state,
  readiness, availability, Wake routing, or service lifecycle changes this
  check is mandatory acceptance criteria, not optional review flavor. If a rule
  must change, change the owner document in the same PR with the reasoning.
- Load only files directly relevant to the task.
- Do not execute stale roadmap items directly. Plan from current production
  behavior and current owner docs.
- When a task specializes an existing object (a special Space kind, member
  role, or profile kind), inventory the parent's full user-visible and
  mutation surface and adjudicate every row: keep, or hide in UI and reject
  server-side, always in pairs. Acceptance must include a negative checklist
  of surfaces that must not appear or succeed. See
  `developing/engineering/anti-patterns.md` #10 and #11.
- Do not modify unrelated dirty files. If unrelated changes exist, ignore them.
  If related changes conflict with the task, pause only the conflicting part and
  ask for resolution.
- Never revert, overwrite, or delete external changes unless the user
  explicitly asks.
- Use `rg` / `rg --files` for search.
- Use `apply_patch` for manual edits.
- Keep tracked docs in English.
- Use `dev-tmp/` only for local temporary material. Do not make tracked code,
  tests, scripts, or docs depend on `dev-tmp/`.

## Testing And Validation

- For test additions, assertion changes, or cleanup, read
  [.agents/skills/writing-tests/SKILL.md](.agents/skills/writing-tests/SKILL.md).
- For CI failures, read [.agents/skills/debugging-ci-failures/SKILL.md](.agents/skills/debugging-ci-failures/SKILL.md).
  Use [.agents/skills/fixing-flaky-tests/SKILL.md](.agents/skills/fixing-flaky-tests/SKILL.md)
  only when investigating intermittent failures.
- Apply these PostHog skills through the
  [OpenMeld test guidance](developing/engineering/development-workflow.md#posthog-test-skills).
  Read the repository files directly when your agent does not discover them.
- Tests must prove real behavior and fail when behavior is wrong.
- Tests are conditional risk controls, not a per-file quota. Follow the
  Practical Test Standard in `developing/engineering/development-workflow.md`.
- For bug fixes, add or update a behavior-focused test that reproduces the bug
  before changing production code when practical.
- Do not weaken tests just to pass.
- Mocks of external contracts (HTTP responses, platform APIs, Durable Object
  namespaces) must be built from a captured real response or the vendor's
  types — never shaped after the implementation's own assumption. When an
  implementation changes which contract surface it consumes, re-capture the
  real shape first. See `developing/engineering/anti-patterns.md` #9.
- Use the smallest verification gate that proves the change:
  - focused package tests/checks for narrow changes
  - `pnpm check`
  - `pnpm build` when build output or package surfaces changed
  - `pnpm run check:affected`, `pnpm run test:affected`, or
    `pnpm run test:integration:affected` for changed-package validation
  - `pnpm run verify:release-ready` when the diff touches CLI, OpenMeld Service
    carrier files, OpenMeld-managed skills, daemon schemas, or
    `release/local-components.json`
  - `pnpm run verify:pre-push` or `pnpm run verify:pr` for broader gates
- Use the trusted current-main Final Candidate entrypoint from
  `developing/engineering/agent-native-delivery.md` for planning, the one normal
  hosted request, or the Actions-unavailable local fallback. Never start the
  guarded control plane through candidate-owned package scripts.
- If affected scripts need a base ref, fetch it or set `OPENMELD_AFFECTED_BASE`.
- `pnpm run verify:release-ready` is the single release-readiness command for
  local components. It builds the packaged OpenMeld CLI, verifies
  `release/local-components.json`, and skips only when no local component path
  changed in the selected base diff or current worktree.
- Never hand-edit local component hashes or stamp an existing CLI `dist` as if
  it were current. Use the base-aware `pnpm release:local-components stamp ...`
  command: it rebuilds the packaged CLI, rejects source drift and `--current`,
  writes the manifest, and verifies the result. Rerun it after a merge, rebase,
  or any later local-component change before running `verify:release-ready`.
- When a change touches CLI, OpenMeld Service carrier files, OpenMeld-managed skills,
  daemon/runtime schemas, Prepare Session schemas, shared HTTP/RPC/WebSocket
  schemas, or `release/local-components.json`, complete the Contract Impact
  Audit in `developing/engineering/development-workflow.md` before declaring
  the change done or deploying. Do not treat unchanged contract constants as
  proof that no contract changed; explicitly decide whether old and new CLI,
  Service, Skills, Core, Gateway, and Web can interoperate through setup, Wake,
  Space actions, and diagnostics.
- For production releases, choose the local or GitHub lane and exact scope from
  `developing/engineering/production-release.md`. Do not deploy until its
  scoped verification passes; any Core deploy must prove the production CLI
  channel can satisfy the declared release. Never bypass the guarded entrypoint
  with raw deploy or publish commands.
- Real-user smoke must use user-accessible entry points such as OpenMeld Web UI,
  published OpenMeld CLI, `openmeld-dev`, `openmeld-canary`, installed OpenMeld Service commands,
  or product-supported trace/diagnostic commands.
- Internal HTTP/RPC calls, D1 SQL, Durable Object inspection, Queue inspection,
  admin scripts, manual cookie/localStorage edits, DB row edits, and direct
  projection edits are internal diagnostics only. They do not count as real-user
  smoke by themselves.
- Any dispatch, Wake, setup, handoff, or reply path must have deterministic
  diagnostic evidence. For Wake diagnosis, use:

```text
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

## Browser Automation For Real-User Smoke

- Use Agent Browser when browser automation can run in an isolated
  agent-controlled browser and does not need the user's real Chrome state.
- Use the Codex Chrome Plugin when OpenMeld Web smoke needs the user's real Chrome
  profile, existing login state, existing tabs, Chrome extensions, or
  production-like authenticated browser behavior.
- Use Playwright or Playwriter when the task is to create, run, or reproduce a
  reusable browser automation test script.
- If the user explicitly asks for Codex Chrome Plugin, Agent Browser,
  Playwright, or Playwriter, use the requested tool unless it is unavailable;
  then state the reason and choose the closest suitable alternative.

## Lane And Local-State Safety

- The published `openmeld` lane uses `~/.openmeld` and is real user state.
- Desktop development that talks to CLI, OpenMeld Service, or Web must use an
  aligned repo-root lane from `developing/engineering/development-workflow.md`;
  do not use package-local Electron commands or mix dev/canary lanes with
  production endpoints or CLI state.
- Tests, fixtures, e2e runs, snapshots, local harnesses, and destructive
  validation must not read from or write to `~/.openmeld` unless the task explicitly
  validates the real installed production product and the user asked for that
  exact validation.
- Any test or script that touches OpenMeld Service lifecycle, service contracts,
  bundles, runtime leases, daemon device IDs, launchd/system-service
  registration, local-state repair/reset, Prepare runtime reporting, or service
  state must use a fresh temporary `OPENMELD_HOME`, `openmeld-dev`, or `openmeld-canary`.
- Repair before reset. Reset is last-resort destructive behavior for the active
  lane only.
- `OPENMELD_HOME` overrides the lane root. Commands that mutate service state must
  make the effective lane/root clear in output or validation notes.

## Cloudflare And Admin Boundaries

- Before Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, Workers AI, or
  Agents SDK work, re-check current Cloudflare docs and limits.
- New Cloudflare resources are not integrated until the owning `wrangler.jsonc`,
  docs, required sync scripts, and generated Worker types are updated.
- After Worker env names, bindings, `wrangler.jsonc`, or `secrets.required`
  changes, run the relevant type generation and env-contract verification from
  `docs/cloudflare-workers-env.md` and the repo workflow.

## Git And Commits

- Commit only when the user asks.
- Commit messages must be English and follow conversational commits.
- Do not stage unrelated worktree changes.
- Do not bypass pre-push hooks with `--no-verify` when pushing `main`.
- Concurrent agents often share this worktree. Commit with explicit pathspecs,
  never bare `git commit -a`, and never amend, rebase, or rewrite a commit you
  did not author in the current session.
- Before committing docs-only changes, run at least:

```text
git diff --check -- AGENTS.md developing
```
