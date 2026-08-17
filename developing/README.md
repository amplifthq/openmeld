# Developing

## Agent Context

- Purpose: Define the tracked home for OpenMeld context engineering.
- Read this when: You need durable project context before changing architecture, workflows, validation, local development, or agent-facing instructions.
- Update this when: The context system, document boundaries, source-of-truth pointers, or AGENTS.md routing rules change.
- Do not use this for: Temporary notes, raw logs, private local data, one-off command output, or product implementation details.
- Source of truth: This file owns the `developing/` documentation system.

## Purpose

`developing/` is the core directory for OpenMeld context engineering.

It stores durable internal development context that should be shared with future contributors and coding agents. Its job is to route the right context to the right task without turning every task into a full-documentation read.

Good context answers:

- What source of truth owns this behavior?
- What boundary must not be crossed?
- What command or validation proves the change?
- What document must be updated if this behavior changes?
- What should be ignored because it is temporary, private, historical, or out of scope?

## Core Rules

- Keep context routed, not dumped.
- Prefer durable facts over raw thinking.
- Give every concept one obvious owner document.
- Link to owner documents instead of repeating rules.
- Make staleness visible with clear update triggers.
- Store only material that is safe to commit to the main repository.
- Write tracked development documents in clear English.

## Document Standard

Every durable context document must start with:

```md
## Agent Context

- Purpose: What problem this document solves.
- Read this when: When an agent or contributor must read it.
- Update this when: What changes require updating it.
- Do not use this for: What this document must not own.
- Source of truth: The exact scope where this document is authoritative.
```

Each document should own one responsibility. If a document grows beyond one responsibility, split it.

Plan, design, handoff, and review documents must also carry an explicit
lifecycle marker near the top: a `Status:` line (for example DRAFT, APPROVED,
IN PROGRESS, SHIPPED, SUPERSEDED) plus the condition under which the file can
be deleted (for example "Remove when the feature ships"). When that condition
becomes true, delete the file in the same PR that completes the work; git
history is the archive. Owner documents carry no `Status:` line — they are
always current, or they must be fixed in the same PR that changes behavior.

Lifecycle classification is structural, not inferred from prose. Dated review
and implementation evidence belongs under `developing/architecture/review/`.
Plans, designs, and handoffs outside that directory use the `-plan.md`,
`-design.md`, or `-handoff.md` suffix. Every other Markdown file under
`developing/` is an owner document and must not carry a lifecycle `Status:`
line. Move a misplaced document instead of weakening its lifecycle wording to
make a check pass.

## AGENTS.md Boundary

`AGENTS.md` is the agent-facing router for the repository. Keep it small and high-signal.

It should contain:

- global production constraints
- non-negotiable safety rules
- task-to-document routing
- short command references needed before scoped discovery
- rules that prevent recurring high-impact agent mistakes

It should not contain full architecture explanations, long tutorials, migration plans, historical notes, raw debugging procedures, or duplicated `developing/` content.

If a rule is detailed but scoped, put it in `developing/` and add only a one-line pointer in `AGENTS.md`.

Per-agent entrypoints such as `.claude/CLAUDE.md` are thin adapters. They may
contain only agent-specific runtime behavior plus a pointer to `AGENTS.md`.
Never copy rules, routing tables, or architecture facts into a per-agent
entrypoint; content syncs one way, from `AGENTS.md` and `developing/` outward.

## `dev-tmp/` Boundary

`dev-tmp/` is local-only working material. It is not a tracked project knowledge base.

Use `dev-tmp/` for private notes, raw investigations, local test accounts, screenshots, command output, temporary plans, and intermediate drafts.

When a `dev-tmp/` note becomes durable project knowledge, distill it into English, remove private or raw evidence, and place the stable rule, decision, or workflow under the correct `developing/` owner.

Do not make tracked code, scripts, tests, or docs depend on `dev-tmp/`.

## Planned Structure

Use this structure unless a concrete need proves a better boundary:

```text
developing/
  README.md
  product/
  architecture/
  clients/
  engineering/
```

- `product/`: durable product model, Agent Profile semantics, and Space collaboration semantics.
- `architecture/`: execution, local service, data, observability, and shared contract boundaries.
- `clients/`: Web, CLI, Desktop, cross-client shell/Settings, and shared UI
  client responsibilities.
- `engineering/`: local development, validation, testing, and workflow rules.

## Current Entrypoints

This directory is the durable context layer. Use these entrypoints:

- `AGENTS.md`: agent-facing rules and context routing
- `developing/decisions.md`: settled-decision index — check before proposing
  renames, swaps, or cleanups that feel obvious
- `developing/architecture/agent-transport-contract.md`: current Agent Transport contract and main-chain ownership
- `developing/product/`: product model, Agent Profile, Agent Profile model
  selection, Space collaboration, Organizations/Center Agent, Projects, Agent
  Activity, Center Agent Tasks, Center Agent Routines, Organization Skills,
  Feedback Loop, Opportunities, Inbox, and the progressive-disclosure
  presentation model
- `developing/architecture/`: transport, local service, data/observability, physical DB split, and shared contract ownership
- `developing/clients/`: Web, CLI, Desktop, cross-client shell/Settings, and
  shared UI client boundaries
- `developing/engineering/production-release.md`: production release lane
  selection, scoped local and GitHub deploys, database sequencing, CLI rollout,
  health checks, and release evidence
- `developing/engineering/changelog.md`: Git-backed Changelog entries,
  publication evidence, historical backfill, generated projections, and
  GitHub release-note handoff
- `developing/engineering/environment-and-secrets.md`: Doppler project/config
  ownership, shared local environment commands, secret safety, and production
  readiness boundaries
- `developing/engineering/`: development workflow and validation boundaries

Legacy reference files have been distilled into `developing/` owners and
retired to git history (`DEVELOPMENT.md` was retired 2026-07-03).
`docs/architecture/` keeps only the production smoke runbook, its log, and the
2026-06 incident background note; `docs/cloudflare-workers-env.md` stays the
Cloudflare Worker env authority. If an old reference points at a retired file,
follow the owner document instead.

When moving material into `developing/`, distill it. Do not copy large old
documents unchanged unless the whole file is still the cleanest source of truth.

## Reading Rule

Start narrow:

1. Read `AGENTS.md` for global rules and required source-of-truth pointers.
2. Read this file when you need the internal documentation map.
3. Read only the `developing/` documents that match the touched scope.
4. Read source code, schemas, and tests before trusting a document that might be stale.

For Center Agent Routine or Run work, start with
`developing/product/center-agent-routines.md`, then follow its scoped links to
the Organization, Remote Agent, data, shared-contract, Web, or CLI owner that
matches the boundary being changed.

For Center Agent Task or Task Context work, start with
`developing/product/center-agent-tasks.md`, then follow its scoped links to the
Organization, Remote Agent, Space, Inbox, data, shared-contract, or Web owner
that matches the boundary being changed. Do not use Agent Task Coordination or
an Agent Task Handle as the user-visible Task product.

For Organization Skill work, start with
`developing/product/organization-skills.md`, then follow its scoped links to
the Organization, Remote Agent, data, shared-contract, Web, CLI, or local
service owner that matches the boundary being changed.

For Project work, start with `developing/product/projects.md`. For Agent
Activity work, start with `developing/product/agent-activity.md`. Then follow
the selected owner's scoped links to the Organization, local service, data,
shared-contract, Web, or CLI owner that matches the boundary being changed.

For Inbox work, start with `developing/product/inbox.md`, then follow its
source-specific links to Space, Center Agent, Documents, data, shared-contract,
Auth, and Web owners. Do not use Inbox as a replacement authority for any
source domain.

For Opportunity work, start with `developing/product/opportunities.md`, then
follow its scoped links to the Center Agent, Inbox, data, shared-contract, and
Web owners. Do not treat a Recommendation as execution permission or use Inbox
as the Opportunity authority.

Context is useful only when it changes the next action.

## Maintenance Checklist

Before committing a context change, check:

- Is this safe to store in the main repository?
- Is it English?
- Does it have an `Agent Context` block?
- Does it have one clear owner?
- Would an agent do something differently because of it?
- Should it be a scoped `developing/` document instead of `AGENTS.md`?
- Should it stay in `dev-tmp/` because it is temporary, private, or raw evidence?
- When closing out a feature or fix: did any plan, handoff, or review document
  created for it reach its removal condition? Delete it in the same PR.
