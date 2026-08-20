# Claude Code Usage Limit Workaround Research

## Agent Context

- Purpose: Correct the earlier Claude Code provider finding and preserve the
  evidence for a credential-free, non-inference Usage Limit integration.
- Read this when: Implementing or reviewing Claude Code Usage Limit collection,
  Claude Code settings integration, privacy filtering, or provider acceptance.
- Update this when: Anthropic changes the Agent SDK `rate_limit_event` or the
  documented `statusLine.rate_limits` contract before the feature ships.
- Do not use this for: Billing, token-cost estimation, Wake readiness, routing,
  or execution authority.
- Source of truth: This file is dated research evidence. Product and architecture
  owner documents remain authoritative.

Date: 2026-08-20

Status: RESEARCH COMPLETE — this PR implements the sanitized passive Agent SDK
path. Merge, release, and a naturally emitted live numeric event remain pending.

## Executive Decision

The earlier conclusion that Claude Code has only an interactive `/usage` screen
is no longer correct for current Claude Code releases.

There are now two native passive surfaces, with materially different coverage.

The preferred OpenMeld surface is the public Agent SDK
`SDKRateLimitEvent`. OpenMeld already launches Claude Code through the Agent SDK,
so it can observe `type: "rate_limit_event"` in the existing message stream after
a real provider response. This requires no second prompt, no separate Agent
Session, no credential read, and no Claude settings mutation. It therefore
avoids the single global `statusLine.command` conflict entirely.

The event carries one applicable window at a time through
`rateLimitType`, an optional `utilization`, and an optional `resetsAt`. The SDK
type is public and is not marked experimental. In the current pinned package,
the possible capacity keys are `five_hour`, `seven_day`, `seven_day_opus`,
`seven_day_sonnet`, and `seven_day_overage_included`; `overage` is a billing
surface and is out of scope. Community fixtures and the provider response-header
contract show that event `utilization` is a fraction from `0.0` to `1.0`, not the
`0–100` value used by the status-line payload. OpenMeld must normalize it by
multiplying by 100 in a source-specific parser.

Important limitation: `utilization` is optional in the public type and is
commonly absent while status is simply `allowed`. Current headless reports show
that it is normally populated only for warning or rejected states. The event is
therefore the safest and lowest-maintenance path, but it cannot by itself promise
a live normal-range percentage or a simultaneous two-window snapshot. Missing
`utilization` is unknown evidence, never 0%.

Sources: [official Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript),
[current Agent SDK package 0.3.195](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.195),
[allowed events omit utilization](https://github.com/anthropics/claude-code/issues/41185),
and [current headless coverage report](https://github.com/anthropics/claude-code/issues/77018).

Claude Code 2.1.80 also added a documented, native `statusLine` JSON field for
Claude.ai subscription capacity. For Pro and Max subscribers, after the first
API response in an ordinary interactive Claude Code session, Claude Code passes
these fields to the configured local status-line command:

```text
rate_limits.five_hour.used_percentage
rate_limits.five_hour.resets_at
rate_limits.seven_day.used_percentage
rate_limits.seven_day.resets_at
```

The percentage is already in the required `0–100` used semantics and the reset
value is Unix epoch seconds. Anthropic says the status-line command runs locally
and does not consume API tokens. The command is invoked as a consequence of
normal Claude Code activity; installing or executing the command does not send a
prompt or start a model task.

Sources: [Claude Code status line documentation](https://code.claude.com/docs/en/statusline),
[Claude Code 2.1.80 changelog](https://github.com/anthropics/claude-code/blob/770933ea1ad2fa7b858191e397a65e6644771c64/CHANGELOG.md#L3242-L3245),
and [Claude Code usage-limit error documentation](https://code.claude.com/docs/en/errors#usage-limits).

Together, these sources are good enough to change Claude Code from permanently
**unsupported** to **passively supportable**, with explicit constraints:

1. The status-line source requires Claude Code 2.1.80 or newer; the official
   Agent SDK reference says `SDKRateLimitEvent` requires Claude Code 2.1.136 or
   newer, and OpenMeld currently pins an SDK package bundling Claude Code
   2.1.195.
2. Anthropic currently documents full status-line percentages for Claude.ai Pro and Max
   subscriptions, not every authentication or plan type.
3. No value exists before the first successful provider response in a normal
   Claude Code session.
4. OpenMeld should consume public Agent SDK events for OpenMeld-launched turns;
   it must not query Anthropic's undocumented OAuth endpoint.
5. OpenMeld must not install, replace, or compose a global user status line as
   part of automatic setup.

Both sources are passive rather than on-demand. They improve visibility only
when the member normally uses Claude Code, while preserving the product rule
that OpenMeld does not spend model capacity to measure model capacity.

## Preferred Path: Agent SDK `rate_limit_event`

The current OpenMeld dependency is `@anthropic-ai/claude-agent-sdk` 0.3.195,
whose public `SDKMessage` union includes:

```ts
type SDKRateLimitEvent = {
  type: "rate_limit_event";
  rate_limit_info: SDKRateLimitInfo;
  uuid: string;
  session_id: string;
};

type SDKRateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?:
    | "five_hour"
    | "seven_day"
    | "seven_day_opus"
    | "seven_day_sonnet"
    | "seven_day_overage_included"
    | "overage";
  utilization?: number;
  // Additional overage, credit, and payment fields intentionally omitted here.
};
```

The same type also contains overage status, disabled reasons, credit purchase
eligibility, and saved-payment-method state. Those are sensitive billing facts,
not Usage Limit capacity evidence. The collector must never persist, log, or
project the raw event. It should allowlist only `rateLimitType`, `utilization`,
and `resetsAt`, and stamp its own local `observedAt` when the event is received.

The SDK event is emitted as a consequence of a provider response in an existing
OpenMeld-launched turn. Creating a query solely to obtain it is prohibited. A
no-prompt SDK initialization produces no event, which must remain "not yet
reported." The public event avoids the status-line configuration conflict
because it is already part of the SDK async message stream that OpenMeld owns.

The exact safe mapping is:

| SDK `rateLimitType` | OpenMeld key and label | Required evidence |
| --- | --- | --- |
| `five_hour` | `claude-code:five-hour`, `5-hour usage limit` | finite `utilization` in `0–1`; multiply by 100; optional finite epoch-seconds `resetsAt` |
| `seven_day` | `claude-code:seven-day`, `Weekly usage limit` | same |
| `seven_day_opus` | `claude-code:seven-day-opus`, `Weekly Opus usage limit` | same |
| `seven_day_sonnet` | `claude-code:seven-day-sonnet`, `Weekly Sonnet usage limit` | same |
| `seven_day_overage_included` | no first-release projection | semantic and billing boundary needs separate owner decision |
| `overage` | never project | billing/paid-overage evidence is out of scope |

Do not use a magnitude heuristic such as “multiply values below 1, otherwise
treat them as a percentage.” The input source determines the unit: SDK event
fractions are normalized by the SDK parser, while status-line percentages are
normalized by the status-line parser. Reject SDK values outside `0–1` rather
than clamping them.

An SDK event without `utilization` is still useful for execution diagnostics,
but it is not sufficient for this product's gauge contract. Do not synthesize a
percentage from `status`, `resetsAt`, a failed request, or the provider's warning
threshold. Retain any older valid numeric evidence as stale; otherwise report no
numeric Usage Limit evidence.

The SDK also exposes
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`. The package itself
marks that control method and response shape experimental. A no-prompt
initialization was observed returning `rate_limits: null`. It must not be used
as the first-release collector, must not cause a throwaway query, and a null
result must never become 0%. If Anthropic later stabilizes it, its broad response
must still be reduced to an explicit capacity allowlist because it contains
subscription, cost, behavioral, extra-usage, currency, and credit fields.

## Why This Is the Real Limit, Not a Token Estimate

Anthropic describes `rate_limits` as Claude.ai subscription rate-limit usage:

- `five_hour` is the 5-hour rolling usage window;
- `seven_day` is the weekly usage window;
- `used_percentage` is the percentage consumed, from 0 to 100; and
- `resets_at` is the provider reset time.

The same official error guide tells users to use `/usage` or the status-line
`rate_limits` fields to inspect remaining allowance before hitting a plan limit.
That connects the status-line value to the account capacity that blocks future
requests, not merely to local tokens or API-equivalent cost.

By contrast, local transcript tools answer a different question. They read
message JSONL files, sum input/output/cache tokens, group events into local
5-hour blocks, and optionally compare the sum with a configured or inferred
token threshold. That can be useful for cost analysis, but it cannot reproduce
Anthropic's server-owned subscription quota.

The current `ccusage` source proves this distinction directly:

- it discovers Claude project logs under `~/.config/claude/projects` and
  `~/.claude/projects`;
- it parses local JSONL entries containing `usage`;
- it sums input, output, cache creation, and cache read tokens; and
- its block progress requires a user-selected token limit or a historical
  maximum rather than a provider-returned subscription denominator.

Sources: [`ccusage` Claude path discovery](https://github.com/ccusage/ccusage/blob/e87d63150e6ab9eb0d160197a916aed164afaeea/rust/adapters/claude/src/paths.rs#L12-L68),
[`ccusage` JSONL parsing and cost calculation](https://github.com/ccusage/ccusage/blob/e87d63150e6ab9eb0d160197a916aed164afaeea/rust/adapters/claude/src/lib.rs#L250-L305),
[`ccusage` token aggregation](https://github.com/ccusage/ccusage/blob/e87d63150e6ab9eb0d160197a916aed164afaeea/rust/adapters/claude/src/lib.rs#L118-L139),
and [`ccusage` block limit documentation](https://github.com/ccusage/ccusage/blob/e87d63150e6ab9eb0d160197a916aed164afaeea/docs/guide/blocks-reports.md#token-limit-tracking).

Therefore, OpenMeld must not populate `usageLimits` from `ccusage`, transcript
JSONL, local token totals, cost, burn rate, projections, a plan-name lookup, or a
failed request. Those values are not the capacity fact the product promises.

## Open-Source Ecosystem Findings

### Claude-Code-Usage-Monitor

`Maciek-roboblog/Claude-Code-Usage-Monitor` now demonstrates the safe native
pattern. Its `--statusline` mode receives Claude Code's JSON, extracts
`rate_limits`, atomically stores the latest capture, applies a 10-minute
freshness rule, and treats official data as higher-trust than its own local
estimate. It intentionally leaves weekly usage unknown when official evidence
is absent.

This is the strongest community validation because the project explicitly
separates three different facts:

- official status-line rate limits;
- local transcript estimates; and
- an opt-in experimental OAuth API result.

Sources: [official status-line capture](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/official.py#L1-L144),
[official-over-estimate projection](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/snapshots.py#L354-L412),
and [status-line CLI wiring](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/cli/main.py#L287-L316).

Its local estimate is not acceptable as OpenMeld Usage Limit evidence. The code
computes `used_percentage` by dividing local input/output tokens by a selected
token limit, labels it `local_estimate`, and derives reset/forecast values. The
same code deliberately leaves an inactive session unknown rather than calling
it zero. This is a useful model for honest fallback presentation, but OpenMeld's
first release must not project the estimate at all.

Source: [local estimate implementation](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/snapshots.py#L250-L346).

### Claude Code status-line projects

Current status-line projects increasingly prefer the documented callback. For
example, `ohugonnot/claude-code-statusline` reads the four native fields from
stdin and uses them before making any network request. This confirms that the
callback can support both windows and reset times without accessing account
credentials.

Source: [native field extraction](https://github.com/ohugonnot/claude-code-statusline/blob/d45b420cca872092f6beca6550feacf32e73d6df/statusline.sh#L105-L127).

However, the same project falls back to
`https://api.anthropic.com/api/oauth/usage`, reads the OAuth access token from
`~/.claude/.credentials.json`, and sends it as a bearer token. That fallback is
out of bounds for OpenMeld even though it can return 5-hour, 7-day, and some
model-scoped limits.

Source: [credential-reading OAuth fallback](https://github.com/ohugonnot/claude-code-statusline/blob/d45b420cca872092f6beca6550feacf32e73d6df/statusline.sh#L185-L225).

Other status-line tools use the same native pattern and cache the last callback
for cold-start display. That is useful corroboration, but it does not create a
second provider contract; Anthropic's documented fields remain the authority.
See [maprea/claude-statusline](https://github.com/maprea/claude-statusline/tree/017964020e4b786babd62d91944b17930d830aa5).

### ClaudeBar and terminal-screen probing

`tddworks/ClaudeBar` demonstrates the other common workaround: spawn
`claude /usage` in a pseudo-terminal, auto-answer trust/onboarding prompts,
render the terminal screen, and parse its text. Its own code confirms that this
probe creates Claude Code `SessionStart` and `SessionEnd` events that the app
must suppress. The probe also logs the rendered `/usage` output and reads
account information for display.

Sources: [`claude /usage` terminal probe](https://github.com/tddworks/ClaudeBar/blob/f7c9fc164425593dc4ea971cfd3cb33eeb71c6ff/Sources/Infrastructure/Claude/ClaudeUsageProbe.swift#L5-L118)
and [probe-created session events](https://github.com/tddworks/ClaudeBar/blob/f7c9fc164425593dc4ea971cfd3cb33eeb71c6ff/Sources/Domain/Session/SessionEvent.swift#L30-L37).

This approach can work for a dedicated personal menu-bar utility, but it fails
OpenMeld's product boundary. It starts a provider session, scrapes interactive
UI whose layout has already changed, can trigger trust-state writes, and risks
capturing account, plan, extra-usage, or payment text. It must not be used by the
OpenMeld Service.

### Direct OAuth usage tools

Several dashboards and menu-bar tools call the internal OAuth usage endpoint.
The pattern is consistent:

1. read a Claude Code OAuth access token from an environment variable, macOS
   Keychain, or `~/.claude/.credentials.json`;
2. send `Authorization: Bearer <token>` plus the private beta header; and
3. parse an undocumented response from `/api/oauth/usage`.

Even the latest Claude-Code-Usage-Monitor labels this source `experimental`,
requires explicit opt-in, and never lets it outrank the documented status-line
data.

Source: [experimental endpoint implementation](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/api_usage.py#L1-L33),
[credential read](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/api_usage.py#L182-L193),
and [authenticated request](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/blob/c59a83bf943f329f0e61f1a29c760353ee1860a5/src/claude_monitor/output/api_usage.py#L212-L283).

This endpoint fails OpenMeld's acceptance bar:

- Anthropic does not document it as a supported third-party integration API.
- Calling it requires OpenMeld to access a provider credential.
- Community polling has triggered persistent HTTP 429 responses with an
  unusable `retry-after: 0` value.
- The response can contain model-specific quota and extra-usage/billing fields
  that exceed OpenMeld's minimal capacity allowlist.
- Its shape and beta header can change without compatibility notice.

The public issue evidence is not itself an integration contract, but it shows
why copying this workaround would be fragile: [persistent OAuth usage endpoint
429](https://github.com/anthropics/claude-code/issues/30930).

ClaudeBar provides an independent implementation example: its API probe reads
credentials from Claude's file or Keychain, automatically refreshes them, calls
the OAuth usage and token-refresh endpoints, and maintains special backoff for
the endpoint's 429 behavior. This is useful evidence of how much private and
unstable machinery the direct approach requires, not a pattern OpenMeld should
copy.

Source: [ClaudeBar OAuth probe](https://github.com/tddworks/ClaudeBar/blob/f7c9fc164425593dc4ea971cfd3cb33eeb71c6ff/Sources/Infrastructure/Claude/ClaudeAPIUsageProbe.swift#L77-L145).

OpenMeld must not read, proxy, cache, refresh, or log Claude OAuth credentials.
It must not call this endpoint, even if the request would not invoke a model.

## Secondary Path: Interactive `statusLine.rate_limits`

The documented status-line payload is the richer native snapshot: it normally
contains both shared windows and percentages throughout the normal range. It is
valuable corroboration and may support a future explicit opt-in integration for
ordinary interactive Claude Code use outside OpenMeld.

It is not the default OpenMeld collector. Headless Agent SDK execution does not
reliably invoke the interactive status-line renderer, and Claude exposes one
global status-line command rather than an additive hook list. Automatically
claiming or wrapping that setting would create visible configuration ownership,
failure, uninstall, and latency obligations unrelated to Usage Limit
visibility.

If a future user-authorized integration supplies status-line evidence, the
capture boundary must parse an untrusted JSON object and retain only the
following allowlist.

```json
{
  "rate_limits": {
    "five_hour": {
      "used_percentage": 42.5,
      "resets_at": 1787191200
    },
    "seven_day": {
      "used_percentage": 18,
      "resets_at": 1787623200
    }
  }
}
```

Allowed input paths:

| Input path | Validation | Normalized output |
| --- | --- | --- |
| `rate_limits.five_hour.used_percentage` | finite number, inclusive `0–100` | key `claude-code:five-hour`, label `5-hour usage limit`, `usedPercent` |
| `rate_limits.five_hour.resets_at` | finite Unix epoch seconds | `resetsAt` ISO timestamp |
| `rate_limits.seven_day.used_percentage` | finite number, inclusive `0–100` | key `claude-code:seven-day`, label `Weekly usage limit`, `usedPercent` |
| `rate_limits.seven_day.resets_at` | finite Unix epoch seconds | `resetsAt` ISO timestamp |

`observedAt` is the time the local OpenMeld capture command successfully
validated a new callback caused by a provider response. It is not read from
account state and must not be refreshed by a polling loop replaying the same
payload. Any future implementation should leave `refreshInterval` unset so
Claude Code invokes the command only for its normal event-driven status-line
updates.

The parser must validate each field independently instead of coercing it. A
valid percentage may still be retained with `resetsAt: null` when a reset value
is absent, and a valid reset may be retained with `usedPercent: null` only if
that shape is useful for the existing contract. In particular,
Claude Code 2.1.118 was reported to place the reset epoch into
`used_percentage` before real five-hour data existed. A strict `0–100` check
turns that bug into unavailable evidence rather than a fake 100% limit.

Source: [Claude Code issue #52326](https://github.com/anthropics/claude-code/issues/52326).

The callback contains many fields that OpenMeld does not need, including
session ID, session name, transcript path, working directory, model, cost, and
worktree details. The capture command must:

- never persist or forward the raw stdin payload;
- never log the raw payload, even on parse failure;
- ignore every top-level key other than `rate_limits`;
- ignore unknown rate-limit window keys;
- avoid account, profile, subscription, cost, payment, and extra-usage data; and
- write only the four validated numeric primitives plus local `observedAt`.

No credential, token, email address, account ID, plan name, billing value,
workspace path, transcript path, session ID, or model choice may enter the ACI
report or Core projection.

## State and Freshness Mapping

The provider adapter should map native observations as follows:

| Native condition | OpenMeld result |
| --- | --- |
| SDK event with allowlisted window, finite `0–1` utilization, and optional valid reset | multiply by 100, then `available`, or `exhausted` at 100% |
| SDK event with `status: allowed` but no utilization | no new numeric evidence; retain an older value only as stale |
| SDK warning/rejection event with utilization | project the one reported window; do not invent other windows |
| Valid window in an explicitly authorized status-line callback | `available`, or `exhausted` when `usedPercent >= 100` |
| Valid last-known window but the Computer is offline or `observedAt` exceeds the product TTL | retain value and mark `stale` |
| No-prompt SDK initialization or callback before the first provider response | no numeric evidence; `unavailable`, never 0% |
| Supported version/auth mode but field is temporarily absent or malformed | retain last-known value only as stale; current collection is `unavailable` |
| Agent SDK event unavailable on the installed SDK/Claude Code version | fall back only to already-authorized native evidence; never probe |
| API-key, Bedrock, Vertex, Free, Team, Enterprise, or another mode not covered by Anthropic's Pro/Max guarantee | `unavailable` or `not reported by provider`; do not infer unlimited capacity |
| No valid native evidence has ever been observed | `unavailable`; this is not provider-wide `unsupported` |

The minimum supported version is based on Anthropic's changelog, not on
feature inference. OpenMeld should feature-detect the callback at runtime even
on newer versions because real regressions have been reported where
`rate_limits` disappeared temporarily in versions 2.1.96 and 2.1.119.

Sources: [missing field in 2.1.96](https://github.com/anthropics/claude-code/issues/45133)
and [missing field in 2.1.119](https://github.com/anthropics/claude-code/issues/53558).

The official callback currently guarantees only the shared 5-hour and 7-day
windows. Model-specific weekly windows and extra-usage balances seen in the
interactive UI or undocumented OAuth response must remain absent. OpenMeld must
not fill them from estimates or private endpoints.

## Why OpenMeld Must Not Own the Global Status Line

Claude Code exposes `statusLine` as one command object in settings, not as an
appendable hook array. The official documentation describes a single
`statusLine.command`; plugin settings currently support `agent` and
`subagentStatusLine`, not the normal `statusLine`. Therefore an OpenMeld capture
cannot be installed like the existing additive Claude lifecycle hooks.

Sources: [status-line configuration](https://code.claude.com/docs/en/statusline#manually-configure-a-status-line)
and [plugin settings limitations](https://code.claude.com/docs/en/plugins#ship-default-settings-with-your-plugin).

Community installers commonly overwrite `.statusLine` while preserving
unrelated settings. That is acceptable for a dedicated status-line product but
not for OpenMeld: replacing a user's existing status line would be an unrelated,
visible product regression.

The first-release implementation policy should therefore be:

1. Consume the Agent SDK event from OpenMeld's existing Claude transport.
2. Never install, replace, delete, or rewrite a user status-line command during
   automatic setup.
3. Treat status-line capture as a separate future opt-in capability, not as a
   required fallback for SDK evidence.
4. Any future user-authorized composition wrapper must pass the exact original stdin to the
   original command, preserve its stdout and settings fields, bound execution,
   restore the original configuration on uninstall, and fail open for the
   user's display while failing closed for OpenMeld evidence.
5. Treat project/local/managed settings precedence and `disableAllHooks` as
   runtime feature-detection failures rather than pretending the capture is
   active.

The SDK event removes this configuration problem for OpenMeld-launched turns.
Its tradeoff is data completeness: it may omit utilization in the normal
`allowed` state and exposes one representative window per event rather than the
complete status-line snapshot.

## Exact Recommendation for OpenMeld

Update the Claude Code provider decision from **Unsupported** to **Passively
supported when the native SDK reports numeric evidence**.

Implement only the following slice in the Local Agent Usage Limits PR:

- Observe public `SDKRateLimitEvent` messages in OpenMeld's existing Claude Agent
  SDK message stream. Do not create a query for collection.
- Allowlist only `rateLimitType`, `utilization`, and `resetsAt`; discard the raw
  event and all session, account, overage, credit, and payment fields.
- Normalize SDK utilization from `0–1` to the contract's `0–100` used semantics
  using the source-specific parser.
- Project only the window actually reported with valid utilization. Missing
  utilization or missing windows remain unknown.
- Reuse the existing Runtime Agent Controller Report and Core projections.
- Mark missing, malformed, never-observed, incompatible, or unconfigured cases
  unavailable; keep old valid evidence only as stale.
- Do not automatically install or modify `statusLine`. Preserve the documented
  status-line path only as research for a future explicit opt-in integration.
- Do not start a Claude session, call `query()` solely for collection, run
  `claude -p`, open `/usage`, scrape a terminal/Web page, parse failure text, or
  make a test prompt.
- Do not read `.credentials.json`, Keychain items, environment OAuth tokens,
  account metadata, subscription tier, or billing/extra-usage fields.
- Do not use local JSONL token/cost estimators as a fallback.
- Do not use the explicitly experimental SDK usage control method as the
  first-release source.

This recommendation does not claim that the SDK always provides a gaugeable
percentage. In ordinary `allowed` states it often does not. OpenMeld should show
fresh numeric data only when the provider actually supplies `utilization`, keep
last-known numeric evidence as stale, and otherwise show no gauge or unsupported
badge. The provider exposes a safe native signal, but current headless coverage
is partial.

## Acceptance Checklist

Before claiming Claude Code support, verify all of the following against a real
Pro or Max installation without printing the raw callback:

- The packaged Agent SDK version publicly types `SDKRateLimitEvent`.
- An ordinary OpenMeld-launched Claude turn emits any available event without an
  additional prompt or session.
- A no-prompt initialization emits no evidence, and an experimental usage
  response with `rate_limits: null` remains unknown rather than 0%.
- A captured real event proves whether `utilization` is present for the current
  account state; absence is accepted and tested as unknown.
- A fixture with `utilization: 0.85` becomes `85%`, while values below 0, above
  1, `NaN`, or infinity are rejected rather than clamped.
- Each reported window and reset time matches Claude's own usage view when the
  same provider evidence is available.
- The persisted local evidence contains only the allowlisted fields and
  `observedAt`.
- The ACI report, owner projection, team-safe projection, CLI JSON, and Web UI
  contain no status-line payload, credential, account identity, path, session,
  cost, or payment fields.
- Missing pre-response data renders unknown/unavailable, not zero.
- An epoch value in `used_percentage` is rejected.
- A missing callback or offline Computer leaves the last valid value visible as
  stale.
- Concurrent Claude sessions cannot partially write or corrupt the local
  evidence.
- Existing user status-line configuration is byte-for-byte preserved; the
  first release does not install or compose it.

The research did not read a Claude credential file, invoke `/usage`, or start a
model task. Real account acceptance remains an implementation-stage smoke gate,
not evidence supplied by this document.
