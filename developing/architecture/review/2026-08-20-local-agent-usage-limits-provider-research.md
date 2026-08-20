# Local Agent Usage Limits Provider Research

## Agent Context

- Purpose: Preserve the dated provider research that decides which Local Agent
  usage-limit sources OpenMeld can safely collect without starting model work.
- Read this when: Implementing or reviewing Local Agent Usage Limits collection,
  provider adapters, fixtures, privacy filtering, or real-provider acceptance.
- Update this when: A cited provider contract changes before the feature ships.
  Enduring product and architecture requirements belong in the owner documents.
- Do not use this for: Current production behavior, account billing support,
  readiness, Wake policy, routing, or execution authority.
- Source of truth: This file is research evidence only. The product and
  architecture owner documents remain authoritative.

Date: 2026-08-20

Status: RESEARCH COMPLETE — this PR implements the contract; merge and release
acceptance remain pending. This file does not claim production availability.

Remove when: Local Agent Usage Limits ships and all enduring provider,
normalization, privacy, and freshness rules have been incorporated into the
appropriate owner documents.

## Research Question and Safety Bar

OpenMeld needs current provider capacity evidence for the five Local Agents in
the built-in registry: Codex, Claude Code, Cursor, OpenCode, and Grok Build. A
source qualifies only when it is:

1. first-party and intended for the provider's own client or an integration;
2. machine-readable without scraping terminal UI or a Web dashboard;
3. observable without creating a conversation, session turn, or model task
   solely for collection;
4. explicit about usage rather than inferred from a failed task; and
5. filterable before data crosses the local OpenMeld Service trust boundary.

The investigation did not read provider credential files or print credentials,
tokens, email addresses, account identifiers, subscription details, monetary
amounts, purchased balances, or payment configuration. Real probes allowed the
provider process to use its existing sign-in internally, requested no model
work, and projected only the usage fields named below before recording output.

## Decision Summary

| Provider | Native non-task source | Decision for first release | Evidence shape |
| --- | --- | --- | --- |
| Codex | Yes: App Server `account/rateLimits/read` | Supported for ChatGPT rate limits; feature-detect and report `unavailable` when the current sign-in cannot provide them | Multiple metered buckets, each with optional primary and secondary windows, direct used percent, and reset time |
| Claude Code | Partial: native Agent SDK `rate_limit_event` during an ordinary OpenMeld-launched turn | Passively supported when the provider supplies numeric utilization; otherwise `unavailable`, never `unsupported` | One reported window per event, optional 0–1 utilization normalized to 0–100, and optional reset time |
| Cursor | No supported source found | `unsupported` | Authentication/account status and model/ACP commands exist; no documented quota or usage-limit command |
| OpenCode | No normalized provider-capacity source | `unsupported` | `opencode stats` reports historical local session tokens and cost, not remaining provider capacity or reset windows |
| Grok Build | Yes: first-party ACP extension `_x.ai/billing` | Supported for a signed-in grok.com account; feature-detect because this is a vendor ACP extension | One current included-credit period with direct used percent and an RFC 3339 period end |

`unsupported` means the provider does not expose a supported service-readable
source to OpenMeld. It does not mean the provider has no limits or no human UI.
`unavailable` means a normally supported source could not provide an observation
for the current installation, authentication mode, or attempt.

## Provider Findings

### Codex — Supported

Codex App Server is the provider's documented integration surface. Its
experimental account API includes `account/rateLimits/read` and
`account/rateLimits/updated`. The read response contains both a compatibility
`rateLimits` snapshot and `rateLimitsByLimitId`, the authoritative multi-bucket
map. Each bucket can contain primary and secondary windows with `usedPercent`,
`windowDurationMins`, and Unix-second `resetsAt` values. The snapshot also has a
stable provider `limitId`, an optional human label, and reached-limit metadata.

Sources:

- [Codex App Server: rate limits](https://learn.chatgpt.com/docs/app-server#rate-limits)
- [Codex App Server overview](https://learn.chatgpt.com/docs/app-server)

Minimal OpenMeld integration:

- Reuse the existing Codex App Server process and initialize/account probe in
  `clients/openmeld-cli/src/local-service/inventory/agent-controller-interface.ts`
  and `runtime/adapters/codex`; do not launch a second process or a thread.
- Send `account/rateLimits/read` after App Server initialization. Do not send
  `thread/start`, `turn/start`, or any prompt method.
- Prefer `rateLimitsByLimitId`. Emit one normalized list item per returned
  primary or secondary window. Do not synthesize a missing window.
- Use `codex:<limitId>:primary` and `codex:<limitId>:secondary` as stable keys.
  A safe provider `limitName` may prefix the label. Otherwise derive a plain
  window label from the duration, such as `5-hour usage limit` or
  `Weekly usage limit`; never derive an account plan.
- Preserve the provider's direct percentage, clamp nothing, convert reset epoch
  seconds to an ISO timestamp, and generate `observedAt` only after a successful
  response is parsed.
- Poll the snapshot with normal local Service inventory/reporting. A later
  optimization may consume `account/rateLimits/updated`, but the documentation
  warns that rolling updates can be sparse, so a notification alone must not
  replace or partially overwrite the complete snapshot.

Real acceptance on 2026-08-20 used installed `codex-cli 0.148.0`. A sanitized
JSON-RPC harness started `codex app-server`, sent `initialize`, then
`account/rateLimits/read`, and received two metered buckets. The response proved
both a multi-window bucket and a weekly-only bucket. Exact live percentages,
reset timestamps, labels, and all account fields were intentionally omitted.
No thread, turn, or model request was created.

The generated first-party schema was also inspected without account access:

```text
codex app-server generate-json-schema --experimental --out <temporary-directory>
```

It includes `account/rateLimits/read`, `rateLimitsByLimitId`, and the direct
window fields above. This method is explicitly a ChatGPT rate-limit surface. An
API-key-only or other authentication mode that returns no compatible snapshot
must be `unavailable`, not zero percent, unlimited, or globally `unsupported`.

### Claude Code — Partial Native Passive Support

The earlier finding that Claude Code exposed only the interactive `/usage`
screen was outdated. Current Claude Code documents subscription `rate_limits`
in its status-line JSON after a normal provider response, and the public Claude
Agent SDK types an equivalent `rate_limit_event` in the message stream that
OpenMeld already consumes for ordinary Claude turns.

The SDK event is the safe first-release source because observing it does not
create another prompt, access a provider credential, or modify the user's one
global status-line command. It carries a provider window type, optional
`utilization`, optional `resetsAt`, and status. SDK utilization is a 0–1
fraction, unlike the status-line field's direct 0–100 percentage. OpenMeld
normalizes only finite values in the inclusive 0–1 range and retains only the
normalized limit item. It discards the raw event, session identifiers, overage,
credit, purchase, and payment fields before the evidence enters ACI.

Because the passive event itself has no stable account identity, the Service
reuses Claude Code's existing native `auth status` ACI command before retaining
the observation. That non-task check is only a same-account guard: its existing
owner-only auth snapshot stays outside every Usage Limit item, and an unknown or
different account discards the observation. The Usage Limit path never reads a
credential store, token, billing record, or raw account payload directly.

This source is intentionally partial. In the ordinary `allowed` state, the SDK
commonly omits `utilization`, and one event represents one window rather than a
complete account snapshot. OpenMeld therefore publishes a gauge only when the
provider returns numeric utilization. Missing utilization does not become 0,
100, unlimited, or a fabricated second window. A later warning or rejection
can provide usable native evidence; last-known numeric evidence keeps its
original `observedAt` and becomes stale normally.

Sources and the rejected alternatives are recorded in
[`2026-08-20-claude-code-usage-limit-workaround-research.md`](./2026-08-20-claude-code-usage-limit-workaround-research.md).
The primary first-party references are the
[Claude Code status-line contract](https://code.claude.com/docs/en/statusline)
and the
[Claude Agent SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/591a180a197a73ce90042a6f97a7c59c100d2c3a/CHANGELOG.md#L347-L350).

Installed `claude 2.1.237` and packaged Agent SDK `0.3.195` acceptance proved
that the public event type is available. A no-prompt SDK initialization emitted
no event, and the explicitly experimental usage control returned no rate-limit
snapshot; both remain unknown. OpenMeld did not run a model task for collection
and did not print live values or any account data.

OpenMeld must not install or wrap the user's status line, scrape `/usage`, run
`claude -p` for collection, read `.credentials.json` or Keychain, call the
private OAuth usage endpoint, parse failure text, or substitute transcript
token/cost estimates. Claude Code is now **passively supported when the native
SDK reports numeric evidence**, not permanently unsupported.

### Cursor — Unsupported

Cursor's official CLI reference documents authentication status (`status` /
`whoami`), account information (`about`), model listing, and ACP mode. Its full
slash-command reference has no usage or quota command. Installed
`cursor-agent 2026.08.11-e8db854` help matched those documents, and
`cursor-agent status --help` only described authentication status with text or
JSON output.

Sources:

- [Cursor CLI parameters and commands](https://cursor.com/docs/cli/reference/parameters)
- [Cursor CLI slash commands](https://cursor.com/docs/cli/reference/slash-commands)

OpenMeld must not treat `status`, `whoami`, or `about` as usage evidence, scrape
the Cursor dashboard, or infer remaining capacity from a failed Agent task. The
adapter should publish the same explicit unsupported item pattern, with stable
key `provider` within Cursor's controller-scoped list and no percentage or reset
facts.

### OpenCode — Unsupported

OpenCode's official CLI documents `opencode stats`, but defines it as token
usage and cost statistics for OpenCode sessions. These are historical local
consumption records, not the current capacity of an upstream provider. OpenCode
can route to many providers and its server API exposes provider and
authentication configuration, but it does not publish a normalized usage-limit
or reset-window endpoint.

Sources:

- [OpenCode CLI: stats](https://opencode.ai/docs/cli/#stats)
- [OpenCode Server API: providers](https://opencode.ai/docs/server/#provider)

Installed `opencode 1.18.18` help confirmed the distinction. OpenMeld must not
turn local token totals, cost totals, provider configuration, or prior task
failures into remaining quota. The adapter should publish an unsupported item
with stable key `provider` within OpenCode's controller-scoped list and unknown
percentage/reset fields.

### Grok Build — Supported, Version-Gated Native Extension

Grok Build's first-party source contains an ACP extension handler for
`x.ai/billing`, used by its own pager/desktop to display credits and usage. The
wire JSON-RPC method is `_x.ai/billing`, following ACP extension-method
encoding. The current response prefers `creditUsagePercent`, explicitly defined
as 0–100, plus `currentPeriod.type`, `currentPeriod.start`, and
`currentPeriod.end`. The same response deliberately contains billing and
account facts that OpenMeld must discard.

Sources, pinned to the inspected official repository commit
`19d42e35c07a9c9244f03f6df0c4c353f970d4f9`:

- [Grok Build billing response contract](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/extensions/billing.rs#L30-L124)
- [Grok Build billing handler and grok.com auth gate](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/extensions/billing.rs#L148-L227)
- [Grok Build ACP extension dispatch](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs#L2180-L2205)
- [Grok Build disables consumer billing for API-key and external auth](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/src/app/event_loop.rs#L1179-L1197)

The safe request and allowlisted response shape are:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "_x.ai/billing",
  "params": {}
}
```

```text
result.config.creditUsagePercent -> usedPercent
result.config.currentPeriod.type -> label selection only
result.config.currentPeriod.end -> resetsAt
successful response time -> observedAt
```

Minimal OpenMeld integration:

- Extend the existing `probeGrokBuildAcpInterface` flow in
  `runtime/adapters/grok-build/src/transport/grok-build-acp-transport.ts`.
  Its ACP v1 initialization already advertises no file reads or writes and then
  performs headless authentication. No terminal capability is required.
- After successful initialization/authentication, call `_x.ai/billing` on the
  same process. Do not call `session/new`, `session/load`, or `session/prompt`.
- Use the stable key `grok-build:included-credits`, independent of whether the
  provider changes the current period between weekly and monthly. Map known
  period types to `Weekly usage limit` or `Monthly usage limit`; use
  `Included credits` for an unknown or absent type.
- Accept only finite direct percentages in the 0–100 range and a valid RFC 3339
  period end. Do not calculate a percentage from deprecated monetary fields.
- Feature-detect the extension and fields. Older versions, API-key-only auth,
  an unauthenticated process, a method-not-found response, or a response missing
  the direct percentage should be `unavailable` for that observation.

Never retain or project `monthlyLimit`, `used`, `onDemandCap`, `onDemandUsed`,
`prepaidBalance`, `history`, `isUnifiedBillingUser`, legacy billing-period
fields, `onDemandEnabled`, `subscriptionTier`, provider auth data, or user IDs.
These are unnecessary monetary, payment, subscription, or account facts.

Initial research acceptance on 2026-08-20 used installed `grok 1.0.3`. Final
implementation acceptance reran the implemented adapter against installed
`grok 1.0.5`. In both cases, a sanitized ACP harness started
`grok agent --no-leader stdio`, initialized ACP v1 without file or terminal
capabilities, authenticated through the provider's own process, and sent
`_x.ai/billing`. The final run produced one normalized limit with a direct
percentage and reset evidence, and the field-allowlist check passed. Exact live
values were intentionally omitted. No session was opened and no model prompt
was sent.

The final Codex and Grok Build acceptance used a fresh temporary
`OPENMELD_HOME` and the built production adapter/projector code. It emitted only
provider name, native interface, stable limit keys, limit count, status, reset
presence, percentage presence, and the allowlist verdict. Codex produced three
normalized windows from two native buckets; Grok Build produced one normalized
included-credit window. Both projections contained only `key`, `label`,
`usedPercent`, `resetsAt`, `observedAt`, and `status`. Raw responses and live
values were neither logged nor retained by the acceptance harness.

## OpenMeld Integration Boundary

The repository already has one suitable authority path:

```text
Provider adapter
-> local OpenMeld Service Agent Controller Interface inventory
-> Runtime Agent Controller Report
-> Core-owned projection
-> Owner Local Runtimes
-> team-safe Organization Computers
```

Relevant current entry points are:

- `clients/openmeld-cli/src/agents/builtin-agent-controller-definitions.ts` for
  the five built-in provider definitions and native interfaces;
- `clients/openmeld-cli/src/local-service/inventory/agent-controller-interface.ts`
  for provider-specific ACI probing, together with
  `agent-controller-interface-keeper.ts` for the existing last-good snapshot
  policy;
- `clients/openmeld-cli/src/local-service/reporting/runtime-agent-controller-report-sync.ts`
  for per-controller Runtime Agent Controller Reports;
- `clients/openmeld-cli/src/local-service/reporting/agent-controller-interface-cloud-projection.ts`
  for the cloud privacy allowlist;
- `packages/schemas/src/schemas/runtime/agent-controller-interface.ts` for the
  shared cross-process contract; and
- `packages/schemas/src/schemas/http/organization-computers.ts` for the separate
  team-safe projection.

Usage limits should be an optional `usageLimits` list on the existing ACI
snapshot. They are provider capacity evidence only. They must not modify Agent
Profile, Binding, Wake readiness, RuntimeCoordinator execution, Agent Activity,
task routing, or command eligibility. Do not create a second Usage Limit store,
a Web-only response, or a Center-Agent-only query.

The owner projection may continue to include existing owner-only ACI account
labels under its current contract, but Organization Computers must construct a
separate allowlist that includes only normalized usage-limit fields. Copying the
owner ACI object and deleting a few known fields is not safe. Team-visible data
must never contain provider email, account label, auth type, credential/token,
subscription tier, monetary value, or payment state.

## Normalization and Honest State

Every normalized item needs one stable key, plain-English label,
`usedPercent`, `resetsAt`, `observedAt`, and status. Percentages always mean
0–100 used, never remaining. Missing provider facts remain null or absent.

Recommended state semantics:

| State | Meaning |
| --- | --- |
| `available` | A fresh provider observation contains a direct percentage below 100 |
| `exhausted` | A fresh direct percentage is 100; a provider reached-limit flag may validate this but must not create a second stored percentage fact |
| `stale` | Last-good direct evidence still exists, but `observedAt` is older than the owning freshness threshold or the Computer is offline |
| `unavailable` | The provider normally supports collection, but no usable current or last-good observation exists for this installation/auth mode/attempt |
| `unsupported` | No supported service-readable provider source exists |

`Low` is a presentation label derived from the one `usedPercent` fact and a
shared UI threshold; it is not another stored provider state. Likewise, the
system must not store both used and remaining percentages.

For an unsupported provider, emit one sentinel item labeled `Usage limits`,
with a provider-stable key, null percent/reset, and `unsupported`. Its
`observedAt` records when the adapter made that capability classification, not
a provider usage observation. A natively supported provider with no first-ever
usable response emits the equivalent `unavailable` sentinel.

After a successful observation, a later provider timeout, parse error, or
temporary failure must not erase the entire Local Agent. Keep the last-good
value and its original `observedAt`, then present it as `stale`, only when the
existing owner-only authentication evidence proves the provider account did not
change. A changed, signed-out, or unidentified account fails closed to the
current unavailable observation so one account's capacity cannot be projected
for another. The failure remains diagnostic evidence, not a replacement
percentage. A failure in one adapter must not fail inventory or reporting for
another controller on the same Computer.

The local Service should collect at the existing background ACI inventory and
Runtime Agent Controller reporting cadence. It must not collect during Wake by
starting a model, and freshness must not be based on Computer online state or
report receipt time alone. Core/UI must compare the original `observedAt` with
one explicit freshness threshold; an offline Computer may retain last-good
values only with the `stale` label.

## Required Fixtures and Acceptance

Provider fixtures must come from the official schemas/types or from sanitized
captures of the real non-task probes above. Tests should prove:

- Codex primary plus secondary windows normalize into distinct stable keys;
- Codex single-window and missing-window responses do not invent a second item;
- Grok Build exposes only direct percent/current period and rejects or discards
  all billing/account fields;
- Claude Code normalizes valid passive SDK events, retains no raw event or
  billing fields, binds retained evidence to the existing owner-only ACI auth
  snapshot, and leaves missing ordinary utilization unknown without invoking a
  task for collection;
- Cursor and OpenCode return explicit `unsupported` evidence without invoking
  their task entry points;
- a first native query failure is `unavailable` with no invented facts;
- a later native query failure preserves the prior value and original
  `observedAt` as `stale`;
- 100 is exhausted, a fresh near-limit value remains available at the contract
  layer, and UI `Low` is derived without a second stored percentage;
- one provider failure does not remove the Computer or sibling Local Agents;
- owner and Organization projections expose the same normalized limit facts,
  while Organization output contains none of the prohibited sensitive fields;
  and
- CLI/agent JSON reads the same projection rather than invoking a provider or
  scraping Web UI.

Real-provider release acceptance should rerun the two sanitized probes through
the implemented OpenMeld Service path, then verify the owner CLI JSON,
agent-facing JSON, owner Computers UI, and teammate Computers UI. Acceptance
must record method names and normalized field presence, not live percentages,
account details, or raw provider responses. The trace must prove no Codex
thread/turn and no Grok Build session/prompt was created.

## Limitations and Recheck Triggers

- Codex rate-limit APIs are experimental. Recheck the generated App Server
  schema and multi-bucket behavior when the packaged Codex minimum changes.
- Claude Code's headless Agent SDK coverage remains partial because ordinary
  `allowed` events may omit utilization. Recheck when Anthropic publishes a
  stable complete SDK snapshot; do not adopt the explicitly experimental usage
  control or claim the user's global status line automatically.
- Cursor becomes supportable only if Cursor publishes a non-task quota contract
  in CLI, ACP, or another first-party integration surface.
- OpenCode becomes supportable only if it exposes normalized current provider
  capacity; historical session token/cost statistics remain out of scope.
- Grok Build uses a vendor ACP extension rather than a standard ACP method.
  Feature-detect it and recheck the pinned source contract when the packaged
  minimum version changes. Billing for an API-key-only configuration is not the
  same as grok.com included-credit capacity and must not be inferred.

## Contract Impact Audit

Changed boundaries:

- the shared ACI snapshot adds optional `usageLimits` evidence inside the
  existing schema-version-1 snapshot;
- Runtime Agent Controller Reports can carry that optional evidence through the
  existing Service-to-Core JSON path;
- owner Local Runtimes can return the evidence only when the reader explicitly
  requests `includeUsageLimits=true`;
- the strict Organization Computers `details` projection adds the same optional,
  sanitized list only when Web or the Center Agent explicitly opts in; and
- built-in Codex and Grok Build adapters add non-task native probes, while the
  Claude Code adapter adds a sanitized passive observation from an already
  running ordinary provider turn. The internal adapter runtime-event union is
  additive and compiled with the same local component. No daemon execution
  authority, Prepare Session, Wake, Space action, diagnostics, Binding, Agent
  Activity, or RuntimeCoordinator envelope changes.

Mixed-version behavior:

- new Core, Gateway, Web, and CLI readers accept reports or responses from old
  Services because `usageLimits` and the owner read query are optional;
- old CLI readers omit `includeUsageLimits`, so new Core removes the additive
  field from their Local Runtimes response before the old strict schema sees it;
- old Web and Remote Agent readers omit their Organization Computers opt-in, so
  new Core removes the additive field from their strict team-safe response;
- new Web or CLI against an old Gateway/Core gets the existing response without
  usage evidence and continues to support setup, status, diagnostics, Computer
  controls, and Wake;
- when old Core rejects only the additive ACI member, new Service retries the
  same reports with `usageLimits` omitted; if old Core rejects the complete ACI
  shape, the existing compatibility retry still removes only that nested ACI
  snapshot rather than dropping the controller report;
- new CLI keeps legacy `agents show --json` output free of the additive field so
  an older Desktop parser remains compatible; the owner `computer` Agent View
  reads the complete owner projection, while `org computers` Agent View and its
  strict JSON envelope explicitly request the team-safe Organization projection;
  and
- mutation responses remain legacy-shaped while new Web invalidates and
  refetches the opt-in owner projection, preventing a control write from
  replacing the visible usage evidence with an incompatible response.

Release order:

The normal release planner may keep its existing component order. CLI/Service
may publish before or after the cloud readers because its bounded compatibility
retry preserves the old Core report contract. Web, Gateway, and Core may roll
forward independently because every expanded strict read is opt-in. The new
Remote Agent must deploy after Core because it is the component that begins
sending the new strict Center Agent tool input.

Rollback removes the new Remote Agent before rolling Core back. CLI/Service,
Gateway, and Web can otherwise roll back independently through the same
compatibility behavior. Existing stored reports remain additive JSON evidence
and need no D1 migration or data rewrite.

The CLI adds the read-only `org computers` command and strict
`organization.computers` JSON envelope, and the managed OpenMeld CLI Skill
documents that existing team-safe read. No Service handshake, daemon execution
epoch, Prepare, or Wake contract constant changes. The new CLI/Service artifact
is an advisory `available` update: older local components keep all existing
setup and Wake behavior but do not report Usage Limits or expose the new CLI
read. Repository policy keeps version bumps and manifest stamping on the later
publishing branch; this feature PR must still pass the base-aware
release-readiness verifier without hand-editing artifact hashes.
