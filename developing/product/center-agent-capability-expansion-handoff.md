# Center Agent capability expansion — implementation handoff v2

## Agent Context

- Purpose: Bound the implementation and acceptance scope of PR #1199.
- Read this when: Implementing or reviewing the Center Agent read/recall slices.
- Update this when: An implemented boundary, verified source, or acceptance gap changes.
- Do not use this for: New permissions, capture policy, execution recovery, deployment, or a cumulative backlog of earlier review suggestions.
- Source of truth: The four v2 PR comments define this handoff; current scoped owner documents and explicit later owner decisions govern product and architecture contracts.

Status: **IN PROGRESS**. Remove this handoff when the implemented scope ships and its durable contracts and evidence have moved to the owning documents and PR. Keep #1199 Draft for implementation and the separately requested Codex review/smoke.

## Read in order

1. [1/4 — scope, corrections, and decisions](https://github.com/amplifthq/openmeld/pull/1199#issuecomment-5758736214).
2. [2/4 — audit, activity, and exact Routine diagnostics](https://github.com/amplifthq/openmeld/pull/1199#issuecomment-5758708415).
3. [3/4 — bounded retained-memory search and provenance](https://github.com/amplifthq/openmeld/pull/1199#issuecomment-5758717398).
4. [4/4 — batches, acceptance, and separate follow-ups](https://github.com/amplifthq/openmeld/pull/1199#issuecomment-5758727558).

The original proposal and overlapping reviews are historical evidence, not additive requirements. The v2 corrections supersede their disputed absence claims and broad acceptance wording. Inventory counts do not measure user-request frequency or establish a usage ranking.

## Takeover baseline

On 2026-09-21, a fresh fetch of `origin/main` resolved to `6d0736ee1197bee8778760f4b7ecc13d2bd77b2c`. The docs-only #1199 head was `c9ea650de48f86b290e09ebbf26929d106c2bbf8`, already containing that main. Implementation uses a separate worktree and preserves other agents' checkouts.

At takeover, #1198 was Ready, open and unmerged at `57dd5cc33e7aec465ccc403f6cf40bdaa9b7ca68`. It merged at `2026-09-21T10:30:10Z` as `cba063764d52ccdcd9a96faab9d272ab4185b743`. After Batch 2, this worktree integrated then-current main in `b9c3c2893`; the final review baseline is `139bb7b9b589e4089a30a51f25ce7c961b355f276`, including the #1198 merge. Its admission ACK, callback wait, Workflow recovery, and fair recovery-scan changes remain the execution owner, not duplicated diagnostics logic. Merged is not deployed. Neither PR establishes the original missing-ACK/empty-response incident cause or authorizes historical production replay.

## Corrected scope and source map

| Slice | Existing owner and actual limitation | Planned disposition |
| --- | --- | --- |
| A. Audit | `services/remote-agent/agent-core/tools.ts` sends Agent context to the human `listCenterAgentAuditJournal` membership path in `services/core/src/rpc/methods.ts`. Agent Profile identity is not represented-member authority. | Reproduce the real authorization boundary, then add a narrow designated-Agent/member adapter over the same journal and action-set projection. Preserve the human route. |
| B. Activity | The snapshot already has member/project/provider/status filters. `activity-snapshot-repository.ts` caps collections; current Session Inventory separately provides pagination. `tool-result-boundary.ts` enforces the 128 KiB tool result limit. | Add a private bounded overview at the owning read boundary, with stable IDs, source times, and explicit text/collection coverage. Keep Web/CLI contracts and canonical Inventory paging. |
| C. Routine evidence | `openmeld_list_routines` already returns `lastRun`; human Run-history APIs/UI exist. Routine/Run, native delivery, runtime telemetry, and publication have separate owners. | Add authorized historical Run listing and exact-Run diagnostics, resolving linked deliveries and current result ownership through those owners. Preserve interactive diagnostic restrictions and `lastRun`. |
| D. Recall | Core memory already retains bounded member/organization facts. Automatic recall degrades failed reads to an empty prompt envelope and discards exact source references; the adapter currently projects only the earliest supporting episode. | Add one explicit query-driven detailed read over the existing memory owner. Preserve full bounded source sets and read failures before projection, and authorize all sources and the reply audience. Do not expand capture. |
| E. Existing flows | Slack references and DM-to-Space work involve navigation/read/publication and actual Wake/continuation respectively; a shared memory root cause is not established. | Verify separately. Record the exact successful path or missing step; separable effectful fixes are follow-ups. |
| F. Further scenarios | Work/result status, failed-delivery reconciliation, approved brief delegation, current decisions, accessible-source reports, pause versus stop, and event follow-up have existing or separately scoped owners. | Preserve as prioritized validation hypotheses, not measured demand or instructions to build new subsystems. |

Read the scoped owners for Organizations/Center Agent, Routines, Agent Activity, Remote Agent, data/observability, shared contracts, and the current development/delivery workflow before changing those boundaries. Source and tests remain implementation truth.

## Authorization and evidence rules

A supported audit read must succeed for the current designated Center Agent acting for a verified eligible member. Missing speakers, revoked membership, wrong organizations, obsolete designations, and unsupported caller classes remain authorization failures, not empty successes. Routine callers use the reauthorized delegated member, never a substituted owner identity. Source/resource references must be safe in the visible tool output, not merely filtered from final prose.

The activity overview is a bounded current snapshot, not complete historical events or transcript analytics. Session Inventory cursors enumerate that owner's authorized current sessions; they do not continue omitted snapshot digests/events or promise snapshot-consistent history. Bound collections and presentation text before final serialization, preserve identifiers, include wrapper/multibyte overhead, and never truncate serialized JSON or derive organization totals from a sample.

For Routine reads, the model selects a Routine or exact Run, not arbitrary submissions or recipients. Core resolves ownership. Keep canonical Run facts, native-delivery evidence/current result owner, sanitized runtime evidence, publication, observation times, and coverage separate. Submitted is not worker admission; completed generation is not publication; pausing a schedule does not prove in-flight work stopped. Skipped, failed, not recorded, unavailable, and redacted evidence are distinct. Freeze interpretation to persisted `scheduledFor` and destination evidence, not today's mutable definition. Retained history after definition deletion follows the existing owner policy. No raw instructions, replies, tool payloads, provider payloads, or private-destination content belong in organization-wide diagnostics.

## Bounded recall v1

The proposed `openmeld_search_center_agent_memory` is an interactive verified-member read, not universal conversation search. Its input is a trimmed nonempty query within the existing 400-character limit and an optional limit of 1–6. The model supplies no member, organization, graph, episode, or authority identity. Search existing authorized subjects without creating graphs, enabling policies, writing memories, or changing automatic context behavior.

Return remembered facts as summaries rather than quotes or current approved decisions. Preserve structured permitted source references, occurrence timestamps, scope, availability, and bounded relevance coverage. Authorize every supporting source of a synthesized fact through its canonical owner and check disclosure to the current audience. A readable private source is not permission to expose it in a shared Space or ordinary visible tool output. Missing, revoked, invalid, deleted, or unverifiable sources must not leak hidden source identifiers, titles, counts, or existence hints.

A provider outage is unavailable/partial coverage, not a successful empty lookup. A successful no-match result does not prove that a conversation never occurred. There is no invented cursor or exhaustive-history promise. Sources without a trustworthy current permission/read owner remain explicitly unsupported. Slack/Lark/Feishu content not retained under existing capture policy is outside memory coverage; external-shared capture remains excluded. Use existing authorized source readers and Organization Document revisions to verify approval, reversals, and currentness. Old source instructions are data, not new action authority.

## Batch sequence and acceptance

| Batch | Coherent change | Evidence required |
| --- | --- | --- |
| 0 | Sync main, inspect #1198, correct this source handoff, identify owners. | Exact baseline and source-to-limitation map; no changes to other worktrees. |
| 1 | Supported member-attributed audit read. | Actual tool identity preparation, Core authorization and journal projection; legitimate success plus missing/revoked/wrong/stale identities and private-reference cases. |
| 2 | Bounded activity projection; reuse Inventory. | Safe oversized multibyte fixture through the real serialized result boundary; stable IDs and truthful coverage; several Inventory pages, filter/cursor mismatches and source changes. |
| 3 | Shared historical/exact Run reads and catalog registration. | Older Run selection, delivery/continuation ownership, independent execution/publication states, skipped/deleted-definition cases and restricted destinations, with no read-side execution effects. |
| 4 | Detailed authorized retained-memory search. | Known conclusion from a new private conversation with permitted provenance; no match, outage/partial read, missing source, mixed private/shared sources, shared audience and later reversal. |
| 5 | Integration, self-review, owner docs and draft Changelog. | Focused/affected checks at the appropriate stage, #1198 reconciliation, actual frozen discovery/describe/Code Mode invocation, mixed-version compatibility and clear unsupported/untested outcomes. |

Each implemented capability needs an intended-user positive walkthrough through normal tool discovery and real result envelopes, using controlled provider/source fixtures when needed. Mocking the boundary under test to always succeed is not acceptance. Deterministic boundary evidence, separate local user smoke, Final Candidate, deployment, and production success must never be conflated. The owner will arrange Codex local review and smoke after this implementation's self-check; do not claim those have run.

## Verification-only and follow-up work

For Slack, distinguish stable permalink navigation, fresh source read/search authority, and publication. An old turn-bound execution grant is not reusable authority; do not extend its lifetime. #124 only proves its own Inbox-link scope.

For DM-to-Space, check target discovery, member/Agent eligibility, a minimally shareable self-contained brief, an actual Wake, explicit completion mode, and result return. A reference is not delegation, queued publication is not execution, and a child result is not automatically the parent's final answer.

Prioritize evidence-backed work/result status and safe delivery reconciliation, then approved-brief delegation and current-document verification. Pause/stop distinctions and source-readiness are validation scenarios over existing owners. A future PR-merge subscription requires its own supported event source, cancellation, authority and duplicate-delivery contract; it is not implied by Local Agent task watching.

## Implementation evidence and review handoff

Implementation worktree: `/Users/felix/Desktop/work/.webcodex-managed-worktrees/openmeld-c0cc522a-d895-424d-8de7-8ee1d9f5c701`, branch `webcodex/pr1199-handoff-v2-20260921`. Other agents' checkouts were not modified.

| Batch | Local commit | Implemented result |
| --- | --- | --- |
| 0 | `39980a830` | Replace the old additive proposal with this v2 source map. |
| 1 | `e72aecf62` | Private member-attributed Audit Log adapter, preserving human journal behavior and filtering source references before visible output. |
| 2 | `96c2d6ae7` | Bounded Activity overview and explicit live Inventory coverage/paging tests. |
| 3 | `151a7078f` | Retained historical and exact Routine diagnostics, frozen destination evidence, linked delivery/result ownership and sanitized runtime evidence. |
| 4 | `5c781dcd1` | Explicit retained-memory lookup, complete bounded provenance, active-subject reads without writes, current member/source/audience authorization. |
| 5 | `cb0e881c3` | Production frozen discovery/describe/Code Mode acceptance, current-audience disclosure checks, owner docs, draft Changelog and integration checks. |
| Review follow-up | `268ef2983`, `01fedb347` | Discard provider results when the retained subject is deleted, disabled, or changes during the read; cover member deletion and organization opt-out. |

The four capability fixture suites live in `services/remote-agent/tests/center-agent-{audit-evidence,activity-overview,routine-evidence,memory-search}.test.ts`. Their positive cases now use production `getRemoteAgentFlueTools`, its actual frozen capability search/describe contract, the actual Code Mode SDK and normal result envelopes, then real Core authorization and SQLite-backed owning repositories. The external JavaScript executor and external provider responses are controlled fixtures, not live vendor verification. The actual Space authorization/message-reader boundary is exercised separately under Workerd in `services/core/tests/center-agent-evidence-source-access.integration.test.ts`, including a real posted message, a missing message, and another member's private source.

Positive and boundary evidence includes: a normal member's real audit records without borrowing an owner principal; an oversized multibyte snapshot whose structured overview fits the real result boundary; four-page live Inventory traversal and changed cursor filters/source state; selection of an older Run after definition deletion; a continuation's persisted result owner rather than its completed first delivery; independent admission, generation and publication facts; recall of a known conclusion from a new private conversation with every permitted source; a public-only fact in a shared conversation while a mixed public/private fact is withheld; no match versus provider outage/partial lookup; source revocation, missing messages, and later dated reversals without a claim of current approval. The current reply audience is reread, including conversion during provider latency.

The focused D1 migration harness also now honors index removal by actual table ownership. This applies the already-existing `0063` continuation index migration in tests; it does not add a production migration. The corrected fixture verifies that linked deliveries may share a Run while immutable admission identity still cannot be reassigned.

### Contract impact audit

The changed producer/consumer pairs are private Core Center Agent RPC receivers and Remote Agent callers, with shared derived schemas and strict parsing. Existing human Audit Log, Web/CLI Activity snapshot, HTTP Routine history, `lastRun`, interactive turn diagnostics, and automatic prompt-memory envelopes remain intact. New receiver names are additive and unavailable on Gateway. Old Core rejects new calls explicitly; there is no fallback to human identity or an oversized snapshot. Deploy receivers before callers, and roll callers back before removing receivers. This ordering is documented for review only: no deployment is part of this task. No persisted schema migration, public Gateway wire cut, or local service ABI update is introduced.

### E: verification only, not new functionality

The existing suites `center-agent-delegation-service.write.test.ts`, `center-agent-wake-publication-service.write.test.ts`, `slack-search-client.test.ts`, `slack-search-presentation.test.ts`, and `remote-agent-slack-signal-service.test.ts` passed together (127 tests). These cover controlled exact-permalink hydration and escaped presentation, event-bound Slack search authority, persisted child subscriptions/completion mode, and Wake publication/continuation ownership. They do not establish that a real user can open an old Slack link in the desktop UI, obtain a fresh live Slack grant in another turn, or complete the entire live DM-to-Space workflow. Those exact live steps remain for the separately requested Codex smoke; no grant lifetime was extended and no new delegation system was created.

### Final validation boundary

The September 21 takeover reproduced the Core type error in
`github-app-webhook-service.test.ts` on current `main` as well as this branch.
`fb6d1a5d9` types the queue spy from the vendor `Queue.send` signature. It also
found and corrected a new Space storage access typo. Core and Remote Agent full
type checks passed. The four capability suites passed (11 audit, 2 Activity,
7 Routine, and 16 memory cases), as did the two webhook tests and the real
Workerd Space evidence integration test. The latter proves authorized private
message reads, missing-message denial, another member's private-source denial,
and the owning Space's rejection of Center Agent DM conversion. Simulated
audience changes remain a separate fail-closed contract test; a successful live
Center Agent DM-to-shared conversion is not claimed.

Independent read-only review found a retained-subject deletion/opt-out race.
The regression failed before the fix; the reader now checks the existing
subject ID and update timestamp again after provider completion. No second
memory store, capture path, or execution authority was introduced.

#### Real user-entry smoke

At implementation commit `01fedb347`, normal Web login and Center Agent chat
were exercised in isolated lane `wt-4868c1e446d0`, with disposable Northstar
data. Chrome was tried first; repeated automation timeouts required the in-app
browser for the remaining steps. No production tasks were replayed.

- Audit reading returned two actual local audit entries. Activity returned an
  honest empty current overview with explicit coverage limits; populated and
  oversized Activity results have fixture coverage only.
- Historical Routine diagnostics selected failed Run
  `282982cb-02ed-422b-957c-daf2fae1d5f1` instead of its newer skipped Run,
  separating Run, workflow, and absent publication evidence. The paused
  Routine and historical rows were prepared in disposable local storage; the
  acceptance step was the normal chat request and visible answer, not SQL.
- A fictional Project Lantern decision was entered in one private chat, then
  found with retained-memory search from a newly created private chat. A
  follow-up read the original source message and verified both Friday and
  `$42 per seat` against its untruncated text. Source Space and Signal IDs were
  returned. A clickable source permalink was not returned, so link navigation
  is not verified. This is readable-source evidence, not exhaustive history or
  current-decision verification.

The local stack and Web started for this smoke were stopped afterward. No other
worktree's development environment was stopped.

The repository-wide `check:affected` attempt was stopped while waiting for the
machine's constrained-memory lease; it had not executed the checks. Only this
task's waiting job was cancelled. Other development stacks were not stopped and
the protection gate was not bypassed. `test:affected` and Final Candidate
acceptance remain pending. Scoped tests and type checks must not be represented
as either of those repository-wide gates or as live user smoke.

Final self-review also checks the actual Space-owned audience, not the public
metadata DTO, which intentionally omits private DM internals. The private
`rpcGetEvidenceReadContext` reuses Space read authorization and returns only its
current conversation classification alongside the unchanged public metadata.
Memory and Routine diagnostics reauthorize after external read latency; a
converted private conversation must not retain private disclosure authority.

### Unsupported and separately pending evidence

Explicit memory search supports retained OpenMeld DM and Space-message provenance with current source and reply-audience authorization. Slack/Lark/Feishu and legacy explicit-tool provenance without a verifiable conversation origin remain unsupported; Routine and external-channel callers cannot use this interactive reader. Routine channel destination locators are unsupported rather than exposed. Memory search is bounded, not exhaustive history or automatic current-decision verification. Activity is a bounded current view, not complete usage analytics. Real vendor/live UI smoke, cross-version deployed service smoke, production outcomes, release and deployment are not claimed. F remains follow-up hypotheses, not implemented backlog or measured usage demand.

## Exclusions and closeout

Do not add model-turn-completeness grading, automatic "should have done more" continuation, blanket permissions, a second execution/memory/task/transaction ledger, invisible transcript capture, universal history search, production repair/retry/replay, automatic merge, or deployment.

Close out with implemented slices, exact commits, tests and scenarios actually exercised, supported sources/surfaces, remaining evidence gaps, and separately scoped follow-ups. A capability that always returns unavailable is not implemented. Preserve explicit unsupported source boundaries without blocking independent useful slices.
