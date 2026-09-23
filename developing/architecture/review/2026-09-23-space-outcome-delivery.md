# Space outcome delivery — issue #1250

## Agent Context

- Purpose: Track implementation, remaining acceptance work, and evidence for first-line Space outcome delivery in #1250.
- Read this when: Continuing or reviewing Draft PR #1261 across worktrees and agents.
- Update this when: The candidate, validation evidence, or remaining acceptance scope changes.
- Do not use this for: Production acceptance, release authorization, or proof that every native controller was tested.
- Source of truth: The Space collaboration and Agent transport owner documents define behavior; this note records candidate-specific work and evidence.

Status: Implementation handoff in Draft PR #1261, with conditional native correction support as detailed below. Not production acceptance, universal automatic correction, or release authorization. Remove after independent review and acceptance evidence have been incorporated into owner documentation and the PR.

Work branch: `codex/issue-1250-space-outcome-delivery`, Draft PR #1261.
This is the first implementation line only. Organization-plugin exposure,
production changes, original-review replay, deployment, merge, and Ready are
not part of this change.

## Implementation checkpoint

The common recorder distinguishes positive pre-write rejection from an unknown
result, preserves exact replay, and exposes receipt reconciliation. Current
final catalogs and new Space policies use reply/silence; stored and frozen
status contracts remain unchanged. A per-invocation host capability shares the
same Zod definitions, authority checks and recorder across MCP and native
carriers, and is closed rather than retained as thread authority.

Claude has SDK in-process tools, eager final definitions, bounded connection
recovery, and delivery-only restrictions that preserve the selected mode. The
structured correction report contains only a receipt claim: publication still
requires the native tool (including its approval/denial checks), and the host
verifies the saved receipt independently. A structured public-text fallback
would risk bypassing those native checks and is deliberately not used.

Codex now prefers one Dynamic Tools carrier on the verified native protocol,
using the current invocation's common capability and recorder. Configuration
with native approval/deny rules, a custom permission profile, managed requirements,
or unknown policy fields stays on MCP; none of those settings are overwritten.
Saved dynamic definitions do not retain authorization. Callbacks are fenced by
the actual active thread and turn, cancellation and the current tool catalog.
Only a decoded pre-thread argument rejection can select MCP after trying the
new interface; ambiguous execution or a lost tool receipt never replays a turn.

The resumed implementation adds the missing operation boundaries rather than
using PLAN as a correction mode. Full prior output is supplied as private
context to isolated correction sessions. The normal publication/receipt path
remains the only writer; no private prose is automatically published.

## Current implementation matrix

| Carrier | Missing-action correction | Scope and compatibility |
| --- | --- | --- |
| Claude Agent SDK | Native in-process tools and disposable fork | Preserves selected mode, eager final definitions, no business tools or hooks; a structured report is checked against the real local receipt. Native deny and approval remain authoritative. |
| Codex App Server | Native Dynamic Tools or policy-preserving MCP in a disposable fork | No execution environments, foreign MCPs, apps, web, hooks or delegates; selected mode retained. Unsupported versions/managed requirements stop before a turn. Legacy CLI correction is guarded. |
| OpenCode server | Native pure-mode fork | Copies original permission rules and appends negative non-delivery rules; reads them back before the prompt. No forced final-tool grants or external plugins. |
| OpenClaw local | Fresh native session and temporary verified plugin configuration | Shared current schemas and persistent dispatch MCP connection; business tools/external plugins disabled, explicit deny preserved, original canonical session unchanged. |
| Cursor ACP | Explicit safe stop before controller/session execution | Current adapter has no verified delivery-only scope; it does not replace the user's mode with Ask/Plan. Normal reply and input correction remain supported. |
| Grok Build ACP | Fresh native restricted-agent session and temporary config snapshot | Verified native tool/permission sources, preserved selected mode and original deny/ask rules, delivery MCP only. File-backed use_tool input is denied natively. Incompatible ambient hooks/plugins/configuration still stop before a prompt. |
| Antigravity CLI | Explicit safe stop before controller/session execution | JSON output constraints do not restrict prior business actions. Normal structured final outcomes remain supported. |

The Cursor and Antigravity rows are implemented compatibility guards, **not
successful automatic correction**. This follows the agreed rule that an unverified carrier
must not rerun business work. Independent review must keep this product limit
visible; do not close #1250 or mark Ready on a claim that all seven carriers have
equivalent successful recovery. Extending those two native paths requires
new verified operation boundaries rather than weakening the guard.

## Grok ACP implementation checkpoint

Grok 1.0.40 (eb1a2256660d) now supports conditional native delivery correction.
The adapter creates a fresh session, supplies the current tool schemas, and
verifies the selected profile, empty hook inventory, and exact ready MCP catalog
before submitting a prompt. It does not resume or replace the canonical session.

Native experiments found that root CLI deny flags and GROK_CONFIG overlays do
not enforce Read restrictions in ACP. The native use_tool wrapper accepts file
arguments even when no file tool is offered. The implementation therefore uses
a temporary native config snapshot with additional deny rules, while retaining
HOME, cwd, other native policy/credential sources and original config values.
It verifies that every existing permission source is still loaded. The original
config is never rewritten by the adapter. Closing the process removes only its
owned snapshot and profile. No final-tool approval grant is added.

Eight actual-executable scenarios passed: approved reply, explicit refusal,
user-selected Plan, file-input rejection, Full Access, file-input rejection even
under Full Access, an existing native MCP deny, and an ambient startup hook.
They use dummy credentials and a loopback scripted provider, not a real Space.
These are new adapter-boundary proofs; final PR CI and full acceptance remain
separate. Initial failing probes are retained in the session evidence.

## Reproducible native acceptance

New opt-in repository tests use disposable vendor/OpenMeld homes, dummy
credentials and loopback scripted model providers, never the original review or
a real Space. They exercise the production adapters with actual executables:

```sh
OPENMELD_TEST_CODEX_BIN=/absolute/path/to/codex node --test runtime/adapters/codex/test/space-dynamic-tools-native.test.js
OPENMELD_TEST_CLAUDE_BIN=/absolute/path/to/claude node --test runtime/adapters/claude-code/test/delivery-only-native.test.js
OPENMELD_TEST_OPENCODE_BIN=/absolute/path/to/opencode node --test runtime/adapters/opencode/test/delivery-only-native.test.js
OPENMELD_TEST_OPENCLAW_BIN=/absolute/path/to/openclaw node --test runtime/adapters/openclaw/test/delivery-only-native.test.js
OPENMELD_TEST_GROK_BUILD_BIN=/absolute/path/to/grok node --test runtime/adapters/grok-build/test/delivery-only-native.test.js
```

Use the actual executable, not an unrelated terminal wrapper. On this workstation
the cmux Claude shim failed synthetic authentication while the selected native
Claude 2.1.278 executable passed. This did not require changing user credentials.
Claude's user-selected Plan mode asks for approval for the effectful reply; that
native request must be surfaced, not removed to make the test pass.

Observed native baselines: Codex 0.150.1, Claude Code 2.1.278 with Agent SDK
0.3.195, OpenCode 1.18.31, and OpenClaw 2026.3.13 (61d171a). Tests separately
cover current permission/deny settings, canonical continuity, complete results,
lost receipts, stale callbacks and cancellation. A synthetic model probe proves
the adapter/executable boundary, not live-model reliability or real-user public
delivery. Final candidate check outcomes and exact commit identity belong in
the PR handoff, not an assumed universal support claim.

## Earlier checkpoint evidence (historical, not final-candidate certification)

The resumed implementation was checked with all eight adapter builds, CLI /
local-execution / local-service TypeScript checks, 73 focused CLI delivery tests,
and 23 orchestrator/routing tests. A combined opt-in run of the four actual
controllers passed all nine native scenarios without skips. Documentation
lifecycle and Changelog checks passed. These results are independent of hosted
CI and do not authorize a release.

The initial combined adapter run reported 569 passed, two failed and 19 skipped
(590 tests). One failure was an old OpenClaw fixture that omitted the new current
host capability/config observation; the fixture now covers that real boundary.
The other reproduced the existing Codex Stop fixture's one-second file poll.
It now synchronizes with `provider_turn_accepted` and fails if dispatch completes
without admission, keeping every Stop assertion and the production timeout
unchanged. Both focused regressions passed. Preserve that initial failed run;
normal push checks must independently validate the committed candidate.

The resumed worktree adds bounded read-only result continuation shared by native
and MCP tools. History, shared-file and Task-list responses return complete
small results or immutable JSON pages; `read_result` needs no local shell.
Integration regressions first failed on both carriers, then passed for complete
Unicode/escaped-text reconstruction, exact page replay, no repeated source read,
foreign-connection rejection and expiry. The focused history, file and action
suites pass 55 tests. This is tool-boundary evidence, not model/executable or
final-candidate acceptance for the remaining controllers.

Observed on the owner's workstation: Claude Code 2.1.278, installed Claude
Agent SDK 0.3.195, Codex 0.150.1. SDK definitions contain createSdkMcpServer,
alwaysLoad, mcpServerStatus and reconnectMcpServer. Codex's actual experimental
JSON schema was generated under the ignored dev-tmp directory; dynamicTools is
a thread/start field, not a thread/resume or thread/fork override.

At `0f77d5e9244cbd0ced1b45979e14e00f73ff9301`, the CLI correction,
receipt, history and trusted-file suites pass 71 tests; Claude adapter tests
pass 83 tests (including real SDK in-memory MCP and mocked model streams);
and CLI TypeScript checking and normal repository push hooks pass. Separate
checks passed 282 HTTP schema tests, 40 Space Mesh tests, 34 Core publication
tests, 14 OpenClaw adapter tests and six Antigravity adapter tests. The Core
publication tests were run directly: the pre-push boundary selection found no
tests for that file, so its zero-test result is not the evidence for those 34.

An isolated actual Codex 0.150.1 executable probe used a temporary HOME,
CODEX_HOME and workspace, dummy credentials, and a loopback scripted Responses
provider. A `thread/start` function Dynamic Tool reached `item/tool/call` and
received its host result; the turn completed. This probe did not use the
OpenMeld adapter or publish to a Space. With `environments: []`, no Shell or
filesystem tool appeared in the captured catalog, but native goal tools,
skills, planning and tool search remained. This is positive Dynamic Tools
interface evidence, not proof of a delivery-only integration. The probe is
under ignored `dev-tmp/issue-1250-native-codex-probe.mjs`; production integration,
cold resume/fork authority, policy-preserving fallback, and final native smoke
were acceptance work at that checkpoint. No live Claude executable or real
model/publication smoke is claimed. Later commits record their own evidence.

The Codex production integration was then exercised through createCodexAdapter
against the same actual 0.150.1 executable and an isolated loopback scripted
provider. New thread, cold resume, ephemeral repair fork, and persistent fork
each invoked the current host tool exactly once, without a second MCP carrier.
This is an opt-in repository test, space-dynamic-tools-native.test.js, enabled
with OPENMELD_TEST_CODEX_BIN; it uses no real credentials or Space publication.
Native testing caught an important difference from the mock: thread/read returns
threadSource=null even when the rollout metadata retains thread_source and
dynamic_tools. The adapter now verifies the bounded matching metadata header
inside the native controller's own session store before resuming/forking. It
does not copy raw conversation content or persist another authorization record.

The ordinary Codex suite passed 160 tests, with two pre-existing native optional
tests skipped, before the extra metadata/cancellation regressions were added.
The 19 carrier/authority scenarios include native decode fallback, managed and
per-tool restrictions, changed policy on resume, foreign/stale callbacks, and
unconfirmed handler results. Delivery-only isolation for Codex is not yet proved
by these normal/repair carrier tests: native skill and planning tools remained
visible in the separate restricted-catalog probe.

A subsequent whole-package run reported 161 passed, one failed and three skipped:
the existing Stop-after-writer-retry test hit its one-second fixture wait. Its
unchanged baseline and candidate both passed in a sequential isolated comparison;
the wait, assertions and production Stop behavior were not changed. This is an
intermittent timing result, not a green whole-package result or proof of its root
cause. Preserve the failure in the checkpoint evidence and require a clean final
candidate run before first-line acceptance.

## Contract Impact Audit

- Local tool receipts add a positive rejection variant. It is local model/tool
  feedback only; the Coordinator result and publication wire are unchanged.
- Old cloud/new local: current tools emit existing post_message/stay_silent
  payloads. Frozen status-only permission is not rewritten or bypassed.
- New cloud/old local: the stored/action schemas still accept permitted legacy
  status proposals. New authoring narrows an old mixed list and rejects a
  status-only replacement explicitly. An unrelated policy patch leaves its
  existing allowedActions untouched.
- Existing historical readers, system notices, result archives and explicit
  raw-context-sharing policy remain supported. No data migration or automatic
  permission expansion is introduced.
- Native capabilities are host-only; no function, environment credential or
  captured Wake authority is added to a persistent runtime/task schema.
- The OpenClaw adapter requires the dispatch-owned current tool definitions;
  the CLI creates and passes them through the local-execution orchestrator.
  The native plugin forwards the common MCP protocol rather than duplicating
  validation, action storage, pagination or publication. Its temporary files
  and child connection do not become a persistent authorization source.
- Missing-action correction uses a host-owned environment marker, not a new
  cloud wire contract. Older or policy-incompatible native controllers stop
  explicitly instead of assuming that a successful process launch proves a
  safe tool scope. Packaging/release readiness and deployed Space delivery
  still require the release owner's final-candidate checks.

## Primary references

- https://platform.claude.com/docs/en/agent-sdk/custom-tools
- https://platform.claude.com/docs/en/agent-sdk/mcp
- https://platform.claude.com/docs/en/agent-sdk/permissions
- https://platform.claude.com/docs/en/agent-sdk/structured-outputs
- https://developers.openai.com/codex/app-server/

Native support must be checked against the executable actually launched, not
inferred from an SDK dependency range alone.
