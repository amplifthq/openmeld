# Phase 4 smoke fixes (round 2b) — external review

Findings: R2B-02 and R2B-04 from smoke round 2b (§4.6, §7 of
[the MemberAgent program](../member-agent-program.md)).
Branch: `claude/map-4-smoke-2b`, cut from the program head `e2d523c5b`.
Reviewed diff `e2d523c5b..9ef6a68f3`; the fixes below came after it.

## What changed

| Finding | Change |
| --- | --- |
| R2B-02 (P1) An observing owner could not answer their Agent's native permission question | **Inbox:** with MemberAgents on, the RuntimeCoordinator interaction producer accepts an owner who is not a member when the Agent that asked is an active member they own. The Agent id comes from the execution id. That owner's item names the Agent (`agentProfileIds`, `personalAgentProfileIds`, recipient reason `agent_owner`) and is marked `agentOwnerActivity`, so Inbox reads and the urgent email admit it the same way as other owner activity. **Answer path:** the Space admits an observing owner to the answer endpoint only, without membership or general write access. The runtime hub still accepts an answer only from the Binding owner. **Web:** the read-only composer keeps the pending action surface. Inline interaction cards keep their answer control when Core says `canRespond`. |
| R2B-04 (P1) The first message released by Allow once failed for OpenCode | Allow once asked every harness for a new Session (`contextSelection: new`). OpenCode has no Execution Contexts and refused it with `execution_context.controller_access_unsupported`. The release now asks for a new Session only when `supportsExecutionContextAccess(ref, "workspace", "agent_settings")` holds, the same predicate the authority uses for implicit Sessions. Otherwise the message runs exactly like an ordinary later message. An unknown harness still asks for a new Session. The harness is read from the target member after a join. |

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`). The first run stopped at model capacity; the retry completed.
- Questions:
  - Can anyone other than the Binding owner gain answer access or Inbox items?
  - Can an observer gain write access or membership?
  - Can a removed owner receive items?
  - Can the owner's earlier conversation reach a colleague?
  - Are the access predicate and SQL correct?
  - Does anything change with the flag off?
  - Which tests are missing?

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | P1. The observer's item was stored but hidden: Inbox reads and email (`inbox-source-access.ts`) require a human membership unless the item carries owner activity. The test checked raw rows only. | Yes | Fixed. The observer's item carries `agentOwnerActivity` and names the Agent. Eligibility is narrowed to the Agent that asked. The test now reads through the Inbox service, which also gates email: the owner sees the item and another person sees nothing. |
| 2 | P1. For a harness without Sessions, a released message continues the Binding conversation, so a colleague's request can run with the owner's earlier history. Ordinary later messages already behave this way. | Yes (`execution-context-authority.ts` implicit fallback; OpenCode resumes the Binding conversation id) | **Not changed, reported as a program correction.** The brief asked for the release to behave "exactly as an ordinary later message does". The privacy gap is in the ordinary path itself, for every harness without Execution Contexts. Possible fixes are to refuse colleague use of such a harness, or to give colleague-rooted Wakes a separate harness conversation. The program owner should decide. |
| 3 | P2. With the flag off, a Direct Message observer also gained answer access. | Yes | Fixed. Observer answer access needs MemberAgents on. |
| 4 | Test gap. The answer test proves that an observing owner reaches the answer path (`not_found` for a missing execution, not `read_only`). It does not prove a successful answer, or that another observer is refused. | Partly | Accepted. The runtime hub's existing owner check (`runtime-transport-hub.ts`, `actorOwnerUserId` against the Binding owner) refuses everyone else. A full answer needs a live runtime. |
| — | Answer authority, observer rights, SQL scope, capability predicate. | — | Codex found these fine. |

## Checks

- `services/core`:
  - `tsc --noEmit`: passed.
  - `tests-node/runtime-coordinator-interaction-inbox-producer.test.ts`: 19 passed.
  - `tests-node/agent-access-release.test.ts`: 3 passed.
  - `tests-node/agent-access-policy.test.ts`: 8 passed.
  - `tests/agent-access-consent.integration.test.ts`: 10 passed. These include the OpenCode release, which matches a later message, and the observing owner reaching the answer path.
- `clients/web`:
  - `tsc --noEmit`: passed.
  - `space-composer.test.tsx`, plus the interaction card and pending action tests: 54 passed.
- Not run: a browser smoke of the owner answering from Inbox and from the observer view. The fixes need a new smoke round.
