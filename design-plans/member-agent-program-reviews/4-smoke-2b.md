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

## Colleague conversation on harnesses without Sessions (§4.3)

Branch: `claude/map-4-colleague-conversation`, on the program head
`75a840713`. It implements the designer's decision on finding 2 above.

**What changed**

- **Core** (`dispatch/application/colleague-conversation.ts`) is the only
  place that decides. With the request chain enforced, on a harness without
  Execution Contexts, a Wake whose root is not the Binding owner is affected.
  Core reads the root through the existing owner check, and missing evidence
  counts as a colleague. For such a Wake, Core:
  - delivers it without the Binding conversation;
  - marks it `separateRequesterConversation`;
  - never writes its conversation back to the Binding. At finalization this
    holds even if the gate changed after delivery, because the root is read
    from the admitted chain.
- **Compatibility:** Core sends the mark only to a Service that declares
  `requesterConversationIsolation`. An older Service would resume the owner's
  conversation, so Core refuses that delivery with
  `agent_access.conversation_isolation_unsupported` ("Update OpenMeld on the
  Agent owner's computer…").
- **Service and runtime:** a marked Wake ignores the Binding conversation. It
  keys both the outer ledger and `RuntimeTask.agentContextScopeId` with a
  UUID derived from its dispatch, so its conversation is neither resumed from
  nor recorded into the Profile's shared ledger. OpenClaw gets a session of
  the Wake's own instead of the Space's shared one.
- Owner-rooted Wakes are unchanged.

**Review runs**

- **First run** (Codex, `gpt-6-astra`, `high`, read-only) found five P1s. All
  were fixed:
  1. A non-UUID scope invalidated the ledger.
  2. The runtime orchestrator wrote the colleague's conversation under the
     owner's key.
  3. Core and Service disagreed while the gate was off.
  4. With mixed versions, an older Service still resumed the owner's ledger
     conversation.
  5. OpenClaw rebuilt the Space's shared session.
- **Re-review** confirmed all five closed. It found one more P1:
  finalization recomputed the decision, so a gate change during a Wake could
  still write the Binding. Fixed: the root is read from the admitted chain.
  With the gate off, this only stops colleague-rooted conversations on these
  harnesses from replacing the Binding conversation.
- Not covered:
  - Exact execution recovery of an interrupted colleague conversation fails
    closed, as before.
  - The scoped ledger entries follow the ledger's existing retention.

**Checks**

- Typecheck passes for `services/core`, `clients/openmeld-cli` and
  `runtime/local-execution`.
- Core:
  - `tests-node/colleague-conversation.test.ts`: 5 passed.
  - `permission-mode-advisor` and `plugin-continuation` integration: 9
    passed.
- `runtime/local-execution`: 145 passed, including a new
  `runRuntimeTask` case. It checks three things: the colleague starts fresh
  beside the owner's thread, the ledger round-trips on disk, and the owner's
  next Wake resumes the owner's thread.
- CLI:
  - `colleague-conversation`, `provider-runtime-continuation` and
    `resolve-local-service-capabilities`: 14 passed.
  - Dispatch, ledger and continuation suites: 300, with 0 new failures.
- Not run: a smoke with a real OpenCode Binding.

## Space-join release and Inbox filter (round 5: R5-02, R5-03)

Branch: `claude/map-4-space-join-release`, on the program head `3bb1d283d`.

**R5-02 (acceptance blocker):** Let the Agent join on OpenCode failed with
`execution_context.controller_access_unsupported`.
- Cause: the requested member was resolved without its harness
  (`agentControllerRef: null`). The Space therefore treated the harness as
  unknown, and for an unknown harness it still asks for a new Session.
- Fix: Core now reads the requested Agent's harness from its primary
  Binding and passes it to the Space for every release (`targetControllerRef`).
  This covers joins, Direct Messages and external requests. The Space
  prefers it over the member record.
- The release then follows the same rule as the first Direct Message and as
  a later message. A colleague-rooted Wake keeps its separate conversation,
  because the release preserves the chain `[requester, Agent]`.
- The only explicit new-Session request in Phase 4 is
  `space/application/agent-access-release.ts`.

**R5-03:** opening an item from Needs action reset the filter to All.
Opening an Inbox detail now keeps the current view and filters, and only the
selected item changes.

**Review** (Codex, `gpt-6-astra`, `high`, read-only). It found two issues,
both fixed:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | P1. Only joins read the Binding. A Direct Message `allow_once` still relied on the member snapshot, which can be null. | Fixed. Every release passes the Binding's harness. Test: a Direct Message whose member has no recorded harness releases OpenCode without an explicit new Session. |
| 2 | P2. Filter keeping matched any same-path link, so the Space's own list could carry an old focus. | Fixed. It now applies only to `/o/<org>/inbox`. Test covers it. |

Codex found these fine: the Binding source (exact owner and Profile,
`enabled_primary` only), colleague isolation after the release, and Inbox
paths.

**Checks**

- **Core:**
  - `tsc --noEmit` passed.
  - `tests/agent-access-consent.integration.test.ts`: 12 passed. They
    include Let the Agent join on OpenCode, which reads the harness from a
    seeded Binding, and the Direct Message release without a recorded
    harness.
- **Web:**
  - `tsc --noEmit` passed.
  - `source-target` and `inbox-page`: 52 passed. The one failure
    (organization document route) also fails on the clean base.
- **Not run:** a browser smoke.
