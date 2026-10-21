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
4. **Runtime default per agent controller**, maintained through `defaultModelId`,
   remains the unset-profile default, never an explicit-selection fallback. Optional `creationDefaults`
   independently selects the model and reasoning proposed at first creation;
   without it, creation uses `defaultModelId` with model-default reasoning.
   Interactive selectors present the runtime default model once as
   `<model> (default)` rather than adding a second abstract controller-default
   option. Choosing an independent reasoning effort materializes the concrete
   model ID because reasoning validity is model-specific.
5. **Reviewed availability, never a shutdown clock.** The existing global
   `unavailable` flag remains. Optional `retirement` records an `announced`
   notice or a separately confirmed `withdrawn` decision, with exact controller,
   provider/sign-in scope, date meaning, HTTPS source and verification time.
   Announced dates are advisory even after they pass. Only a reviewed withdrawal
   with matching execution evidence blocks use. Keep old model identity and
   explicit selections; never silently replace them with the default.
6. **No computed "latest" concept.** The optional catalog-owned `badgeLabel`
   is reviewed presentation metadata, such as `New`, and appears beside local
   model options and the selected value. It does not change defaults, ordering,
   compatibility, model identity or reasoning. Reviewers add and remove labels;
   clients do not infer recency or expire labels on their own clocks.
   The catalog's model array is the reviewed display order, newest first.
   Collectors put new additions before existing models; reviewers confirm
   recency and relative order before publishing. Display order never changes
   `defaultModelId`, `creationDefaults`, or an existing Profile's selection.
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

   The October 9 native OpenCode 1.18.34 review adds Step 5 Preview Free through
   Zen and Go, and eleven additional Zen routes with exact native variant keys.
   Paid Zen metadata was captured with a noncredential placeholder; it does not
   establish account access. Step 5 Zen inference succeeded. Fledge's discovery
   status is deprecated, but no scoped withdrawal was confirmed; remove its New
   label without inventing a retirement notice. Discovery lifecycle changes now
   request review, and the collector also reads the official Zen and Go notices.
   Spark withdrawal is confirmed only for Codex ChatGPT sign-in by the official
   September 14 notice and an October 9 native rejection. API-key use remains
   outside that withdrawal scope.

   Antigravity is included in both catalogs. Its exact model IDs come from
   `agy models`; the September 22, 2026 CLI 1.2.7 capture lists 14 choices
   covering Gemini, Claude, and GPT-OSS. Gemini High/Medium/Low variants and
   GPT-OSS Medium are distinct native model IDs, not OpenMeld aliases.
   The hosted catalog must not omit a controller that exists only in the CLI
   offline snapshot: Web reads the hosted catalog, not the offline snapshot.
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
13. **First-use reasoning is a creation preference, not a runtime fallback.**
    The authored catalog's optional controller `creationDefaults` contains
    `{modelId, reasoningLevel}`; `null` reasoning means use the model default.
    The model must be available and any reasoning level supported. It currently
    recommends Codex's GPT-6.1 Sol / `medium`. Once the user creates an Agent, the
    existing per-user, per-controller creation defaults remember explicit model
    and reasoning choices, including `Use model default`. The public model
    catalog's public projection omits `creationDefaults`: Core supplies the
    resolved recommendation through the existing creation-preferences response.
    This preserves older clients' strict catalog readers. Changing this policy
    does not rewrite existing Bindings, remembered preferences, runtime defaults,
    or the harness's global configuration. Hosted controllers cannot declare it.

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

The online policy owner is `release/vendor-models.json`, reviewed in Git and
embedded only by Core. Core serves `GET /v1/config/model-catalog`; online CLI,
Web, and Desktop read this projection.

The CLI carries a deliberately fixed offline snapshot in
`clients/openmeld-cli/src/model-catalog/offline-catalog.json`. It is a fallback
for an unavailable or incompatible response, not a second live policy source.
Normal online catalog edits do not update this snapshot or change CLI/Service
bundle hashes. Existing saved profile selections remain unchanged.

### 5.3 Maintenance Workflow

The October 14, 2026 Gemini 4 review adds only captured channel identities:
Antigravity ACP `gemini-4-argon-medium`, Cursor ACP
`gemini-4-argon[reasoning_effort=medium]`, OpenCode
`openrouter/google/gemini-4-argon`, and hosted OpenRouter
`google/gemini-4-argon`. The first two encode reasoning in the model ID;
the OpenRouter routes support low, medium, and high. Native inventory and
OpenRouter capability captures live beside the catalog contract tests.
Account access remains provider-owned. Google API availability does not prove
OpenCode Zen/Go or other controller availability. Defaults and the fixed CLI
offline snapshot are unchanged.

The review account could select Argon through Antigravity ACP 1.3.0, but a
direct native prompt returned `Requested entity was not found.` as an assistant
message with `stopReason: end_turn`. The same account failed before publishing
a Space reply. This is not successful inference evidence or a global model
withdrawal. Cursor's review account rejected named-model inference because its
Free plan allows only Auto. OpenRouter routes have captured inventory and
request/tool-continuation contract coverage; this review does not claim paid
inference on those routes. Do not turn catalog availability into a promise of
account entitlement or silently switch a saved model after a provider failure.

1. Edit `release/vendor-models.json` to add or retire a model, change availability,
   defaults, or reasoning options within the supported catalog schema.
2. Review the PR and validate it against `packages/schemas`. In particular,
   default changes affect many users and must be reviewed explicitly.
3. Deploy the catalog through the guarded Core release scope. Existing online
   CLIs receive the new catalog without a local-component release.
4. A change to the offline fallback, schema readers, or local controller execution
   still requires the appropriate CLI release. Deploy accepting readers before
   new incompatible fields; current catalog schemas are strict. A remote catalog
   cannot add a missing local adapter or make an unsupported controller executable
   capable of running a model.

The release gate follows actual build inputs: the live catalog selects Core;
the offline snapshot remains part of the packaged CLI source. Do not refresh
both files mechanically on every model catalog edit.

#### Automatic evidence handoff

`.github/workflows/model-catalog-update.yml` runs on `main` every twelve hours
(`23 */12 * * *`, UTC) and supports `workflow_dispatch`. Change the single cron
expression to `23 */6 * * *` for six-hour checks. Scheduled runs can be delayed
by GitHub; this is a polling cadence, not a freshness guarantee.

The bot is deterministic collection and PR preparation, not an AI policy
reviewer. It needs no model API key or production credentials. Its GitHub token
needs repository contents and PR write permission, and repository Actions
settings must allow PR creation. It never approves, merges, requests Final
Candidate, installs a harness, starts a Wake, changes defaults, or deploys.

`scripts/model-catalog/sources.json` owns the five supported local controller
sources and verification hints. OpenClaw and hosted Center Agent policy remain
out of this collector's scope. Official Markdown documents and release notes
are captured with their URLs and observation time. Models.dev is discovery-only;
its provider IDs and reasoning metadata are not harness compatibility proof.
OpenCode discovery includes the curated OpenCode, OpenCode Go, OpenAI, Meta,
and OpenRouter providers. Meta and OpenRouter entries are review candidates,
not automatic catalog additions or proof of account access. Preserve each
provider's exact model ID, including nested names such as
`openrouter/meta/muse-wonder`, until authenticated OpenCode verification.
The configured `discoverySince` excludes historical, never-curated marketplace
models while retaining metadata for currently cataloged models. Keep this date
stable so a moving cutoff cannot hide an unreviewed candidate.

Codex has a deterministic adapter: resolve the latest stable GitHub release to
its exact source commit, read its bundled model catalog, and append previously
uncataloged picker-visible IDs with their official reasoning options and minimum
client-version field. Models.dev release dates before `discoverySince` make
historical backfills review-only; missing dates remain unknown, not a retirement
claim. Existing metadata differences and hidden models are review
items; the bot does not retire entries or infer account entitlement. Other
controllers currently produce evidence-only proposals until authenticated
harness IDs/variants are established by the reviewing agent. No guessed mapping
is treated as an automatic catalog edit.

Run the identical collector locally without modifying the catalog:

```sh
node scripts/model-catalog/collect-update.mjs dev-tmp/catalog-update
```

It writes a proposed catalog, schema-validated evidence, and a ready-to-read PR
brief. `scripts/model-catalog/publish-update.mjs <output-directory>` publishes
only from a clean `origin/main` checkout and only the recorded additions plus
`release/model-catalog-evidence/<controller>.json` for all configured harnesses.
One Actions job collects the harnesses independently and prepares one combined
draft PR, with a section for each harness. A failed source preserves successful
collection artifacts but prevents publication of an incomplete scan. Source
failures never mean model retirement. The brief lists uncataloged discovery
candidates, exact automatic additions, source discrepancies and bounded official
excerpts; full snapshots remain available for review. The repository formatter
keeps unrelated catalog formatting out of the diff.

A new draft requires a model addition, a newly observed discovery candidate or
reasoning option, a new existing-model parameter/visibility discrepancy, or a
changed retirement passage about a cataloged model. Discovery recommendations
require declared text output and tool calling; media-only models and incomplete
capability metadata remain in raw evidence without opening a PR. Changes to the
discovery reasoning options of an already cataloged model are review hints only,
compared with the previous observation, never guessed harness parameters.
Compare these review facts
with the last committed evidence snapshot. Repeated candidates and discrepancies,
collection timestamps, harness releases, unrelated documentation and marketplace
metadata changes do not create proposals. Every scan still preserves its raw
evidence and review brief in the Actions artifact, including scans with no
substantive changes. A changed or removed retirement passage requires review;
the collector never treats it as an automatic retirement or withdrawal decision.

An announced retirement with a reviewed date also requests one recheck when a
successful scan reaches that UTC date and the notice has not been verified on or
after it. This applies to both `on` and `not_before`: neither is proof of actual
withdrawal. The due fact is stable across later scans, so the existing merged
snapshot / declined fingerprint rules suppress repeated proposals. A reviewer
records the observed outcome and updates the notice's date, status or
`verifiedAt`; confirmed withdrawn notices need no date reminder.

The PR and Actions summary lead with only new review items relative to the last
committed evidence, their source facts and a concrete verification action.
Unchanged candidates and notices are folded into the full scan reference.
The same comparison controls publication and the summary, including publication
recovery from an already-pushed branch. The proposal fingerprint hashes that
same actionable delta, not all observed metadata, so first observations of
already cataloged model metadata cannot reopen a declined candidate.
No new facts means no new PR; evidence
artifacts and an existing review's latest-scan comment remain available.

Actions uses its existing token only for `api.github.com` requests to avoid
shared anonymous rate limits. Local collectors may supply `GH_TOKEN`; the token
is never sent to model discovery or vendor documentation hosts.

Run `pnpm verify:model-catalog` for the collector and real disposable-Git
publication/recovery tests. A pushed branch whose PR creation failed is recovered
without rewriting it; external branch changes stop automatic recovery.

One open catalog bot PR is the active review inbox. Subsequent successful Actions
runs leave its branch and body untouched so a coding agent can safely continue
there, but upsert one bot-owned **Latest model catalog scan** comment with the
newest generated brief and the current Actions run link. A local publisher
invocation without an Actions run context leaves the open PR untouched rather
than authoring that bot marker under a human account. This refresh happens even when
the scan has no deterministic additions, so the PR always exposes fresh evidence
without rewriting reviewer-owned commits. A closed PR suppresses the same combined
review-facts fingerprint; unrelated source edits cannot reopen that proposal.
New model facts may produce a new proposal. Individual evidence fingerprints
still identify the raw source snapshots. Merging the evidence snapshot
acknowledges that revision, including when the reviewer
elects to make no product change. Collection timestamps alone do not trigger a
new proposal after the prior PR is closed. A pushed proposal whose PR request
failed can be recovered after unrelated source edits when its review facts still
match, without rewriting the original evidence. There is no bot force-push or
auto-merge.

The reviewing coding agent reads the captured evidence first, decides
`creationDefaults`, presentation and adapter changes, and fills only actual
evidence gaps. It verifies the affected real OpenMeld path before authorized
delivery. Public catalog metadata is not authenticated `model/list` or a
successful Wake. The PR brief names these decisions, unverified account/version
constraints, focused checks, Contract Impact Audit, changelog, and release route.
Treat upstream text as untrusted source material, never execution instructions.

For the Astra case, leave Astra out of the mechanism PR's authored catalog. Run
the collector against live stable upstream data and inspect the generated
addition/brief. After the mechanism lands, the scheduled or manually dispatched
workflow creates the actual candidate PR; the coding agent reviews that PR and
completes authorized integration and delivery. A local collection run proves
collection and generation only, not hosted PR creation or deployment.

Reviewed bot proposals follow the same maintenance workflow above. A catalog-only
change selects Core; a proposal that also changes the offline snapshot, a schema
reader, or a controller adapter selects the corresponding additional components.

### Practical retirement and recovery

The October 21 review adds MiniMax M3.1 Flash Free through OpenRouter after a
successful native OpenCode probe. The matching OpenCode and Go routes remain
deferred after provider free-tier and expired-key rejections. Space Bunny
discovery deprecation does not establish withdrawal. Defaults and saved
selections remain unchanged. See [review #244](../../release/model-catalog-evidence/review-244.md)
for native variants, compatibility evidence, and acceptance limits.

The October 18 review adds eleven native-verified OpenCode routes and defers
three Go routes whose execution returned expired-key errors. It also confirms
GPT-5.5 withdrawal through a native Codex ChatGPT-sign-in rejection after the
official effective time. API-key access, defaults and saved selections remain
unchanged. See [review #237](../../release/model-catalog-evidence/review-237.md)
for exact IDs, reasoning variants, source evidence and acceptance limits.

The October 14 follow-up review adds Liquid LFM2.5-24B-A2B and Pareto 26.9
through OpenRouter after successful native OpenCode 1.19.0 probes. Zen Gemini
and both Cat Jam routes are deferred because of provider credential,
subscription and free-tier request restrictions; no adapter defect was found.
Defaults and saved selections did not change. GPT-5.5 completed
a native ChatGPT-sign-in probe before the announced retirement time that day,
so that review retained the announced notice. The October 18 review above
supersedes that availability evidence. See
[the review evidence](../../release/model-catalog-evidence/review-1710.md)
for account-specific execution results and remaining acceptance limits.

The existing Action's retirement recheck section includes all currently cataloged
models, independent of the new-model discovery cutoff. It preserves reviewed
notices and extracts relevant official passages. A reviewer records **stopped,
postponed, or unconfirmed** in the PR before changing authored policy. Missing
inventory, generic 404s, failed collection and `not_before` dates are never proof
of withdrawal. Coverage gaps remain explicit; the collector cannot claim to
monitor unconfigured controllers. Automatic publication remains additions-only.

The reviewed cases include Codex `gpt-5.4` and `gpt-5.4-mini` (withdrawn from
ChatGPT sign-in on 2026-08-31), and `gpt-5.5` (October 14 withdrawal confirmed
on October 18). The
[official source](https://learn.chatgpt.com/docs/models#deprecated-codex-models)
was rechecked on 2026-09-23. These notices do not disable API-key access or
same-name models in other controllers. The default model is unchanged.

Core composes applicable confirmed model unavailability into existing Wakeability
and dispatch admission. It does not rewrite Profile status, Binding selection,
manual disabling, history or an in-flight outcome. Fresh identity-matched account
reports establish sign-in scope; unknown scope is not proof of retirement. The
local route guard rejects explicit selections marked globally unavailable or
withdrawn for the entire controller, and supplies no fallback model. Route
construction has installation settings, not fresh sign-in/provider evidence;
it does not independently enforce account-scoped withdrawal. Do not infer that
scope from a controller name, launch configuration, or old account snapshot.
A registered route is not Wake admission: Core remains the scoped decision
owner. Unset native Codex resumes remain native; OpenMeld does not guess
that thread's effective model. Provider failures on that path still receive
recovery guidance, not a fabricated global retirement verdict.

Model settings show the notice and retain an unavailable current selection.
Wake failures and Agent recovery actions open that exact Profile. The model card
is labeled **Change model** when a relevant notice exists. A viewer known not to
manage the Agent is told to ask its owner. Codex's captured model-not-found and
ChatGPT-account-unsupported responses map conservatively to `model.unavailable`;
they do not establish retirement or persist a global provider/account blocker.

Normal accepted controller reports, successful user model edits, and explicit
unbinding reconcile one source-owned Inbox issue per affected Profile/model
episode. Owner-only source facts name both `agentProfileIds` and the exact
`personalAgentProfileIds`; normal Inbox access checks still verify current
personal ownership and Organization before listing or counting an item. It is
ordinary Needs action, not urgent email. Projection uses the current Binding rather than
an old report's model, deduplicates refreshes, and resolves only the relevant
model issue after a change. Unknown same-model account evidence retains the
issue. A successful authoritative read that finds no enabled Binding clears the
model issue; a failed read or unverified owner does not. Unbind reconciles while
holding target-mutation admission, including no-op retries after an earlier
projection failure. Read state and historical rows stay intact; no old work is
resumed.
Unscoped legacy Profiles retain inline recovery but do not gain a guessed
Organization Inbox destination. Offline Profiles are reconciled when their normal
account report returns; this is not an immediate global notification sweep.

#### Retirement contract rollout

New clients request `GET /v1/config/model-catalog?retirement=1`; legacy requests
receive the unchanged strict version-1 shape with retirement omitted. Core RPC
accepts the equivalent optional read preference. New clients tolerate an old
server returning the legacy projection. `creationDefaults` remains private.
New `model.retired` / `model.unavailable` routing reasons and short recovery copy
are shared schema/runtime contracts, not a new public availability enum. Deploy
accepting Core/Gateway readers before publishing the updated local Service/CLI;
Web readers may precede Core because the added metadata is optional. Older local
components retain their previous fallback/error behavior; this PR must not be
described as a pure catalog-only rollout or protection for all offline clients.
Core admission can block a known explicit selection with reliable legacy account
evidence, but missing evidence still does not authorize a guessed block.

No database migration, dispatch payload, permission contract, Service lifecycle
or automatic update policy changes. Local component changes need the normal
release manifest stamp and release-ready validation before publishing; production
smoke and release are separate from this Draft PR. No policy depends on a local
clock reaching the advisory date.

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
  turn. The current default is `anthropic/claude-opus-5.5` (**Claude Opus 5.5**)
  at `medium` reasoning.
- `hostedRuntimePolicy.personalRemoteAgentDefaultModelId` is the distinct
  system default for an unselected personal Remote Agent Binding and the model
  initially offered in its creation form. It is `openai/gpt-6-sol` (**GPT-6
  Sol**) at `medium` reasoning. Both defaults reference the same hosted model
  list; there is no second model catalog. Public catalog callers opt in with
  `personalRemoteAgentDefault=1`; the legacy response omits the new field so
  published strict-schema CLI clients continue to read the catalog.
- The curated list covers seven model vendors: OpenAI (GPT-6 Astra, GPT-6 Sol, GPT-5.6 Sol,
  GPT-6 Astra (Pro mode), GPT-6.1 Sol, GPT-6.1 Sol (Pro mode), GPT-6 Luna,
  GPT-5.6 Terra, and GPT-5.6 Luna), Anthropic (Claude Fable 5.1, Claude Fable 5,
  Claude Opus 5.5, Claude Opus 5, Claude Sonnet 5.5, and Claude Sonnet 5), Google (Gemini 3.8 Flash,
  Gemini 3.5 Flash Lite, and Gemini 3.1 Pro Preview), DeepSeek (V4.1 Flash and
  V4 Flash), xAI (Grok 4.7, Grok 4.6, and Grok 4.5), Z.ai (GLM 5.3 Flash), and Meta (Muse Wonder). Exact
  OpenRouter IDs remain in `release/vendor-models.json`; a preview model remains
  labeled Preview.
- Meta Muse Wonder uses the exact OpenRouter ID `meta/muse-wonder` for both
  Center Agent and personal Remote Agent. The 2026-10-13 provider capture confirms
  a 1,048,576-token context, text/image input, and six reasoning efforts from
  `minimal` through `max`. OpenMeld keeps its 16,384-token output budget and
  `medium` default. A live gateway probe completed a tool call and its result
  continuation. Meta currently accepts only automatic tool choice; the hosted
  adapter retains that behavior. Native OpenCode 1.18.34 also lists
  `openrouter/meta/muse-wonder` after refreshing its inventory. This confirms
  the native model ID and variants, not local account credentials or inference.
  The direct Meta provider remains discovery evidence until the installed
  native controller exposes it.
- A hosted model may declare one optional `badgeLabel` as catalog-owned
  selector presentation metadata. Core projects the same label onto the
  explicit model choice and the OpenMeld-default choice when that model is the
  current default; clients render it without inferring freshness from model ids
  or version names.
- Each hosted model declares its OpenRouter model id, input modalities, context
  window, output budget, and reasoning level. Admission freezes these values
  into the turn request; the worker does not rebuild them from mutable catalog
  state.
- Each hosted model declares its supported reasoning efforts and a catalog
  default. A nullable Binding `reasoningLevel` selects a supported effort for
  that model; absent means the catalog default. Core validates the pair and
  freezes the effective effort into each admitted route. Web, CLI, and Center
  Agent tools use this same selection contract. The catalog default is `medium`
  where the provider supports it; GLM 5.3 Flash and the two DeepSeek Flash
  models retain `high` because they do not offer `medium`.
  Saving an explicit effort with the Center Agent **OpenMeld default** preference
  materializes the current default's concrete model ID in Core. The saved
  preference then names that model, so a later system-default change cannot
  silently apply the effort to a different model. Selecting **OpenMeld default**
  with no explicit effort restores catalog-following behavior.
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

The September 14, 2026 expansion preserves the existing default, vision helper,
and all saved model IDs. New entries use captured OpenRouter `/api/v1/models`
metadata for text/image input, the smaller of the catalog and top-provider
context limits, and support for `tools` and reasoning effort `high`. The
OpenMeld output budget remains 16,384 tokens. Evidence fields are retained in
`services/remote-agent/tests/fixtures/openrouter-center-agent-models-2026-09-14.json`.
The focused runtime test resolves each catalog route and serializes a tool
continuation through the actual provider adapter before network dispatch.
This proves local contract compatibility, not live provider availability or
successful hosted execution for a particular account.

The September 22 expansion adds GPT-6 Astra, GPT-5.6 Sol, Claude Fable 5.1,
Claude Fable 5, and Grok 4.7 using the same capacity and reasoning policy.
Their captured OpenRouter metadata is retained in
`services/remote-agent/tests/fixtures/openrouter-hosted-models-2026-09-22.json`.
Both Center Agent and personal Remote Agent choices use this hosted catalog;
there is no second Remote Agent model list. Shared edit capabilities, Web model
editing, and Core Binding validation resolve `hosted:remote-agent` to the
`center-agent` catalog through `getAgentControllerModelCatalogId`; the actual
Remote Agent controller and Binding identity remain `hosted:remote-agent`.

The September 22 model expansion required no catalog schema change. The
subsequent reasoning control adds optional supported-effort fields to the
Center Agent model configuration response and accepts an optional effort in
its update request. Remote Agent model and effort changes use the existing
owner-authorized Binding command and execution admission. Deploy a compatible
Web reader before Core emits the expanded response, then deploy the Remote
Agent worker's model-discovery tool after Core. Existing local Agent settings
and already admitted hosted executions retain their frozen routes.

The later default change selects Claude Opus 5.5 for an unset Center Agent
Binding and GPT-6 Sol for an unset personal Remote Agent Binding. An explicitly
selected Binding model remains pinned. Core resolves the runtime-specific
default before freezing each new turn, so changing the catalog does not rewrite
or reroute work already admitted.

### 5.6 GLM 5.3 Flash hosted verification

The 2026-08-27 default change follows the official OpenRouter contract:

- the pinned model id is `z-ai/glm-5.3-flash` (**Z.ai: GLM 5.3 Flash**);
- OpenRouter reports input modalities text, image, and video with text output;
  the Center Agent declares only `text` and `image` because the hosted runtime
  never sends video parts and the schema bounds modalities to what the worker
  actually consumes;
- the supported reasoning efforts are `max`, `high`, and `low` with `max` as
  the provider default; the OpenMeld catalog default for this model is `high`
  because the provider does not offer `medium`;
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

At this refresh, `x-ai/grok-4.6` remained the dedicated
`imageUnderstandingModelId` while the primary default changed independently.
The later auxiliary-model change selects `openai/gpt-6-luna` at medium
reasoning. GLM 5.3 Flash is declared `["text", "image"]` to reflect the verified
provider capability and selector contract, but current-version images still
pass through the frozen auxiliary route before GLM receives the bounded text
description. Explicitly selected Grok 4.6 turns remain Grok 4.6 as the primary
model; the auxiliary route remains GPT-6 Luna.

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

### 5.8 September 22 local model refresh

Authenticated Cursor 2026.09.18 ACP returns
`grok-4.7[context=256k,reasoning_effort=high,fast=true]` in matching model
config options and legacy session inventory. Its reasoning remains part of the
exact ID; no independent effort selector is introduced.

Grok Build 1.0.40 returns `grok-4.7` and `grok-4.7-build-fast` in both
initialize and session inventories, with `low`, `medium`, `high`, and `xhigh`
efforts. Its existing default remains `grok-4.6`; current account inventory
still gates every prompt.

OpenCode 1.18.31's refreshed provider inventory adds
`opencode/mimo-v2.6-flash-free`, `opencode-go/grok-4.7`,
`opencode-go/mimo-v2.6-flash`, and `opencode-go/mimo-v2.6-pro`.
Only Grok exposes separate variants (`low`, `medium`, `high`, `xhigh`);
the MiMo entries have none. Provider-shaped captures are retained in
`packages/schemas/tests/fixtures/local-model-catalog-2026.09.22.json`.

The same complete free-provider inventory no longer contains the former
default `opencode/mimo-v2.5-free`, and a direct invocation returns
`ProviderModelNotFoundError`. The default therefore moves to the successfully
invoked free successor `opencode/mimo-v2.6-flash-free`. The old entry is marked
unavailable. Existing explicit selections now require a user model change;
stored Bindings and preferences are not rewritten. Public discovery also lists
`opencode/deepseek-v4.1-flash`, but the observed free-provider inventory does
not expose it. That additional route is not authored from marketplace data;
the existing `opencode-go/deepseek-v4.1-flash` remains selectable.

These are online catalog changes served by Core. The CLI offline snapshot,
shared schemas, adapter protocols, and local-component version floors are
unchanged. Provider acceptance and an OpenMeld Wake remain separate evidence.

The 2026-09-29 manual review of OpenCode 1.18.33's local `opencode models
opencode --verbose` inventory found `opencode/longcat-2.5-preview-free` and
`opencode/space-bunny-free` with exact variant keys `low, medium, high` and
`low, medium, high, xhigh, max`, respectively. Both completed a direct
`opencode run --pure` prompt on the review machine. The catalog adds only these
verified free-provider routes. Other discovery candidates and routes in the
local inventory are not assumed usable by every member's account; a real
OpenMeld Wake remains deployment acceptance evidence.
For a client without a reported ACI model inventory, the new routes require
at least the observed OpenCode 1.18.33 version.

#### October 2 provider follow-up

OpenCode 1.18.34's exact provider inventory adds
`opencode/fledge-alpha-free` with `low`, `high`, and `max` variants. The observed
version is a conservative compatibility floor, not a claim that earlier releases
cannot expose the model through their live inventory. The same capture corrects
`opencode-go/qwen3.8-max` to expose `low`, `medium`, and `xhigh`. Go subscription
access remains a separate runtime requirement. The provider-shaped capture is
retained in `packages/schemas/tests/fixtures/opencode-model-catalog-1.18.34.json`.
These changes use the existing online catalog, model ID, and variant contracts;
the offline snapshot, adapters, defaults, and local-component release remain
unchanged.

#### October 6 provider follow-up

OpenCode 1.18.34's refreshed provider inventory reports
`opencode/ling-3.1-flash-free` with `low`, `medium`, and `high` variants, and
`opencode-go/space-bunny` with `low`, `medium`, `high`, `xhigh`, and `max`.
The provider-shaped capture is retained in
`packages/schemas/tests/fixtures/opencode-model-catalog-2026.10.06.json`.
Both entries use the observed 1.18.34 compatibility floor when live model
inventory is unavailable. Defaults and existing Profile selections do not change.

The same installed harness rejects the former `opencode-go/space-bunny-free`
ID with `ProviderModelNotFoundError`. Keep that historical ID unavailable rather
than renaming it to the paid Go route or rewriting stored selections. The separate
`opencode/space-bunny-free` route remains available in the refreshed free-provider
inventory. This is a route-specific correction, not a retirement of Space Bunny.

Go subscription access remains separate from model inventory. A direct invocation
on the review account returns HTTP 403 because it has no active Go subscription.
This account failure does not establish global model unavailability. Ling 3.1
completed native `opencode run --pure` prompts for all three reasoning variants
with the default permission configuration. The `high` probe also read a local
nonce file and returned its exact contents. Earlier probes with restricted tool
permissions returned HTTP 403 `FreeTierError`; those results do not establish
failure under the native default configuration. The capture retains the successful
responses and tool-use evidence. Inventory alone does not prove provider execution.
These are online catalog updates under the existing ID and variant contracts, with no
offline snapshot, adapter, schema, or local-component release change. Successful
provider execution and a real OpenMeld Wake remain separate acceptance evidence.

---

#### October 7 provider and freshness review

The online catalog adds `opencode/exo-free` with `high` and
`opencode/mistral-large-4` with `none` and `high`, using OpenCode 1.18.35's
native provider inventory. The observed version remains a conservative
compatibility floor. Exo Free appears without a paid Zen credential. Paid Zen
models are hidden by the native loader when no Zen key is configured, so the
Mistral inventory capture uses an explicit noncredential placeholder solely to
inspect native metadata. It proves the ID and variant contract, not account
access or inference. Mistral's official public-preview documentation and the
Zen model list corroborate that route. Exo's free-period data may be used to
improve the model, as stated in Zen's privacy documentation.

The existing authenticated Go inventory corrects `opencode-go/qwen3.7-plus`
to expose `high` and `max`. The separate free `opencode/space-bunny-free`
route remains active. A discovery-only paid `opencode/space-bunny` entry is
absent from the reviewed native Zen inventory and is not added; the existing
Go Space Bunny route and historical rejected Go free ID are preserved.

Cursor 2026.09.28's authenticated ACP `session/new` model list and model
configuration options agree on five additional exact IDs:
`gemini-3.7-flash[effort=high]`, `gemini-3.6-flash[effort=high]`,
`kimi-k3[reasoning=max]`, `glm-5p3[reasoning=high]`, and
`glm-5p3-flash[reasoning=high]`. These older models receive no New label.
Independent reasoning remains unsupported for Cursor. Missing historical
inventory entries alone do not justify withdrawing or replacing saved IDs.

Provider-shaped captures are retained in
`packages/schemas/tests/fixtures/opencode-model-catalog-2026.10.07.json` and
`packages/schemas/tests/fixtures/cursor-model-catalog-2026.10.07.json`.
The full freshness review retains New only for Exo Free, Mistral Large 4, and
Fledge Alpha Free from the October 1–6 release batch. Older aliases and channel
additions do not extend their underlying model's release date. The fixed CLI
fallback already has no New labels and needs no change. Codex Sol/Luna retain
their authenticated 0.155.1 compatibility floor; the bundled upstream 0.155.0
minimum is a different evidence boundary, not a reason to lower that floor.

Contract impact: this changes online catalog data and optional presentation
metadata under the existing schema. No adapter, offline snapshot, transport,
local component, database, default, or stored selection changes. Old and new
CLI/Service/Skills remain compatible with old and new Core/Gateway/Web. No
contract bump or deployment ordering dependency is required. Delivery selects
Core only. Inventory, provider execution, and OpenMeld Wake acceptance remain
separate evidence.

Acceptance on October 7: Exo Free completed a native file-read probe and an
OpenMeld Web-created Agent with explicit High reasoning returned the expected
answer through a real Wake in the isolated PostgreSQL lane. The matching trace
records one successful attempt, `reply_published`, and a delivered visible reply.
The Web model list
disabled Mistral on the Computer without Zen access. Qwen3.7 Plus exposed High
and Max in the edit dialog and retained saved Max after reload. The Web listed
all five Cursor additions and kept reasoning inside the exact model choice.
Cursor's native named
model probe was rejected because the review account is on a free plan that
permits only Auto; this does not establish global unavailability.

#### October 8 Haiku 5.5 review

The online catalog adds the October 7 release of Claude Haiku 5.5 across
Claude Code, Cursor, OpenCode Zen and Go, and the shared hosted catalog.

[Claude Code's official model configuration](https://code.claude.com/docs/en/model-config)
establishes `claude-haiku-5-5`, the 2.1.293 minimum version, and `low`, `medium`,
`high`, `xhigh`, and `max` effort values. The review machine has Claude Code
2.1.289 without a signed-in account, so no Claude Code inference is claimed.
The existing SDK transport passes the selected executable, model, and effort;
this addition needs no adapter or SDK change.

Authenticated Cursor 2026.09.28-64d2043 returns
`claude-haiku-5-5[thinking=true,context=300k,reasoning_effort=high]` in both the
session model inventory and the model config option. Its reasoning stays in the
exact ID. The named-model native probe is blocked by the review account's free
plan, which permits only Auto; inventory does not establish paid entitlement.

OpenCode 1.18.34's refreshed native metadata exposes
`opencode/claude-haiku-5-5` and `opencode-go/claude-haiku-5-5`, each with
`low`, `medium`, `high`, `xhigh`, and `max` variant keys. The version is the
observed compatibility floor. Paid Zen inventory uses an explicit noncredential
placeholder because no Zen credential is configured. The Go inventory uses the
existing credential. A native Go probe returns HTTP 403 because that account
has no active Go subscription; this is not global model withdrawal. No Zen or
Go inference succeeded. The vendor-shaped local capture is
`packages/schemas/tests/fixtures/haiku-5.5-local-model-catalog-2026.10.08.json`.

Captured OpenRouter metadata for `anthropic/claude-haiku-5.5` declares text/image
input, tool calling, a 1M context window, a 128K output limit, and the same five
efforts. The shared Center Agent and personal Remote Agent route keeps the
existing 16,384 output budget and uses `medium` by default. Its capture is
`services/remote-agent/tests/fixtures/openrouter-haiku-5.5-2026-10-08.json`.
The existing provider test verifies model registration and tool-continuation
serialization against that capture; it does not prove live inference.

All five choices receive New for the October 7 release. The existing October
1–6 labels remain appropriate; older channel additions receive no new labels.
Codex and Grok Build have no new candidates in the refreshed configured scan.
Codex Sol/Luna retain their authenticated 0.155.1 floor. GPT-5.5's October 14
retirement remains advisory and scoped to ChatGPT sign-in; it does not disable
API access or replace a saved model.

Contract impact: this changes data and optional labels in the existing online
catalog schema. Existing defaults, saved selections, offline data, local
components, transport, database, and provider adapters remain unchanged. Old
and new CLI/Service/Skills can read old and new Core/Gateway/Web catalogs.
Hosted admission freezes the selected route through the existing contract.
No contract bump or deployment-order dependency is required. Delivery selects
Core only. Real OpenMeld create/edit and Wake acceptance remain unverified.

### 5.9 Claude Opus 5.5

The September 23 catalog adds `claude-opus-5-5` for Claude Code 2.1.280
or later, as published in the official Claude Code changelog. Anthropic's
effort contract supports `low`, `medium`, `high`, `xhigh`, and `max`.
The existing Claude Code default remains unchanged.

Center Agent and personal Remote Agents share the OpenRouter route
`anthropic/claude-opus-5.5`. Captured OpenRouter metadata confirms tool calling,
text/image input, a 1M context window, and the existing hosted `high` effort.
OpenMeld retains its 16,384 output-token budget, below the provider's 128K
limit. This is a Core-served catalog addition; it changes neither the fixed
CLI offline snapshot nor any adapter or execution contract.

### 5.10 GPT-6 Sol and Luna

The September 23 refresh adds `gpt-6-sol` and `gpt-6-luna` for Codex.
An authenticated Codex 0.155.1 `model/list` establishes the exact IDs and
reasoning efforts: Sol supports `low`, `medium`, `high`, `xhigh`, `max`, and
`ultra`; Luna supports the same list except `ultra`. The catalog uses 0.155.1
as the verified client floor; it is not a claim about the earliest upstream
release that could run either model. Existing creation defaults stay unchanged.

The shared hosted routes are `openai/gpt-6-sol` and `openai/gpt-6-luna`.
Captured OpenRouter metadata establishes 1,050,000 context tokens, text/image
input, tool calling, and `high` reasoning. OpenMeld retains its 16,384 output
budget. Direct OpenAI Chat Completions has a separate tool/effort limitation;
OpenRouter is the actual hosted boundary and must pass live tool continuation
before support is claimed. The API model names alone are not adapter evidence.

The hosted auxiliary image route uses GPT-6 Luna at `medium` reasoning to
preserve accurate transcription and explicit uncertainty; the independent
session-title request uses `low` reasoning for its short, structured output.
Both efforts are in the captured OpenRouter model metadata at
`services/remote-agent/tests/fixtures/openrouter-gpt-6-sol-luna-2026-09-23.json`.
The title request omits temperature because that model's captured supported
parameters do not include it. Live image and title latency remain release
smoke evidence, not catalog assumptions.

### 5.11 October 1 channel additions

The reviewed online catalog adds Sonnet 5.5 for Claude Code, Sonnet 5.5 and
Opus 5.5 for Cursor, ten recent OpenCode provider/model choices, and Sonnet 5.5,
GPT-6.1 Sol, and GPT-6.1 Sol Pro for the shared hosted catalog.

Claude Code's [official model configuration](https://code.claude.com/docs/en/model-config)
requires version 2.1.284 or later for Sonnet 5.5 and supports the same five
efforts as Opus 5.5. Cursor 2026.09.28's authenticated ACP model config and
legacy session inventory agree on the exact compound IDs for both additions.
Their effort remains embedded in those IDs. OpenCode 1.18.33's provider
inventory supplies exact active IDs and variant keys for the Go and OpenAI
additions; its free `opencode` provider reports no additional model. The reduced
vendor-shaped captures live in
`packages/schemas/tests/fixtures/local-model-catalog-2026.10.01.json`.

Captured OpenRouter metadata establishes tool calling, text/image input, context
limits, and five supported efforts for the three hosted additions. They retain
the existing 16,384 output budget and start at `medium`. OpenRouter's Sol Pro
model route selects Pro mode upstream; OpenMeld uses the existing exact-model
route and effort contract. The hosted provider tests serialize a tool
continuation through that same adapter before network dispatch.

Marketplace candidates that are absent from the selected controller inventory
are not added. This includes the GPT-6 candidates for Cursor and the paid
models advertised under OpenCode's free provider. Historical uncurated models
and asynchronous batch routes remain outside this refresh.

All controller defaults, creation preferences, saved selections, fixed CLI
offline data, and adapter contracts remain unchanged. These checks establish
catalog and parameter compatibility, not successful inference or account
entitlement. Live inference and OpenMeld Wake smoke were explicitly waived by
the delivery owner for this refresh; Claude Code subscription access was
unavailable. Delivery selects Core only.

### 5.12 October 1 freshness review and hosted candidate audit

New is manually reviewed catalog metadata. Review the complete catalog when
adding models, including previous labels in other controllers and the CLI
offline snapshot. A new channel entry for an older model does not make the
underlying model new. Provider aliases and speed variants follow the underlying
model's release; an unknown release date does not justify a New label. Clients
still do not calculate or expire labels.

This review retains New for the September 25–29 release batch: GPT-6.1 Sol
(including its Fast and Pro routes), Claude Sonnet 5.5, and LongCat 2.5 Preview
Free. Remove the earlier labels across Codex, Claude Code, Grok Build, Cursor,
OpenCode, and the shared hosted catalog. The fixed CLI fallback retains its
model IDs and capabilities and removes only its stale GLM 5.3 Flash label.

The latest hosted GPT-6.1 Sol, Sol Pro, and Sonnet 5.5 routes were already added
by PR #1410. The October 1 production catalog inspection still returned
`updatedAt: 2026-09-30T01:12:59.582Z`, omitted those routes, and labeled GLM 5.3
Flash New; the authenticated Center Agent settings selector showed the same
choices. This is a Core catalog delivery gap, not a Web filter or a Claude Code
subscription requirement. Source support does not establish production delivery.

The hosted candidate audit also adds the existing OpenRouter route
`openai/gpt-6-astra-pro`. Its captured metadata in
`services/remote-agent/tests/fixtures/openrouter-models-2026-10-01.json` declares
tool calling, text/image input, a 1,050,000-token context, and five reasoning
efforts. It follows the existing Sol Pro registration and tool-continuation
path, keeps the 16,384 output budget, and defaults to medium. Its September 4
release does not receive New. The existing Opus 5.5, GPT-6 Astra, Fable 5.1,
Gemini 3.1 Pro Preview, Grok 4.7, and DeepSeek V4.1 Flash choices remain available;
the current provider inventory has no newer Google Pro route to substitute.

Contract impact: removing optional presentation metadata from the CLI fallback
does not change commands, setup, Wake, Space actions, diagnostics, provider
parameters, or transport payloads. Old and new CLI/Service/Skills work with old
and new Core/Gateway/Web; no ordering dependency or contract bump is needed.
The packaged CLI artifact changes; its eventual release policy can be available.
This unstamped feature PR uses the normal deferred release-readiness gate against its
exact main base. The final release must stamp and verify the packaged artifact.
Catalog delivery
still belongs to Core; shipping the offline cleanup also requires CLI delivery.
No runtime state, readiness, identity, admission, or execution authority changes;
the scoped architecture contracts remain intact. Live inference and Wake smoke
remain outside this PR's evidence, under the delivery owner's prior waiver.

Display hosted Pro routes as `GPT-6.1 Sol (Pro mode)` and
`GPT-6 Astra (Pro mode)`. OpenRouter's
[Sol route](https://openrouter.ai/openai/gpt-6.1-sol-pro) and
[Astra route](https://openrouter.ai/openai/gpt-6-astra-pro) use the same underlying
models with Pro reasoning mode. This is a compute mode, not a distinct base model
or a subscription tier. OpenAI's
[reasoning contract](https://developers.openai.com/api/docs/guides/reasoning#reasoning-mode)
keeps mode separate from effort: High, Max, and other effort settings do not
mean Pro mode. Retain the exact provider route IDs and existing effort controls;
the display label does not add a Codex option or change provider parameters.

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
  actually be used (uses the controller default only for unset new sessions;
  unavailable explicit selections return a rejection, not another model).
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

When a Local Agent has no saved model selection, its configuration summary says
`Controller default`. The catalog default describes new chats, not an observed
model in an existing chat. The configuration explanation makes this distinction
explicit. Only execution evidence may identify the model actually used by a turn.

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
| **Claude Code** ([Claude Agent SDK transport](../../runtime/adapters/claude-code/src/transport/claude-agent-sdk-transport.ts), legacy argv in [buildClaudeArgs](../../runtime/adapters/claude-code/src/transport/claude-cli-transport.ts)) | `model` SDK option / `--model <pinned id>` | `effort` SDK option / `--effort <level>` | No alternative fallback is passed for explicit user selections | Classifies invalid/retired models as `config.invalid`, temporary availability separately, and a signal-terminated CLI process as `provider.process_terminated` |
| **Codex** ([CLI transport](../../runtime/adapters/codex/src/transport/codex-cli-transport.ts), [App Server transport](../../runtime/adapters/codex/src/transport/codex-app-server-transport.ts)) | Explicit Binding selection: CLI `-m <pinned id>` (also on `exec resume`); App Server `thread/resume.model` and `turn/start.model`. New conversation with no selection: catalog default. Existing thread with no selection: omit the override. | Explicit Binding selection: CLI `-c model_reasoning_effort=<level>`; App Server `turn/start.effort`. Existing thread with no selection: omit the override. | Reject explicit unavailable selection before dispatch, without substitution | Captured model-access failures use `model.unavailable`; they are not global retirement proof |
| **OpenCode** ([buildOpenCodeArgs](../../runtime/adapters/opencode/src/transport/opencode-cli-transport.ts)) | `--model <provider/model>` | `--variant <level>` where the level comes from OpenCode model variants | Reject explicit unavailable selection before dispatch | Use OpenCode provider error classification; provider/model errors must stay visible |
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

### 8.2 Resilience — preserve the selected model

Reviewed unavailability rejects explicit intent before dispatch; a provider
model-access failure stays visible with the appropriate recovery action. Neither
case authorizes a different model or automatic rerun. The maintained controller
default applies only where the unset/new-session contract calls for it. A native
Codex resume without explicit intent keeps its thread-owned model.

A model failure is a **dispatch-level outcome**, never a service-down signal;
it must not affect liveness or reap a lease. Model compatibility and account
scope remain distinct: unknown evidence is not proof of retirement.

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
