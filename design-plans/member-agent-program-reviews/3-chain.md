# Phase 3 · Request chain and enforcement — external review

Packages: 3a, 3b, 3c of [the MemberAgent program](../member-agent-program.md)
(§4.6, §6, §7, §9 invariant 4, §10 Phase 3).
Branch: `claude/map-3-chain-25687e`, reviewed diff `5503850ec..231669b13`
(the `[3a]`, `[3b]` and `[3c]` commits before the fixes below).

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: any path where a non-owner root reaches a §6 operation; any
  producer that leaves the chain empty or roots it wrongly, and any way an
  Agent or client injects a chain; a loop that is wrongly blocked
  (conversational A→B→A) or wrongly allowed (delegated re-entry); an Inbox
  item or email that leaks command text or emails more than once per
  Session; compatibility with installed Services and persisted records.
  Reviewed as if `MEMBER_AGENTS_ENABLED` were on, and flag-off separately.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Ordinary §6 endpoints (Binding settings, ensure/disable, folders, Default Project, creation defaults, work recovery, deletion) authorize the signed-in account, not a task root, so a colleague-rooted task running the owner's real CLI can change the owner's other Agents. | Yes | Not changed here: no request context carries a task root until Phase 5's task credential. Web/App/CLI sessions are their own root, so today's owner checks are the root check for them. Reported as a program correction (§6 notes the gap; Phase 5a–5c close it). |
| 2 | Center Agent represented-member requests (Default Project, Projects, Routines, …) accepted a speaker that did not match the turn's recorded member. | Yes (`represented-member-request.ts` kept `sourceDelivery = null`) | Fixed. Once enforced, a request without a matching active native delivery is rejected with `center_agent.request_chain_root_mismatch`. |
| 3 | Admission rooted a `ca-wake:` Wake at the audit journal's `onBehalfOf`, which comes from the RPC body. | Yes | Fixed. Admission also requires the attribution to match the member Core recorded on the Center Agent's source native delivery (`readNativeDeliveryRoot`). Ancestry: Center Agent delegation is admitted only from member-spoken turns (`readRecordedDelegationRequester` requires a verified member sender), so `[member, Center Agent, target]` is the full chain. Test: "finds no root when the attribution names someone other than the turn's member". |
| 4 | The connect tool could change an existing Binding's permission mode in the same turn, bypassing confirmation. | Yes (reconnect applies the permission patch) | Fixed. Once enforced, connect refuses a mode that differs from the existing Binding's (`center_agent.permission_mode_confirmation_required`) and points to the runtime-settings tool, which collects the confirmation. Connecting a new Binding stays additive. Test added. |
| 5 | Any other delivery could consume the confirmation, even one older than the evidence; a retry in the consuming turn reruns the write. | Partly | Fixed: the consuming delivery must belong to the same member and Center Agent and start no earlier than the evidence was issued (SQL `EXISTS` on the native delivery ledger). Tests for an older turn and another member. Not changed: a retry in the confirming turn reapplies the same mode, which is idempotent. Residual: Core cannot read the member's intent from their next message; a declining member is honored only by the model. A confirmation card the member clicks would close it (follow-up). |
| 6 | Root-based plugin access skipped `requireLocalDelegation`, dropping execution proof and delegated-action limits. | Yes | Fixed by reverting the plugin-caller change. With those checks kept, the root gives the same represented member as before, and an Agent-authored Wake without delegation stays denied. |
| 7 | Result finalization rebuilt the dispatch message without `requestChain`, so an Agent's final reply that mentions another Agent lost the chain (and would fail admission once enforced). | Yes (`accepted-dispatch-finalization.ts`) | Fixed. The Space attaches the chain from the finalized Wake's own outbox record (`withOutboxRequestChain`). |
| 8 | The personal Remote Agent rebuilt `[onBehalfOf as human, agent]`, but `onBehalfOf` can be an Agent and drops ancestry; hosted admission does not require a root. | Yes | Fixed for the chain: the tool now names the Wake it runs in (`requestChainBasis: { kind: "wake", dispatchId }`) and the Space resolves it to that Wake's own chain, as it now does for hosted Agents' final replies. Not changed: hosted (Center/Remote Agent) admission does not reject a missing root, because hosted Wakes have no Execution Context assignment and their management calls are root-checked at the tool boundary. Reported as a program correction. |
| 9 | The personal Remote Agent still rejects `autoRelayDepth >= 6`, hard-blocking conversational loops. | Yes (pre-existing) | Not changed: pre-existing hosted collaboration guard outside this package's files. Reported as a follow-up against the Auto-Relay Loop Policy. |
| 10 | An equal-timestamp replay could reopen an ended Session item; resolution matched only `interactionId`. | Yes | Fixed. Only a strictly newer question replaces or reopens the item; replaying the current one never reopens it. Resolution is fenced by execution id and interaction id. Test: "never reopens an ended question on replay or lets another task's answer close it". |
| 11 | One email row does not guarantee one email: a crash after the provider accepts but before `markDeliverySent` retries. | Yes (pre-existing Inbox email delivery) | Not changed: inherited at-least-once email delivery. Reported as a follow-up. |
| 12 | Flag-off behavior changed: the Routine creator check and the Center Agent delivery lookup ran unconditionally. | Yes | Fixed. Both run only when the chain is enforced; before that the Routine keeps its earlier `routine.member_unavailable` failure. |
| — | Chain helper: revisits, delegated re-entry, depth cap. | — | None found. |
| — | Direct human/external seeds, Routine marker, plugin continuations. | — | None found. |
| — | Client or header injection of `requestChain` / `requestChainBasis`. | — | None found (Gateway builds Core inputs field by field). |
| — | Question text or command text in the Inbox or email. | — | None found (fixed copy). |
| — | `requestChain` reaching an installed Service; old records failing to parse. | — | None found. |
