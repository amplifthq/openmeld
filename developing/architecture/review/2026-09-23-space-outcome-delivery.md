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

Remaining before first-line acceptance: Codex Dynamic Tools and safe transport
selection across persisted threads; delivery-only native restriction evidence
for the other supported carriers; large-result readability; complete affected
consumer checks; and isolated native executable smoke. A common helper test
must not be represented as proof of every controller.

## Version and test evidence

Observed on the owner's workstation: Claude Code 2.1.278, installed Claude
Agent SDK 0.3.195, Codex 0.150.1. SDK definitions contain createSdkMcpServer,
alwaysLoad, mcpServerStatus and reconnectMcpServer. Codex's actual experimental
JSON schema was generated under the ignored dev-tmp directory; dynamicTools is
a thread/start field, not a thread/resume or thread/fork override.

At this checkpoint the CLI correction/receipt/history suites pass 65 tests,
Claude adapter tests pass 83 tests (including real SDK in-memory MCP and mocked
model streams), and CLI TypeScript checking passes. These are not live model
or Space publication smoke results. Later commits must record their own exact
candidate validation rather than inheriting this evidence.

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
