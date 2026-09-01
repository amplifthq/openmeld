# Agent Profile Model Selection

## Agent Context

- Purpose: Define the Phase-1 design and execution plan for letting users
  select the model (and reasoning effort) per Agent Profile, the core-served
  vendor-model catalog that is its source of truth, and the framework-agnostic
  selection logic shared by Web, CLI, and a future Desktop GUI.
- Read this when: You are changing how OpenMeld chooses or passes a provider model,
  the vendor-model catalog, per-Agent-Profile model/reasoning selection, or the
  create/maintain-profile experience across any client.
- Update this when: The catalog shape, its delivery/maintenance mechanism, the
  shared selection contract, the per-adapter model/reasoning flags, or the
  Phase-1 scope changes.
- Do not use this for: Liveness/availability rules, Wake-routing truth, Runtime
  identity, OpenMeld Service lifecycle, or the dispatch wire-schema (those are owned
  by `developing/architecture/`), nor OpenClaw model management (out of scope in
  Phase 1).
- Source of truth: This file owns the model-selection feature design and its
  Phase-1 plan. Durable Agent Profile product semantics remain owned by
  [agent-profiles.md](./agent-profiles.md).

## Current implementation state

The approved Phase-1 implementation is in progress. Some planned pieces
already exist in source, including the repo-authored
`release/vendor-models.json`, the core-served model catalog route, shared
model-selection contracts, adapter model passing, and Binding `modelSelection`
plumbing. Verify current source before following the PR sequencing below. The
owner-doc acceptance check (see §11) is still required for delivery.

---

## 1. Background

When OpenMeld Wakes a local Claude Code agent it calls
`claude --resume <sessionId> -p ... --output-format json` **without `--model`**.
Claude Code resume reuses the model the session was *created* with. A session
created on Fable 5 kept resuming Fable 5; after Fable 5 was retired, every resume
returned `is_error: "Claude Fable 5 is currently unavailable"` → exit 1 → OpenMeld
reported a generic `provider_exit_error`, failing 7+ times in a row. Editing the
global `~/.claude/settings.json` model did not help, because resume ignores it.

Proven fix (measured against a real session): passing an explicit model on
resume (`claude --resume <id> --model <live>`) overrides the burned-in model
**and keeps the conversation history**. The durable answer is therefore: **OpenMeld
always passes an explicit, valid model on every provider call**, and the model
becomes a first-class, user-selectable property of an Agent Profile.

---

## 2. Phase-1 Scope

| In scope (Phase 1) | Out of scope (Phase 1) |
|---|---|
| Per-Agent-Profile model selection, editable anytime from Web and CLI | OpenClaw model management (OpenClaw stays a usable controller; its model is left to the user's own OpenClaw global config) |
| Five controllers: **Codex**, **Claude Code**, **Grok Build**, **Cursor**, and **OpenCode** | Automatically updating a Local Agent installation from Web |
| Reasoning-effort selection where the vendor exposes a separate per-call control (Claude Code, Codex, OpenCode, and Grok Build; Cursor ACP does not) | Any "is this model the latest" indicator or UI |
| Exact provider model IDs, including an explicitly cataloged provider-managed selector when that is the provider's stable ID | Treating a failed or missing capability check as proof that a model is unsupported |
| One maintainable **default model per agent controller** (doubles as the runtime fallback) | A deploy-free DB override layer for the catalog |
| A core-served vendor-model catalog (repo-authored, core-deployed) | Adding fields to `registry.json` or to the dispatch queue wire schema |
| A framework-agnostic selection module reused by Web, CLI, and future Desktop | Full create-profile flow unification (kind/name, CLI-only transport/response-policy, per-client candidate sourcing, `agentId`-vs-`agentControllerRef` modeling) — tracked as a separate follow-on refactor |
| Replacing **both** clients' agent-controller selection step with the shared controller+model+reasoning unit | A new planner that rewrites the entire create-profile flow wholesale |

---

## 3. Locked Decisions

1. **Model intent scope:** per Agent Profile. Cloud stores the *intent*; the
   local daemon resolves the *effective* model at dispatch.
2. **Model is bound to the agent controller.** A model ID is only meaningful
   under one controller. The catalog is keyed by agent controller, and a
   per-profile selection is stored together with its controller. Rebinding a
   profile to a different controller invalidates and resets the stored model.
3. **Exact catalog IDs only** (no OpenMeld-invented aliases), globally, for a
   consistent mental model across providers. A provider-managed selector is
   allowed only when the provider exposes it as a stable selectable ID and it
   is explicitly cataloged. Cursor ACP's `default[]` model is one such ID; it is
   shown as **Auto** and is not silently substituted for another selection.
4. **Default per agent controller**, maintainable at any time, used both as the
   default for new/unset profiles and as the runtime fallback when a configured
   model cannot be used.
5. **Single availability flag.** A catalog model is either usable or
   `unavailable`. No separate deprecated/retired states.
6. **No "latest" concept** in Phase 1 — not computed, not stored as a boolean,
   not shown.
7. **Reasoning effort is wired end-to-end in Phase 1** for controllers that
   expose a separate per-call control. Option strings must match the vendor's
   official values exactly (verified at catalog-authoring time). Cursor ACP
   exposes reasoning inside exact model IDs, not as an independent session
   option, so Cursor models have an empty `supportedReasoningLevels` list and
   the Cursor adapter rejects an independent `reasoningLevel`. Grok Build ACP
   exposes reasoning effort independently for each live model, so the adapter
   validates both values against the current authenticated account before it
   sends a prompt.
8. **Catalog delivery** = repo-authored manifest, embedded into the core build,
   served read-only by core; the CLI keeps an embedded snapshot as offline
   fallback only. Changing the catalog is a core deploy, not a CLI publish and
   not a DB edit.
9. **Do not bump the dispatch queue schema.** The selection rides binding
   metadata down to the daemon and is resolved locally.
10. **Selection logic is shared headless code**, not duplicated per client.
11. **Core rejects invalid explicit selections at the Binding write boundary.**
    An explicitly supplied model must be available for the Binding's controller,
    and an explicitly supplied reasoning level must be supported by that model.
    The catalog stays dynamic, so shared request schemas remain bounded strings
    rather than catalog-derived enums. An omitted selection continues to use the
    default-model path.
12. **A catalog claim is not proof that one installation can run a model.**
    Profile create and edit compare the selected Computer's current ACI model
    inventory with the catalog. When that inventory uses catalog IDs, it is the
    authoritative compatibility evidence. Otherwise, a valid installed version
    may be compared with a catalog `minCliVersion`. Missing, failed, malformed,
    or unrelated evidence remains unknown and must not disable a model. A known
    incompatibility disables that choice and offers the exact Computer as the
    place to update or change the Local Agent installation. OpenMeld never
    silently changes the user's selected model.

---

## 4. Three-Layer Data Model

```
Layer A  registry.json                 UNCHANGED. CLI-versioned code contract
         (config/agents/registry.json)  (detection, launch templates, adapter
                                         capability, conversation kinds).
                                         Build-embedded in the CLI; read on hard
                                         offline paths. Carries NO model data.

Layer B  vendor-model catalog (NEW)     Per-controller supported models, default
         (release/vendor-models.json)    model, availability, reasoning options.
                                         Repo-authored, core-build-embedded,
                                         core-served; CLI embedded fallback only.

Layer C  per-profile selection          The chosen {modelId, reasoningLevel}.
         (binding metadata)              Stored on the primary binding (keyed by
                                         profile + agentControllerRef), synced to
                                         the daemon, resolved at dispatch into the
                                         existing conversationPolicy slot.
```

Layer A and Layer B are deliberately **separate artifacts**. `registry.json`
self-declares as the agent SSOT and is read on offline paths (detection before
the service exists, reply-readiness during a network outage, daemon-capability
bootstrap, doctor/repair); it must stay embedded and must not move behind an
RPC. It contains no vendor/model fields, so there is nothing to carve out — the
catalog is net new.

---

## 5. Vendor-Model Catalog

### 5.1 Shape — `release/vendor-models.json`

The top-level key is `agentControllers` (keyed by controller id).

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-06-17T00:00:00.000Z",   // maintenance metadata; never shown to users
  "agentControllers": {
    "codex": {
      "defaultModelId": "gpt-5.5",            // default for new/unset profiles AND runtime fallback
      "models": [
        {
          "id": "gpt-5.5",
          "displayName": "GPT-5.5",
          "unavailable": false,
          "supportedReasoningLevels": ["<exact official values>"],  // TO-VERIFY per §12
          "minCliVersion": null                // reserved, NOT enforced in Phase 1
        }
      ]
    },
    "claude-code": {
      "defaultModelId": "claude-opus-4-8",
      "models": [
        {
          "id": "claude-opus-4-8",
          "displayName": "Claude Opus 4.8",
          "unavailable": false,
          "supportedReasoningLevels": ["<exact official values>"],
          "minCliVersion": null
        }
      ]
    }
    // openclaw intentionally absent in Phase 1
  }
}
```

### 5.2 Delivery

This mirrors the existing `release/local-components.json` pattern
([update-projection.ts](../../services/core/src/local-components/update-projection.ts)
build-embeds the manifest and core serves a projection of it):

```
release/vendor-models.json   (repo, PR-reviewed)
        │ build-time embed
        ▼
  core serves  GET /v1/config/model-catalog   ← Web / online CLI / future Desktop read live
        │
  CLI carries a build-time embedded snapshot   ← offline fallback only
```

A catalog change is **not** a direct DB edit (see §9 for why DB editing was
rejected). Because the packaged CLI embeds this catalog, the edit also moves
the OpenMeld Service bundle hash, and a Core-only deploy fails closed on the
stale `release/local-components.json` hash. Publish a catalog change through
the CLI release lane: its Core projection deploy is what brings the new
catalog to Web and online CLI.

### 5.3 Maintenance Workflow (must be documented in-repo)

1. Edit `release/vendor-models.json` (add/retire a model, flip `unavailable`,
   change a controller default, update reasoning options).
2. Open a PR. Review is the safety gate for the high-blast-radius default-model
   value. CI validates against the catalog schema in `packages/schemas`.
3. Merge to main, inspect the local-component release facts on a clean release
   worktree with `pnpm release:local-components plan --next`, then stamp the
   exact touched components with the explicit policy and reason required by
   `developing/engineering/production-release.md`. Land the stamp through its
   versioned release PR. Feature and ordinary PR branches must keep the base
   package version and manifest unchanged; the pre-push gate enforces this with
   deferred-release verification against the PR base.
4. Dispatch the CLI Release workflow at that commit. It publishes npm, R2, the
   release tag, and the Core projection. The projection serves the new catalog to
   Web and online CLI, and the CLI's embedded snapshot ships in the same published
   version — there is no separate "refresh later" cadence to wait for.

A short maintenance guide (how to add/retire a model, change a default, source
the exact reasoning option strings, run the owner-doc check, deploy) ships as
part of this feature, alongside `config/agents/README.md`.

### 5.4 Claude Opus 5 vendor verification

The 2026-07-30 catalog update follows the official Claude Code contract:

- the pinned model ID is `claude-opus-5`;
- Claude Code CLI uses `--model claude-opus-5` and `--effort <level>`;
- the Claude Agent SDK uses `model: "claude-opus-5"` and
  `effort: <level>`;
- the supported effort levels are `low`, `medium`, `high`, `xhigh`, and
  `max`;
- Claude Code `2.1.219` is the minimum version that supports Opus 5.

Sources: the
[Claude Code 2.1.219 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.219),
[model configuration reference](https://code.claude.com/docs/en/model-config),
and [CLI reference](https://code.claude.com/docs/en/cli-reference).

This update adds Opus 5 as an available pinned model but keeps
`claude-opus-4-8` as the controller default. Current clients enforce a valid
`minCliVersion` only when live model inventory cannot provide stronger evidence.
Older clients may still send the default to an older Claude Code installation,
so move the default only after the compatibility guard has completed its client
rollout or another explicit compatibility decision makes that rollout safe.

### 5.5 Hosted Center Agent catalog

The same manifest now includes the code-owned `center-agent` controller. This
is a hosted-runtime policy catalog, not a local Agent Profile controller:

- `defaultModelId` is the system default resolved for each new Center Agent
  turn. The current default is `z-ai/glm-5.3-flash` (**GLM 5.3 Flash**).
- The selectable models are `z-ai/glm-5.3-flash`, `x-ai/grok-4.6`,
  `x-ai/grok-4.5`, and `deepseek/deepseek-v4-flash`, presented as
  **GLM 5.3 Flash**, **Grok 4.6**, **Grok 4.5**, and **DeepSeek V4 Flash**.
- A hosted model may declare one optional `badgeLabel` as catalog-owned
  selector presentation metadata. Core projects the same label onto the
  explicit model choice and the OpenMeld-default choice when that model is the
  current default; clients render it without inferring freshness from model ids
  or version names.
- Each hosted model declares its OpenRouter model id, input modalities, context
  window, output budget, and reasoning level. Admission freezes these values
  into the turn request; the worker does not rebuild them from mutable catalog
  state.
- Hosted reasoning remains catalog-owned and fixed to `high`. The worker reads
  that frozen value dynamically for each admitted route. It is not a separate
  Organization preference or Web setting in the current product.
- `hostedRuntimePolicy.imageUnderstandingModelId` names the image-capable
  auxiliary model used for every current-version image turn before persistent
  primary-model admission. The auxiliary returns an untrusted text
  description; the frozen primary model still owns semantic judgment and the
  final answer.
- The frozen primary model owns semantic judgment and completion for every
  ordinary Center Agent turn, including Task and Space creation requests. A
  worker-owned classifier or auxiliary completion model must not replace it for
  a supposedly simple mutation.
- `hostedRuntimePolicy.automaticModelFallback` is structurally fixed to
  `false`. A primary-model failure is a turn failure, never authority to choose
  another primary model. This model-identity rule does not disable OpenRouter's
  provider rerouting when multiple providers serve that exact model.

This catalog is the single source for the system default, selectable models,
runtime capacity metadata, and image-understanding policy. The Organization's
Binding stores only an optional selected model id. An absent model id means
**system default** and therefore follows a later default change on the next
turn; it is not copied into another settings table. If a previously selected
id is no longer in the catalog, member-facing projections use the neutral
`Unavailable model` label while retaining the id only as diagnostic metadata.
Core rejects new work on that Binding until an owner or admin chooses an
available model; it never routes the stale id or silently substitutes the
default.

### 5.6 GLM 5.3 Flash hosted verification

The 2026-08-27 default change follows the official OpenRouter contract:

- the pinned model id is `z-ai/glm-5.3-flash` (**Z.ai: GLM 5.3 Flash**);
- OpenRouter reports input modalities text, image, and video with text output;
  the Center Agent declares only `text` and `image` because the hosted runtime
  never sends video parts and the schema bounds modalities to what the worker
  actually consumes;
- the supported reasoning efforts are `max`, `high`, and `low` with `max` as
  the provider default; hosted reasoning stays frozen to the catalog-owned
  `high` value that the worker reads per admitted route;
- the frozen capacity caps are deliberate: the catalog `contextWindow` uses
  OpenRouter's top-provider context length (`1,048,576`, below the larger
  catalog-wide context length of `1,310,720` so compaction triggers before a
  real provider limit), and `maxOutputTokens` stays at the shared hosted
  budget of `16,384` used by every other hosted entry;
- OpenRouter supports tools, tool choice, structured outputs, reasoning, and
  reasoning effort for this model.

Sources: the official OpenRouter models API response for `z-ai/glm-5.3-flash`
captured on 2026-08-27 (`https://openrouter.ai/api/v1/models`; captured shape
mirrored in `services/remote-agent/tests/fixtures/openrouter-model-z-ai-glm-5.3-flash.json`).

`x-ai/grok-4.6` remains the dedicated `imageUnderstandingModelId`: the
auxiliary image path stays on the production-proven model while the primary
default changes independently. GLM 5.3 Flash is declared `["text", "image"]`
to reflect the verified provider capability and selector contract, but the
current version still sends every raw image through the frozen Grok 4.6
auxiliary before GLM receives the bounded text description. Explicitly
selected Grok 4.6 turns remain Grok 4.6 as the primary model as well.

### 5.7 OpenCode controller catalog refresh

The 2026-08-27 refresh re-authored the `opencode` local Agent Profile
controller from live authenticated evidence instead of incrementally patching
stale entries:

- **One policy owner:** `release/vendor-models.json` remains the single
  selectable-model authority; no dynamic catalog source was added.
- **Authoring source:** the authenticated `opencode models <provider>
  --verbose` CLI output (OpenCode 1.18.23) supplies exact ids, display names,
  status, and per-model variant keys. Variant keys are copied verbatim into
  `supportedReasoningLevels` because the adapter forwards them as exact
  `--variant <level>` values; inference from names is prohibited.
- **Provider scope:** the refresh covers OpenCode's first-party curated
  providers — `opencode` (free tier), `opencode-go` (Go plan), and `openai`
  (Zen-hosted OpenAI models). The third-party `openrouter` passthrough inside
  OpenCode mirrors the volatile OpenRouter marketplace scoped to whatever the
  user's own OpenRouter account can bill; cataloging hundreds of such ids
  would claim usability OpenMeld cannot verify at authoring time, so those
  models stay out of the manifest until they are individually curated.
- **Compatibility fact:** Decision 12 still governs—when a Computer's ACI
  model inventory lists a catalog id, that inventory is authoritative;
  otherwise `minCliVersion` applies. Models absent from both the manifest and
  the device inventory stay unknown/unavailable rather than usable-by-hope.
- **Retired entries removed:** `opencode/x-preview-f-free`,
  `opencode/north-mini-code-free`, and `opencode/deepseek-v4-flash-free` are
  no longer reported by the authenticated CLI and were deleted rather than
  marked unavailable; stale explicit selections project as
  `Unavailable model` per §5.5.
- **Controller default:** because the previous default
  `opencode/north-mini-code-free` disappeared upstream, the default moved to
  the currently reported free-tier model `opencode/mimo-v2.5-free`, not to a
  paid-plan model that an OpenCode user may not have. A controller default must
  always be a valid, maintained id (§8.2), and every non-empty
  `supportedReasoningLevels` variant was verified against the same CLI output.

The 2026-09-01 follow-up recaptured OpenCode 1.18.25's authenticated
`opencode models opencode-go --verbose` contract before adding
`opencode-go/qwen3.8-flash`. The provider reports the model as active with the
display name **Qwen3.8 Flash** and the exact variant keys `low`, `medium`, and
`xhigh`. The captured provider-shaped fixture is retained in the schema tests
so the catalog entry is checked against observed vendor fields rather than a
fixture shaped after OpenMeld's manifest.

---

## 6. Reusable Selection Logic (Web / CLI / Desktop)

**Problem:** today the Web and CLI create-profile flows are duplicated with no
shared planner. Putting model-selection logic only in Web would force the CLI to
re-implement it. We will not do that.

**Pattern to mirror:** `packages/start` →
[`buildOnboardingPlan()`](../../packages/start) is the in-repo gold standard for
"framework-agnostic logic consumed by multiple clients": a pure function takes a
normalized fact model and returns a decision view-model. Current Web owners keep
route-specific rendering adapters under their live owner surfaces, while CLI
renders comparable view-models through its dual-view presenters. We apply the
same shape.

### 6.1 Shared headless module — `packages/agent-runtime`

`packages/agent-runtime` is the home for framework-independent presentation and
effective-runtime selection logic: it is pure runtime-policy code with zero UI
dependencies and is already imported by both clients. It treats agent controller
+ model + reasoning as one unit (a model is meaningful only under a controller;
reasoning only under a model) and exports pure functions and view-model types:

- `resolveSelectableModels(catalog, agentControllerId)` → list of
  `{ id, displayName, isDefault, isUnavailable }`.
- `resolveEffectiveModel(profileSelection, catalog)` → the model that will
  actually be used (late-binds an unset/`unavailable` selection to the
  controller default).
- `resolveSupportedReasoningLevels(catalog, agentControllerId, modelId)` → the
  reasoning options menu (empty when the vendor has no per-call control).
- `validateSelection(selection, catalog)` → advisory issues for client guidance;
  it does not authorize a Binding write.
- `buildModelSelectionViewModel(...)` → the single framework-agnostic view-model
  that every client renders.

The view-model carries everything a client needs to draw the control and nothing
client-specific: selectable models with a default marker, the resolved current
selection, the reasoning options, validity, and the effective-model label (which
is never blank).

Core is the authoritative write boundary. It reads the deployed catalog and
rejects unsupported explicit values before persisting a Binding. Client-side
validation may improve the interaction, but it must never replace or weaken the
Core check.

### 6.2 Thin per-client renderers

- **Web:** a hook/component maps the view-model to the existing
  TabsSubtle/RadioGroup design system in `clients/web/src/components/profiles/`,
  **replacing the current `AgentProfileBindingChoiceList` controller step**. It
  only renders and calls the shared write function.
- **CLI:** a presenter maps the view-model to `promptSearchSelect` for the human
  view, **replacing the current controller picker (`resolveAgentControllerSelection`
  in `agent-setup-flow.ts`)**; the agent view emits/accepts the machine-readable
  form (see §8.4).
- **Desktop (future):** consumes the same view-model and write function; only
  the native rendering differs.

### 6.3 Scope of the extraction (what is actually duplicated)

A sizing pass (2026-06-17) showed the duplication is **narrower and sharper** than
"the two flows differ." Apply the three-way distinction to each concrete
difference:

- **The real debt — one drifted predicate.** The only genuinely duplicated
  decision is *which local agents are bindable*, and the two predicates have
  **already drifted**: CLI filters `registered && enabled`
  (`agent-setup-flow.ts` `resolveEnabledBuiltinControllerCandidates`), Web filters
  `launchStatus === 'ready'` (`create-profile-dialog.tsx`
  `bindableLocalAgentIdsFromTarget`). Same intent, two predicates, already
  inconsistent — one client can show an agent as bindable that the other hides.
  This is the bug the extraction fixes, by collapsing both onto one shared
  `resolveSelectableCandidates`. The correct predicate is **resolved in §11a-1**:
  bindable = supported + registered + enabled + `selectable`; readiness /
  `launchStatus` is display-only, never a filter.
- **Candidate source stays per-client (correctly); the contract converges.** CLI
  reads local `AgentTargetState`; Web consumes a fetched
  `LocalAgentCatalogEntryProjection` (it cannot read the local filesystem). The
  transport must differ; the shapes are ~90% isomorphic and converge on one
  `LocalAgentCandidate` contract (a half-built version already exists in
  `packages/agent-runtime/src/local-agent-catalog.ts`). Each client builds its own
  read-model, then calls the shared functions — exactly the
  `buildOnboardingPlan` pattern.
- **Kind/name is NOT duplicated — do not extract it.** CLI owns
  `resolveCreateProfileKind`/`resolveCreateProfileName`; Web has **zero**
  equivalent (kind/name arrive as dialog state from the parent context).
  Extracting them now would create a CLI-only module Web never calls — fake
  sharing. Leave them in the CLI.
- **Rendering/interaction divergence stays per-client** (clack vs React; CLI's
  non-interactive `--view agent` auto-select / guide-error path vs Web's dialog).
  Correct, not debt.
- **agentId → agentControllerRef (refactor-only, in the extraction PR).** Web
  carries `boundAgentId` and concatenates `builtin:${id}` only at submit; CLI
  carries the canonical `agentControllerRef` throughout (built via
  `buildAgentControllerRef`). The write boundary is already identical. Centralize
  ref construction in the shared adapter and drop the inline string-concat. No
  product-visible change; aligns to the `shared-contracts.md` binding invariant.
- **transport-mode + response-policy — RESOLVED (§11a-2): Web exposes them too.**
  They are **not** CLI-only. They live in the shared model + Web write contract
  with defaults from the start; **Web UI rendering is deferred** (defaults apply
  until the Web controls are built). A render-timing choice, not a logic fork. The
  shared-model + write-contract part can land with the feature; the Web controls
  are a later UI increment.

Net: extract the shared candidate/controller decision core and re-point both
clients (fixing the drifted predicate); do not extract kind/name; defer
transport/policy behind a product decision.

What genuinely cannot be shared: React components, clack prompts, Electron
widgets, styling/i18n. Everything else (resolution, validation, defaulting,
view-model shape) lives once in `packages/agent-runtime`.

---

## 7. Read/Write Plumbing

### 7.1 Read the catalog

Add `readModelCatalog()` to the shared
`packages/api-client` (alongside the existing
`createAgentProfileBindingApi()` factory, consumed by both clients) calling
`GET /v1/config/model-catalog`. The CLI falls back to its embedded snapshot when
offline.

### 7.2 Write the selection (rides binding metadata)

The selection `{ modelId, reasoningLevel? }` attaches to the **primary binding**,
which already carries `agentControllerRef` (giving controller-namespacing for
free):

- Schema: extend `ensureAgentProfilePrimaryBindingBodySchema`
  ([agent-profile-binding.ts](../../packages/schemas/src/schemas/http/agent-profile-binding.ts))
  with optional `modelId` / `reasoningLevel`, and the binding projection with an
  optional `modelSelection`.
- DB: add `model_id` / `reasoning_level` columns and the monotonic
  `configuration_revision` to `openMeldDaemon_agent_profile_bindings`
  ([agent-profile-binding.schema.ts](../../packages/db/src/core/agent-profile-binding.schema.ts)).
- Every accepted change to controller-native execution settings increments the
  Binding's `configuration_revision`. The revision is execution identity, not
  UI metadata: it lets Core prove that the local route has applied the same
  settings that were accepted for a Wake.
- Core handler: thread the selection through the ensure-primary-binding RPC.
- Core command service: validate every explicit selection against the deployed
  catalog before writing. Unknown or unavailable models and unsupported
  reasoning levels fail the whole request with a stable 400 error and the
  actually supported values. Omitted selections do not read or validate the
  catalog. A new controller conversation receives the catalog default at
  dispatch. An existing Codex thread with no explicit Binding selection keeps
  its thread-owned model and reasoning settings because OpenMeld omits both
  fields; an explicit Binding selection still overrides that thread state.
- **Controller rebind invalidates the model:** when a binding is rebound to a
  different `agentControllerRef`, clear `model_id` / `reasoning_level` (they
  reset to the new controller's default).

These are **optional, additive** fields. Because the catalog is a separate file
and `conversationPolicy` already has the `model`/`reasoningLevel` slots, this
feature does **not** add a field to a strict shared schema in a way that could
break already-published clients — but any schema touch must still be deployed
web → gateway → core and validated for backward tolerance.

### 7.3 Daemon resolution at dispatch

The daemon learns binding metadata via the existing **route-catalog-sync** path
(`notifyRuntimeTransportRouteCatalogChanged` → daemon ledger), **not** the dispatch
queue. The negotiated expected-routes `v3` response and daemon ledger carry the
Binding identity and `configurationRevision` with the optional model selection.
At dispatch the daemon:

1. resolves the effective model/reasoning from local binding state + embedded
   catalog (using the §6.1 pure functions), except that an existing Codex thread
   with no explicit Binding selection produces no model/reasoning override,
2. sets them on the in-process `AdapterDispatchRequest.conversationPolicy`
   (`model`, `reasoningLevel`) — the slot already exists at
   [conversation-contract.ts:18-21](../../packages/schemas/src/schemas/daemon/conversation-contract.ts)
   with zero functional readers today,
3. the adapter argv builders read `conversationPolicy` and add the flags.

The dispatch queue freezes only `bindingId` and `configurationRevision`, not a
second copy of the settings. A Service that advertises
`profileConfigurationRevision: true` reports the Binding identity and revision
it has applied. Runtime Transport delivers only when that report exactly matches
the frozen dispatch identity; otherwise it rejects with
`daemon.profile.configuration_not_synced` and the existing retry path waits for
route-catalog convergence. When the Service still reports an older revision for
the same Binding id — ordinary post-settings-write propagation — Runtime
Transport first holds delivery inside a bounded convergence window, nudges the
Service to re-sync its expected routes, and delivers as soon as its next
register report matches, so an immediate Wake does not need a manual retry. If
the window expires or anything other than upward propagation is observed, it
fails closed with the same reason code and diagnostics. Old Services do not
advertise the capability, so Core strips the additive identity fields before
delivery and preserves the previous behavior during rollout.

---

## 8. Adapter, Resilience, and UI Changes

### 8.1 Adapter argv

| | Pass model | Pass reasoning | Fallback | Error classification |
|---|---|---|---|---|
| **Claude Code** ([Claude Agent SDK transport](../../runtime/adapters/claude-code/src/transport/claude-agent-sdk-transport.ts), legacy argv in [buildClaudeArgs](../../runtime/adapters/claude-code/src/transport/claude-cli-transport.ts)) | `model` SDK option / `--model <pinned id>` | `effort` SDK option / `--effort <level>` | `fallbackModel` SDK option / `--fallback-model <controller default>` (native) | Classifies invalid/retired models as `config.invalid`, temporary availability separately, and a signal-terminated CLI process as `provider.process_terminated` |
| **Codex** ([CLI transport](../../runtime/adapters/codex/src/transport/codex-cli-transport.ts), [App Server transport](../../runtime/adapters/codex/src/transport/codex-app-server-transport.ts)) | Explicit Binding selection: CLI `-m <pinned id>` (also on `exec resume`); App Server `thread/resume.model` and `turn/start.model`. New conversation with no selection: catalog default. Existing thread with no selection: omit the override. | Explicit Binding selection: CLI `-c model_reasoning_effort=<level>`; App Server `turn/start.effort`. Existing thread with no selection: omit the override. | resolve explicit `unavailable` → default before dispatch | Already classifies bad model → `config.invalid` |
| **OpenCode** ([buildOpenCodeArgs](../../runtime/adapters/opencode/src/transport/opencode-cli-transport.ts)) | `--model <provider/model>` | `--variant <level>` where the level comes from OpenCode model variants | resolve `unavailable` → default before dispatch | Use OpenCode provider error classification; provider/model errors must stay visible |
| **Cursor** ([Cursor ACP transport](../../runtime/adapters/cursor/src/transport/cursor-acp-transport.ts)) | `session/set_config_option` with `configId: "model"`, `type: "id"`, and the exact model ID returned in the session's model config option; fall back to legacy `session/set_model` only when ACP explicitly reports that the standard method is unavailable | Not exposed independently by Cursor ACP; reasoning-bearing variants remain part of the exact model ID | Catalog defaults to Cursor's `default[]` (**Auto**); the adapter validates the requested ID against one complete session inventory | Reject a complete inventory that excludes the requested ID as `model.unavailable`; classify a still-missing or conflicting inventory as `model.inventory_unavailable`; reject independent reasoning as `model.reasoning_unsupported` |
| **Grok Build** ([Grok ACP transport](../../runtime/adapters/grok-build/src/transport/grok-build-acp-transport.ts)) | ACP session model selection using the exact model ID advertised by the authenticated account | ACP effort selection using an effort advertised for that exact live model | No adapter-side substitute after live negotiation; an unavailable explicit model or effort fails before `session/prompt` | Reject incomplete or conflicting live inventory as `model.inventory_unavailable`, a missing requested model as `model.unavailable`, and an unsupported effort as `model.reasoning_unsupported` |

Cursor model discovery is a pre-prompt contract, not a best-effort hint. When
the first `session/new` or `session/load` result omits the inventory or exposes
conflicting legacy and config-option inventories, the adapter performs one
bounded `session/load` recheck for the same session. It must fail before
`session/prompt` if the recheck is still incomplete, and it must preserve both
reported inventories in bounded local diagnostics. Those diagnostics include
the reported count and an explicit truncation flag so the bounded list is never
mistaken for the complete controller inventory. The config-option parser reads
ACP's current `configId` field and Cursor's legacy `id` field; a field-name
version difference must not be misreported as a missing model inventory. It
must never merge
conflicting inventories, silently choose another model, or retry the Wake after
prompt execution begins.

Grok Build uses the same pre-prompt principle with a different vendor contract.
The reviewed catalog defines OpenMeld's selectable intent, while ACP
`initialize` plus the opened session define what the current authenticated
account can actually use. The adapter requires those live inventories to be
complete and consistent, intersects them with the catalog selection, and fails
closed before `session/prompt` when the requested model or effort is absent. It
does not ask Grok to guess, silently choose another live model, or replay the
Wake through Headless JSON.

The `originLaunch` registry supports both a model-bearing `commandTemplate` and
an optional `unselectedModelCommandTemplate`. Codex uses the latter when the
Binding has no explicit model selection, so its copy-paste resume hint preserves
the thread-owned model instead of injecting the current catalog default.

### 8.2 Resilience — one mechanism, three problems

A single fallback path covers pinned-ID retirement, CLI-version-floor misses,
and multi-device divergence:

- **Proactive:** when the catalog marks a model `unavailable`, the effective
  model late-binds to the controller default before dispatch.
- **Reactive:** Claude uses native `--fallback-model`; Codex relies on the
  proactive path plus its `config.invalid` classifier (an optional single retry
  to the controller default is a possible fast-follow).
- The controller default is the last line of defense and must always be a valid,
  maintained ID.
- Runtime fallback is only the final defense against catalog-version drift or a
  previously stored selection becoming unavailable. It must not silently accept
  a catalog-invalid explicit Binding write.
- A model failure is a **dispatch-level outcome**, never a service-down signal;
  it must not affect liveness or reap a lease.

### 8.3 Create / maintain profile UX

- **Create (Web + CLI):** after the controller is chosen, show a model list from
  the catalog (`unavailable` hidden or disabled). The controller default is
  pre-selected and marked with a **"Default"** label. The user may submit without
  choosing. If the selected model has reasoning options, show a reasoning
  selector defaulting to the controller/model default.
- **Per-profile settings (Web + CLI):** the same two controls, editable later,
  reading the live catalog so an `unavailable` selection is shown as such with a
  switch-to-default affordance.
- **Rendering everywhere:** show an explicit Binding selection as the profile's
  effective model. An unset new conversation may render "Using default:
  &lt;model&gt;". An existing Codex thread with no explicit selection must not claim
  that the catalog default replaced the thread-owned model.

### 8.4 CLI agent view (enables dogfooding)

The CLI's `--view agent` / `--json` surface exposes the model selection so an
**Agent** operating the CLI (not just a human) can read and set it:

- a machine-readable envelope in
  [cli/json-output.ts](../../packages/schemas/src/schemas/cli/json-output.ts)
  carries `{ agentControllerRef, modelSelection }`,
- read/update commands let an Agent view and change the model/reasoning via the
  same shared write path.

This is what lets us drive the implementation itself through OpenMeld (see §13).

---

## 9. Why Not Edit the DB Directly

For the catalog specifically — high blast-radius (a bad default model can break
every user's Wake, the Fable-5 class) and low frequency (vendor cadence ~monthly)
— the routine mechanism is repo-authored + core-deploy-served:

| | repo + core-deploy-served | repo + CLI-publish-embedded | direct DB edit |
|---|---|---|---|
| Propagation | fast (deploy, ~minutes) | slow (publish + users upgrade) | instant |
| Schema validation | yes (CI) | yes (build) | none |
| Review / audit | yes (PR + reason) | yes (PR) | none |
| Rollback | `git revert` + redeploy | new publish | manual, no transaction |
| Offline fallback | yes (CLI embed) | it *is* the embed | only if a baseline exists |
| Blast-radius safety | best | medium | worst |

Speed is not the binding constraint at monthly cadence; not breaking everyone is.
The DB editing path trades away validation, review, and clean rollback to save
minutes we do not need. Keep the catalog read path a pure function of the repo
baseline so a narrow, override-only DB layer could be added later if an incident
ever proves the deploy path too slow — but do not build it in Phase 1.

There is no runtime-editable config in `openmeld-db` today; a catalog table would be
net-new precedent, which is another reason to avoid it for now.

---

## 10. OpenClaw

OpenClaw stays a fully usable controller in Phase 1; we simply **do not build
model selection for it**. Its model is a per-agent persistent, auth-coupled
setting (`agents add --model`), unlike the per-session Claude/Codex model, and is
better treated as advanced configuration the user manages in their own OpenClaw
global config. OpenMeld passes no `--model` for OpenClaw and shows no picker. Adding
OpenClaw model support later is additive and does not change the Phase-1 design.

---

## 11. Owner-Doc Acceptance Check (Owed)

Per the project acceptance hard rule, any change touching service
state / availability / Wake routing / lifecycle must be checked against the
`developing/architecture/` owner docs **before delivery**, by actually reading
them. This has **not** been done yet for this feature. Before implementation, the
following must be explicitly confirmed against
[agent-transport-contract.md](../architecture/agent-transport-contract.md),
[local-openmeld-service.md](../architecture/local-openmeld-service.md),
[data-and-observability.md](../architecture/data-and-observability.md), and
[shared-contracts.md](../architecture/shared-contracts.md):

1. The new `/v1/config/model-catalog` RPC must not become a read-path liveness
   probe and must not feed availability judgment (catalog is config, not health).
2. Adding `model`/`reasoningLevel` to the daemon execution path must not alter
   the single liveness source of truth (ServiceRuntime).
3. Cloud must not validate models against local capability (cloud stores intent;
   the local runtime resolves reality).
4. Web may only record the intent; the local service applies it.
5. The selection must ride binding/`agentControllerRef` metadata, not a separate
   cloud field, and a controller rebind must invalidate a stale model.

If any rule requires a change, the owner doc must be updated in the same PR with
a reason.

---

## 11a. Decisions (resolved 2026-06-17)

1. **Bindable-candidate predicate — RESOLVED.** Neither client's current predicate
   is right. A controller is a **bindable candidate** iff it is (1) a
   supported/builtin controller, (2) detected/installed (registered) on the
   device, (3) enabled by the user, and (4) flagged `selectable` (honoring
   `selectableReason`). **Momentary readiness / `launchStatus` is NOT part of the
   filter** — it is time-varying liveness that belongs in the candidate's *display*
   (show ready / offline / needs-setup) and in the Wake/dispatch path, never in
   "can I bind a profile to this controller." Binding is a configuration act: you
   may bind to a configured controller that is currently offline; it runs when
   ready. Web's `launchStatus === 'ready'` is the wrong gate (it hides
   bindable-but-offline controllers); CLI's `registered && enabled` is closer but
   must also honor the explicit `selectable` flag and stay readiness-agnostic.
   `resolveSelectableCandidates` implements exactly this; carry `launchStatus` on
   the candidate as display metadata only. *Implementer: confirm the exact field
   semantics (`registered` / `enabled` / `selectable` / `selectableReason` /
   `launchStatus`) against `local-agent-catalog.ts` + `AgentTargetState`; the only
   legitimate non-readiness exclusion is `selectable=false` with a reason (e.g. an
   unsupported controller version).*
2. **transport-mode / response-policy on Web — RESOLVED.** Web **will** expose
   them; they are **not** permanently CLI-only. They live in the shared model and
   in Web's write path/contract with sane defaults, so the decision is shared.
   **Web UI rendering is deferred** (defaults apply until Web renders the controls)
   — this is a render-timing choice, not a logic fork. Include them in the shared
   `ProfileSelection` / view-model and the Web write contract from the start; the
   Web controls are a later UI increment.

---

## 12. To Verify Before Implementation (no guessing on vendor specifics)

1. Claude `--effort` legal level strings; that `--model` + `--fallback-model` +
   `--effort` all take effect together on `--resume`.
2. Codex `model_reasoning_effort` legal values; that `exec resume -m <model>` and
   `-c model_reasoning_effort=<level>` are both accepted on the resume subcommand.
3. OpenCode `--variant <level>` legal values from `opencode models --verbose`;
   OpenCode's Zen `/models` endpoint lists model IDs but not per-model variants,
   so catalog authorship must use the CLI's model metadata for variant support.
4. The current valid pinned-ID set per controller from
   `release/vendor-models.json`; do not duplicate model-family lists here.
5. Reasoning option strings must match each vendor's official values exactly.
6. Cursor catalog entries must be copied from the exact account-scoped ACP
   `session/new` model options. Legacy `cursor-agent models` identifiers and
   synthesized reasoning variants are not interchangeable with ACP model IDs.
7. Grok Build catalog entries and effort strings must be verified against the
   complete authenticated ACP inventory. The initial verified Grok Build 1.0.3
   catalog contains `grok-4.6` with `low|medium|high|xhigh` and `grok-4.5` with
   `low|medium|high`; account inventory remains the final pre-prompt gate.

---

## 13. Implementation Sequencing — three PRs split at the deploy-ordered boundary

The sizing pass (2026-06-17) found the sharp risk is **not** the client refactor —
it is the `strictObject` schema change in the model write path (§7.2), which can
break already-published CLIs and must deploy web→gateway→core. So split the work
where that risk lives, not by feature area. The client refactor is safe to do as
one shot (mechanical re-pointing onto unit-testable pure functions; the Web UI was
just stabilized in `ddc315b07` while the decision logic was untouched).

- **PR 1 — Shared profile-setup core + re-point (pays the debt).** New
  `packages/agent-runtime/src/profile-setup.ts` (`LocalAgentCandidate`,
  `resolveSelectableCandidates` = the one predicate, `buildProfileSetupViewModel`,
  `validateSelection`), unit-tested. Re-point CLI `agent-setup-flow.ts` and Web
  `create-profile-dialog.tsx` / `agent-binding-choice-list.tsx` onto it;
  centralize `agentControllerRef` construction (§6.3 Drift A). View-model carries
  empty model/reasoning for now — behavior identical, no plumbing yet. **Requires
  the §11a predicate decision first.** Owner-doc check: candidate filtering and
  ref construction touch Agent Profile Binding — confirm no liveness judgment moves
  into the filter (candidates already carry read-only `launchStatus`/`selectable`).
- **PR 2 — Catalog foundation + durable incident fix (ships alone).**
  `release/vendor-models.json` + schema + core `GET /v1/config/model-catalog` + CLI
  embedded fallback; the three adapter argv changes (Claude
  `--model`/`--fallback-model`, Codex `-m`) + Claude model-error classifier +
  `originLaunch` `{model}` token + late-binding default resolution. **Closes the
  production incident independently of everything else.**
- **PR 3 — Selection storage + sync + UI (deploy-ordered).** The `.optional`
  `strictObject` extension + DB columns + ensure-primary-binding RPC +
  route-catalog-sync extension + daemon resolution into `conversationPolicy`;
  deploy web→gateway→core. Reasoning wiring (catalog options → view-model →
  `conversationPolicy` → adapter flags, including OpenCode `--variant`). Then render the model+reasoning controls
  into the PR-1 view-model in both clients + `--view agent` JSON. **The §11 owner-doc
  check is mandatory here.**
- **Follow-on (separate, gated on §11a-2):** kind/name and
  transport/response-policy unification — only if a product decision says Web
  should consume them.

Do **not** fold PR 3's schema/DB/deploy-ordered plumbing into the PR 1 refactor.
PR 2 closes the production incident on its own and can ship first.

---

## 14. Touched-Surface Map

| Area | Path |
|---|---|
| Catalog manifest (new) | `release/vendor-models.json` |
| Catalog schema (new) | `packages/schemas/src/schemas/...` |
| Catalog serving (new) | `services/core` `GET /v1/config/model-catalog`; mirror `services/core/src/local-components/update-projection.ts` embed |
| Shared selection module (new) | `packages/agent-runtime/src/...` |
| API client | `packages/api-client/src/agent-profile-binding/` (+ catalog read) |
| Binding schema / DB / projection | `packages/schemas/src/schemas/http/agent-profile-binding.ts`, `packages/db/src/core/agent-profile-binding.schema.ts`, `packages/agent-runtime/src/agent-profile-binding.ts` |
| Daemon sync + resolution | route-catalog-sync payload + daemon ledger; resolution into `AdapterDispatchRequest.conversationPolicy` |
| Adapters | `runtime/adapters/claude-code/src/transport/claude-agent-sdk-transport.ts`, `runtime/adapters/claude-code/src/transport/claude-cli-transport.ts`, `runtime/adapters/codex/src/transport/codex-cli-transport.ts` |
| Launch templates | `config/agents/registry.json` (`{model}` token) |
| CLI agent view | `packages/schemas/src/schemas/cli/json-output.ts`, CLI profile commands |
| Web UI | `clients/web/src/components/profiles/` |
| Maintenance guide | alongside `config/agents/README.md` |
