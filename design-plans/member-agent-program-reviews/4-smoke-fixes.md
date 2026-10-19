# Phase 4 smoke fixes (round 1c) — external review

Findings: R1C-03, R1C-04, R1C-05 from smoke round 1c (§4.6, §5, §7 of
[the MemberAgent program](../member-agent-program.md)).
Branch: `claude/map-4-smoke-fixes`, rebased on the program head `a8bc7da7c`
(Phase 5 merged). Reviewed diff `a8bc7da7c..b864d5d48`; the fixes below came after it.

## What changed

| Finding | Change |
| --- | --- |
| R1C-03 (P2) Requester saw Working while the owner was asked | Web drops Wake progress (local and confirmed) for every `(message, Agent)` pair that has the requester's request in any state except allowed or joined. The Space banner above the composer shows "Waiting for <owner> to allow <Agent>." with Withdraw. After a post with Wake targets, Web refetches the request list. |
| R1C-04 (P1) A nonmember Agent could not be mentioned | The @ picker also lists other owners' active personal Agents that are not in the Space. They are grouped under "<owner>'s Agents · not in this Space", and each row says "Asks <owner>". Choosing one inserts `@Name` as text, not an activation target. After the message posts, Web calls `POST /v1/spaces/:spaceId/agent-requests` with the new signal id, so the request is bound to the message. Group Spaces only: a Direct Message must become a Space first, as Core already requires. A message with such a mention is never queued into an active task. |
| R1C-05 (P2) Cards stayed until reload after a decision | The Space sends `space.meta.changed` with reason `space.agent_access.changed` in two cases: after its holds sync to Core (request created or voided), and after a decision Core recorded is applied. Web refetches only the Agent request views for that frame. It also refetches them on `space.members.changed` and after a reconnect. |

No new write decides access or adds an Agent to a Space. Creating a
request is not a sensitive operation; decisions stay behind the Phase 5
Gateway gate.

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions:
  - Can an Agent be woken or added before owner consent?
  - Can the viewer see Agents they should not see?
  - Are any UI states stale or wrong: Working still shown, a request never sent, duplicate requests, requests for deleted text, the queued-input path, retries?
  - Are there races between the post, the hold sync and the broadcast?
  - Is there excessive refetching?
  - Which tests are missing?

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | P1. Matching chosen names by substring let `@Reviewer Pro` also request a chosen `Reviewer`, and two chosen Agents with one name both matched. | Yes | Fixed. The longest names match first and consume their text. A match must end at a name boundary. A later choice of the same name replaces the earlier one. Tests added. |
| 2 | P1. The request is created after the post, so an edit that lands first left the later request bound to changed text. | Yes (`rpcRequestAgentForSpace` checked recall but not edit) | Fixed (Core). An edited message cannot start a request (`agent_access.message_unavailable`). An edit after the request still voids it, as before. The integration test asserts both. |
| 3 | P2. A failed request after a successful post had no recovery. | Yes | Fixed. The error toast offers Try again. Core keeps one request per message and Agent, so a retry is idempotent. |
| 4 | P2. Choices live in component state, so a draft restored after navigation or reload posts the text without asking the owner. | Yes | Not changed. Keeping them would need a new field in the stored draft record. Reported as a follow-up. The user sees no "Requested <owner>" banner and can mention the Agent again. |
| 5 | P2. Any successful send cleared every choice, including choices made in a newer draft while an earlier message was still posting. | Yes | Fixed. Only the sent message's choices are cleared. |
| 6 | P2. If the socket missed the creation frame, nothing refetched the empty request list, and Working could stay. | Yes | Fixed. Reconnect recovery refetches the Agent request views. |
| 7 | Found while testing #2 (not from Codex). `rpcRequestAgentForSpace` and `rpcApplyAgentAccessDecision` threw their refusals inside `blockConcurrencyWhile`. A throw there terminates and resets the Space Durable Object, so an ordinary refusal such as "already a member" reset the Space. This came from package 4b. | Yes (the new integration assertion reset the object) | Fixed (Core). Both methods catch inside the gate and throw after it opens, as `rpcResolveNativeReplyPlacement` already does. |
| — | Efficiency: the invalidation covers request and grant views in every Organization. | — | Accepted. These are small queries, and only active ones refetch. The frame handler has no Organization id. |
| — | Consent enforcement, directory privacy, queue and retry dedupe, broadcast ordering, held filtering. | — | Codex found these fine. |

## Checks

- `clients/web`:
  - `tsc --noEmit`: passed.
  - `agent-access.test.tsx`, `space-composer-editor.test.tsx` and `use-space-landing-feed.test.tsx` all passed.
  - A wider run over `src/components/spaces`, `src/components/agent-access` and `src/query` has 15 failures in 8 unrelated files. The same 15 also fail on the clean base (sidebar, locale and Center Agent intro tests).
- `services/core`:
  - `tsc --noEmit`: passed.
  - `tests-node/agent-access-policy.test.ts`: 8 passed.
  - `tests/agent-access-consent.integration.test.ts`: 9 passed.
- Not run: a browser smoke of the three flows. The fixes need a new smoke round.
