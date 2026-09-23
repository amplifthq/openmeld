# Space outcome delivery — issue #1250

## Agent Context

- Purpose: Track implementation, remaining acceptance work, and evidence for first-line Space outcome delivery in #1250.
- Read this when: Continuing or reviewing Draft PR #1261 across worktrees and agents.
- Update this when: The candidate, validation evidence, or remaining acceptance scope changes.
- Do not use this for: Production acceptance, release authorization, or proof that every native controller was tested.
- Source of truth: The Space collaboration and Agent transport owner documents define behavior; this note records candidate-specific work and evidence.

Status: Partial implementation in Draft PR #1261; no deployment or first-line acceptance claimed. Remove after the remaining acceptance work is complete and durable behavior/evidence has been incorporated into owner documentation and the PR.

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

Remaining before first-line acceptance: delivery-only native restriction evidence
for the other supported carriers; complete affected
consumer checks; and isolated native executable smoke. A common helper test
must not be represented as proof of every controller.

## Version and test evidence

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

## Primary references

- https://platform.claude.com/docs/en/agent-sdk/custom-tools
- https://platform.claude.com/docs/en/agent-sdk/mcp
- https://platform.claude.com/docs/en/agent-sdk/permissions
- https://platform.claude.com/docs/en/agent-sdk/structured-outputs
- https://developers.openai.com/codex/app-server/

Native support must be checked against the executable actually launched, not
inferred from an SDK dependency range alone.
