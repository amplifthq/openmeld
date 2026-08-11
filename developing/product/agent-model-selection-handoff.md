# Agent Model Selection — Implementation Handoff

## Agent Context

- Purpose: A single orientation entry-point for the agent cluster implementing the
  per-Agent-Profile model + reasoning-effort selection feature. It routes to the
  authoritative design, states what is decided vs open, gives the PR plan, and the
  working norms.
- Read this when: You are picking up implementation of this feature.
- Update this when: A PR lands, a decision changes, or scope shifts. Remove when
  the feature ships.
- Do not use this for: Current model-selection product truth or implementation
  behavior without also checking the owner document and current source.
- Source of truth: The DESIGN is owned by [agent-model-selection.md](./agent-model-selection.md).
  This file is orientation + sequencing only; if the two disagree, the design doc
  wins.

**Status:** Design approved, decisions resolved, and implementation is in
progress. Some planned pieces already exist in source; verify current source
before using the sequencing below. The owner-doc acceptance check (design §11)
is still required for delivery.

---

## Mission (one paragraph)

OpenMeld must always pass an explicit, valid model when it drives a local agent, and the
model (plus reasoning effort) must be a user-selectable property of each Agent
Profile, editable from Web and CLI (and a future Desktop). This fixes a production
incident (a Claude session pinned to the retired Fable 5 kept failing on resume)
and adds the selection feature. While we are touching the controller-selection
seam, we also pay down a real debt: the "which local agents are bindable" predicate
has drifted between Web and CLI; we unify it into one shared, framework-agnostic
decision core.

---

## Must-read, in order

1. [agent-model-selection.md](./agent-model-selection.md) — the design SSOT (read
   fully).
2. The four owner docs under [`developing/architecture/`](../architecture/) —
   `agent-transport-contract.md`, `local-openmeld-service.md`, `data-and-observability.md`,
   `shared-contracts.md`. These are rule authority. The acceptance hard rule (root
   `.claude/CLAUDE.md`) requires you to read them and explicitly confirm this change
   violates none, **before delivery**.
3. [agent-profiles.md](./agent-profiles.md) — Agent Profile product semantics and
   the Binding invariant (Profile → openMeldServiceRuntimeId + agentControllerRef).

---

## What is decided

- **Scope:** Claude Code + Codex only. OpenClaw stays a usable controller but gets
  **no** model feature in Phase 1 (its model is per-agent persistent + auth-coupled;
  left to the user's own OpenClaw config).
- **Pinned model IDs only** (no aliases), globally. One maintainable **default model
  per agent controller**, which doubles as the runtime fallback.
- **Catalog:** a new `release/vendor-models.json`, repo-authored, embedded into the
  core build and served read-only by core; CLI keeps an embedded snapshot as offline
  fallback. Top-level key is `agentControllers`. Single `unavailable` flag per model.
  No "is-latest" concept. `minCliVersion` is a reserved optional field, **not**
  enforced in Phase 1. Catalog changes ship by **core deploy** — never a CLI publish,
  never a direct DB edit.
- **Selection storage:** per-profile intent rides **binding metadata** (keyed by
  `agentControllerRef`); the daemon learns it via route-catalog-sync and resolves the
  effective model **locally** at dispatch into the existing
  `conversationPolicy.{model, reasoningLevel}` slot. **Do not bump the dispatch queue
  schema.**
- **Reasoning effort is wired in Phase 1** for controllers with a per-call control
  (Codex `-c model_reasoning_effort=`, Claude `--effort`). Option strings must match
  each vendor's official values exactly.
- **Resilience:** always pass an explicit model; Claude adds `--fallback-model
  <controller default>` (native) + a model-error classifier (currently missing);
  Codex resolves `unavailable` → default before dispatch. A model failure is a
  dispatch outcome, never a service-down signal. Unset profiles late-bind to the
  current controller default at dispatch.
- **Reuse:** one shared headless decision core in `packages/agent-runtime` (mirror
  `packages/start`'s `buildOnboardingPlan`: pure facts → view-model; each client
  a thin renderer). The core owns the agent-selection decision (controller +
  model + reasoning). Candidate **source** stays per-client (CLI reads local
  state; Web fetches it); candidate **contract** converges.

See design §3 for the full list.

## Resolved decisions (design §11a)

- **Bindable-candidate predicate:** bindable = supported/builtin + registered/detected
  + enabled + `selectable`. **Readiness/`launchStatus` is NOT a filter** — it is
  display metadata. (Web's `launchStatus === 'ready'` was wrong; CLI's
  `registered && enabled` was close but must also honor `selectable` and stay
  readiness-agnostic.) Confirm field semantics against `local-agent-catalog.ts` +
  `AgentTargetState` when implementing `resolveSelectableCandidates`.
- **transport-mode / response-policy:** Web **will** expose them too (shared model +
  Web write contract, with defaults). Web UI rendering is a later increment; not a
  logic fork.

---

## PR plan (design §13) — split at the deploy-ordered boundary

- **PR 1 — Shared profile-setup core + re-point (pays the debt).** New
  `packages/agent-runtime/src/profile-setup.ts` (`LocalAgentCandidate`,
  `resolveSelectableCandidates`, `buildProfileSetupViewModel`, `validateSelection`),
  unit-tested. Re-point CLI `agent-setup-flow.ts` and Web `create-profile-dialog.tsx`
  / `agent-binding-choice-list.tsx` onto it. Centralize `agentControllerRef`
  construction. View-model carries empty model/reasoning for now (behavior
  identical). Safe to do in one shot: mechanical re-pointing onto pure functions; the
  Web UI was just rebuilt (commit `ddc315b07`) while the decision logic was untouched.
  Do **not** extract kind/name (Web has none — fake sharing).
- **PR 2 — Catalog foundation + durable incident fix (ships alone).**
  `release/vendor-models.json` + schema + core `GET /v1/config/model-catalog` + CLI
  embedded fallback; adapter argv changes (Claude `--model`/`--fallback-model`, Codex
  `-m`) + Claude model-error classifier + `originLaunch` `{model}` token + late-binding
  default. **Closes the production incident on its own.**
- **PR 3 — Selection storage + sync + UI (deploy-ordered).** `.optional` extension of
  `ensureAgentProfilePrimaryBindingBodySchema` + DB columns + ensure-primary-binding
  RPC + route-catalog-sync + daemon resolution into `conversationPolicy`; reasoning
  wiring; render model/reasoning controls + `--view agent` JSON. Deploy
  **web → gateway → core**.
- **Follow-on (separate):** kind/name + transport/response-policy Web UI unification.

---

## Before you code

- **Verify (no guessing — design §12):** Claude `--effort` legal values and that
  `--model`/`--fallback-model`/`--effort` all apply on `--resume`; Codex
  `model_reasoning_effort` legal values and that `exec resume -m` + `-c
  model_reasoning_effort=` work on the resume subcommand; current valid pinned-ID set
  per controller; reasoning option strings field-exact to each vendor.
- **Owner-doc acceptance check (design §11) — mandatory, currently owed.** Confirm:
  the catalog RPC is not a liveness probe and does not feed availability; the daemon
  model/reasoning addition does not touch the single liveness source (ServiceRuntime);
  cloud stores intent only and does not validate against local capability; selection
  rides `agentControllerRef` metadata and a controller rebind invalidates a stale
  model.

---

## Working norms

- **Record progress in this Space** (decisions, blockers, PR links) so the human can
  follow asynchronously.
- **The strictObject landmine (PR 3):** `ensureAgentProfilePrimaryBindingBodySchema`
  is a `z.strictObject` — adding fields can break already-published CLIs. New fields
  must be `.optional` **without** `.default`, deployed web → gateway → core. Keep this
  out of PR 1.
- **Per-PR scope discipline:** do not fold PR 3's schema/DB/deploy-ordered work into
  the PR 1 refactor. PR 2 can ship first and independently.
- **Commits on the shared `main` worktree:** always `git commit --no-verify -m … --
  <your files>` with an explicit pathspec; never a bare `git commit` or `--amend`
  (the index may hold another agent's staged work).
- **Deploy reality:** the release CI pipeline is degraded; core deploys are done via
  local `wrangler` for now.

---

## Out of scope (Phase 1)

OpenClaw model config; enforced version floors; an "is-latest" indicator; per-device
model-support display; a deploy-free DB override layer; adding fields to
`registry.json`; bumping the dispatch queue wire schema; a full create-profile flow
rewrite (kind/name stay per-client).
