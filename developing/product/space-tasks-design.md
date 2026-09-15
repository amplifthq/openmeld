# Space Tasks Design

## Agent Context

- Purpose: Propose a small Space work surface that preserves accepted work, responsibility, handoffs, and delivery across conversations and Agent executions.
- Read this when: Evaluating or preparing implementation of Space Tasks, task capture, review, external issue tracking, or task-triggered continuation.
- Update this when: A product decision in this proposal is accepted, changed, implemented, or invalidated by current owner contracts.
- Do not use this for: Current production behavior, execution authority, release permission, or restoring the retired Center Agent Task product.
- Source of truth: This document owns the proposed design only. Existing scoped owner documents remain authoritative until an approved implementation updates them together.

Status: DRAFT — product design for discussion; implementation and deployment are not authorized by this document.

Removal condition: Remove when the accepted feature ships and its durable rules have been incorporated into the scoped owner documents, or when the proposal is rejected or superseded. Git history is the archive.

## 1. Product Decision

Add **Tasks** alongside **Messages** and **Files** in an eligible Space. Messages is the default place to request and discuss work. Tasks makes work that needs continued attention visible and actionable. Files holds existing Space materials and deliverables.

A Task is a piece of work explicitly accepted for tracking in a Space, with an expected result and a continuing record of responsibility, handoffs, and outcomes. Acceptance for tracking does not authorize execution. A Task can span several executions, contributors, and revisions of its approach.

The feature succeeds when users repeat less context, chase fewer updates, and can identify the next participant and inspect the result. Card count, status changes, and Agent runtime are not success metrics.

Tasks is not required for the ordinary request-and-reply loop. A request without a Task must still receive its result, an explicit failure, or a clear request for necessary input through the supported execution and publication contracts.

### First-release scope

| Included | Deferred |
| --- | --- |
| Tasks in ordinary, non-DM collaboration Spaces | Tasks in Direct Messages, private Center Agent sessions, and specialized Space kinds |
| Creation from Messages and explicit tracking requests | Ambient conversion of conversation history or automatic import of every external issue |
| Human and Agent responsibility; optional independent review | Multiple primary assignees, arbitrary reviewer chains, and mandatory organizational role hierarchies |
| One board, a task detail panel, source-thread links, and Inbox attention | Global Tasks navigation, Board/List switching, custom workflow editors, and independent Goals |
| One real execution-to-review-to-delivery path using existing coordination | A separate runtime scheduler, new Agent framework, or hosted workstation product |
| Explicit external links with honest freshness/coverage | External event ingestion until the selected provider contract is implemented and verified |

Limiting initial scope to shared collaboration Spaces is a recommendation, not a claim that DM Tasks lack value. It proves shared handoff without reviving the retired private Task product. Before expanding eligible Space kinds, inventory their full UI and mutation surfaces under the existing specialization rules.

## 2. User Experience

The first useful journey is:

1. A member requests work in Messages, identifies the desired result, and asks for continued tracking or a clear handoff.
2. The addressed Agent or member creates a Task from that request. A compact task reference appears at the source; existing discussion and work are retained.
3. The assignee starts the authorized work through the existing execution path, or records human work.
4. The assignee submits a concrete result. If independent review is required, the reviewer receives an Inbox item and a link to the result and discussion.
5. Feedback returns to the assignee. Supported continuation resumes the work within its existing authorization.
6. Completion is recorded against the agreed conditions. The designated answer owner delivers the result to the established conversation destination and notifies the requester.

Example: a member asks for a registration fix and names a QA Agent to verify it. The coding Agent submits the patch, the QA Agent requests a correction, the coding Agent revises it, and the QA Agent accepts the current result. The original requester receives the outcome without manually relaying messages between Agents.

### Board and detail

Use `Messages / Tasks / Files`. Tasks opens a board with **To do**, **In progress**, and **In review** as active columns. **Done** and **Canceled** are accessible through collapsed groups or an explicit history filter. Empty columns use compact empty states, not large placeholder cards.

A card shows the title, primary assignee, current phase, and one concrete next action or attention message. Examples: **Waiting for Jamie's answer**, **Ready for Morgan's review**, or **Agent execution failed — inspect result**. Agent availability and active execution are separate projections; a card in In progress does not imply a live process.

Details show the expected result, completion conditions, requester, creator attribution, assignee, reviewer when configured, relevant files and external references, task activity, and associated executions. Routine tool steps stay behind an execution disclosure rather than appearing as cards.

Card discussion reuses one selected Space thread. If creation from a root message needs a discussion thread, associate its thread through existing Space operations. Keep the source message reference even when later discussion uses that thread. Do not copy the conversation into a separate task comment system.

Creating a Task never retargets an already admitted execution. Delivery follows the existing Space reply-placement rules, including the current shared-Space Center Agent default, and the frozen destination of each execution. A later explicit delivery change applies only through a supported new admission or future handoff.

The empty state directs users to Messages to ask a person or Agent for work. A secondary **Add to Tasks** action on a source message supports explicit capture. There is no prominent blank-task form in the first release. Task creation is still a structured capability available to Agents and human clients.

## 3. Capture Policy

| Situation | Behavior |
| --- | --- |
| A question, explanation, lookup, or immediate small edit | Complete in Messages; no automatic Task |
| A long-running execution | Show execution progress; elapsed time alone does not create a Task |
| An explicit request to track, assign for later, or coordinate a continuing deliverable | Create or associate a Task and acknowledge it at the source |
| A follow-up, correction, progress report, or requested rework | Update the existing Task when its identity is clear |
| Agent discovers another issue | Report it or associate evidence; create another Task only under explicit tracking intent or an approved intake rule |
| A request only to file an external issue | Deliver the provider receipt; do not silently commit the Space to resolving the issue |
| Explicit request to follow an external issue in this Space | Add an external tracking entry, or link it to an existing Task |
| An arbitrary link or mention of an issue | Treat as context; no automatic tracking |

Agents may suggest **Add to Tasks** when continued tracking would help. They should not ask this question for every message or generate a backlog from inferred obligations. An accepted intake rule must specify its source and Space; it is not a general permission to scan and promote all messages.

Creating the record, assigning responsibility, and starting execution are distinct actions. A single explicit request may authorize all three; the product must not add redundant confirmation when that intent is already clear.

Creation uses a stable operation identity for exact retries. A shared source message may legitimately produce distinct tasks; source-message equality alone is not deduplication. Before creating, check known task associations. Repeated external intake for the same Space and provider object reuses its tracking entry. Titles are not identity.

Split a Task only when a subtask has an independent assignee, deliverable, or meaningful handoff. Keep ordinary investigation steps in the plan or execution history. Subtask completion is evidence for the parent; it does not automatically satisfy the parent's outcome.

## 4. Responsibility and Permission

| Role | Meaning |
| --- | --- |
| Requested by | The verified person or Agent that requested this work; preserved as provenance |
| Created by | The actor that recorded it; may differ from the requester |
| Assignee | One primary person or Agent responsible for advancing the work |
| Reviewer | Optional person or Agent authorized to assess a submitted result against the task's conditions |

Task creation can precede assignment. A Task accepted for active work has a primary assignee. A reviewer is required only when independent review is part of the requested delivery; simple work can finish from its declared evidence without another human checkpoint.

The requester comes from trusted source attribution. An Agent creating a task for a human does not become the requester merely by using the tool. If the actual external requester cannot be mapped, retain provider provenance separately and do not invent a Human Profile or grant a role.

Proposed permission baseline:

- Reads follow the owning Space's current content-access contract. Public links, search results, and aggregation do not grant mutation permission.
- Task mutations require an eligible active Space member and action-specific authorization. Agent calls carry the verified execution and represented-requester context required by existing contracts.
- The requester, current assignee, or Space owner may edit the work brief and propose reassignment. The accepting action must not enlarge execution scope or disclose context to an ineligible target.
- The requester or Space owner sets or changes the review requirement and Reviewer. The assignee may propose a change but cannot remove independent review by reassigning it to themselves. An independent Reviewer differs from the actor that submitted the result.
- The current assignee submits a result. When independent review is required, the configured reviewer accepts it or requests changes. A Space owner may make an explicit, attributed override with a reason; overriding does not fabricate missing evidence.
- Reassigning the reviewer or materially changing the brief/result invalidates pending review of the previous version. Changing a role is not approval of the result.
- Declining an assignment leaves an explicit need for reassignment; it does not silently finish or cancel the work.
- The requester, current assignee, or Space owner may cancel with a reason while retaining the record. Reopening requires an explicit request from the requester or Space owner and a fresh assignment decision; it never restarts an old run by itself.

Task roles do not change the existing rights to stop a Wake, answer a private Controller interaction, access a Computer, merge a PR, or publish externally. In particular, being a Reviewer does not make an actor the Binding owner. Required account connection and human interaction use their existing private surfaces.

The first implementation must pair UI eligibility with server rejection for unsupported Space kinds and unauthorized actions. Source actor resolution for connected Message Channel members must use existing contracts; the Task feature cannot create membership or broaden their current capabilities.

## 5. Lifecycle, Evidence, and Concurrency

These phases describe native Space Tasks. External tracking entries use the source-status rules in section 9.

| Phase | Meaning | Normal transitions |
| --- | --- | --- |
| To do | Accepted for tracking; not yet actively being advanced | In progress, Canceled |
| In progress | The work is being advanced, including explicit waiting between steps | In review, Done when independent review is not required, To do after an explicit stop/defer decision, Canceled |
| In review | A specific submitted result awaits the configured review | Done, In progress for requested changes, Canceled |
| Done | The current delivery meets its recorded completion conditions | Reopen explicitly for more work |
| Canceled | The work will no longer be pursued | Reopen explicitly to To do |

An explicit start may leave the Task in To do while its execution is queued. Confirmed execution admission/progress or an authorized human start supplies the evidence for In progress. Assignment alone does not claim activity.

Waiting, execution failure, and delivery failure remain explicit details associated with the phase. A failed run does not erase work already completed or automatically move the Task backward. Show the actual failure and next recovery action. Ending a model turn to await a callback does not complete the Task.

Independent review references the submitted result and the brief/completion conditions being reviewed. A recorded approval of an earlier patch or file revision cannot accept a later one. A new result starts a new review cycle. Unclear conversational feedback is not silently interpreted as approval; offer the relevant structured action in the discussion or task detail.

Completing work records the available evidence: submitted artifact references, relevant execution results, and the current review decision where required. An Agent assertion, successful command exit, PR merge, deployment, and real-user validation have different meanings. Completion depends on the task's declared delivery boundary.

Task mutation commands use revision preconditions for changes that can conflict, including assignment, scope, result submission, review, reopen, and cancellation. Responses return the resulting revision and applied outcome. Exact operation retries return the original receipt rather than executing again. Agent and human clients use the same commands; neither edits storage directly.

Reassignment during an active execution is an explicit handoff. It records the new responsibility but cannot let an old callback submit as the new assignee or start overlapping work merely because the label changed. New execution must pass the existing admission and resource-ownership rules; old work must be reconciled or stopped through its existing owner before a conflicting replacement starts.

Cancel fences further task-triggered work immediately. It requests cancellation of linked active executions only through the existing authorized Stop path. If the actor cannot stop an execution, or stopping is unconfirmed, preserve that fact and show that execution separately. **Canceled** does not mean every process has stopped or every side effect was undone.

Late callbacks retain their evidence but cannot reopen a canceled task, satisfy a superseded review, or start another delivery. Reopen is a new explicit decision; it does not replay the former execution automatically. The history retains previous completion and cancellation decisions. Archive/history presentation preserves the record; irreversible task deletion is outside the first release.

## 6. Automatic Handoffs

Task automation reacts to accepted events. It does not repeatedly ask a model to scan the board.

| Event | Deterministic responsibility | Where Agent judgment helps |
| --- | --- | --- |
| Work explicitly started | Admit one execution through existing routing and record its exact reference | Select the capable execution path within the request |
| Linked execution reaches a terminal outcome | Record evidence and activate only its declared continuation | Decide whether the requested result is ready, partial, or blocked |
| Result submitted | Record the result/version and create one reviewer attention item or an authorized review execution | Evaluate the result against the brief |
| Changes requested | Preserve findings and hand them back to the assignee | Plan and perform the correction within existing scope |
| Necessary information supplied | Resolve the exact pending request and continue through its supported path | Interpret the information and choose the next step |
| Task completes | Record one completion event and request the designated delivery | Explain the result and its limits |

Creating or changing a Reviewer does not start an Agent by itself. The original requested review, an explicit start, or an approved rule must authorize the execution. Manual human steps remain available when no Agent is appropriate.

Task events and pending handoff intent must be durable. Reuse an existing outbox/delivery seam where its semantics fit. A task-owned pending intent records an owed operation; it does not reserve a runtime, own a lease, invent execution success, or become a general scheduler. Before implementation, resolve its transactional persistence and retry interface with the current owners.

Bind each handoff to the Task revision, submission/review cycle, exact target, and existing execution identity. Recheck current access, role, operating state, cancellation, and target eligibility before dispatch. Duplicate events must not create duplicate work. When an earlier dispatch may have succeeded, reconcile its existing receipt before attempting any new admission.

Center Agent coordinates when synthesis, delegation, or routing judgment is needed. Straightforward state reads, metadata refreshes, and notification bookkeeping do not require a model call. Active participants can operate the same Task directly within their permissions.

If a necessary event cannot be observed reliably, expose the limitation and a concrete next action. Do not promise an automatic return, substitute a Routine, or recreate the work with periodic prompts. Scheduled recurring work remains owned by Routines.

## 7. Delivery and Attention

The basic request/response loop works with or without Tasks. A Task adds continuing tracking and, when configured, a review barrier; it uses the existing publication and notification machinery.

Separate three facts: work has met its completion conditions, the result was published to the intended conversation, and the requester was notified. If publication fails, preserve completion evidence and show **Completed — result delivery needs attention**. Retry only the owed publication through its existing idempotent path, never the underlying work.

The original admission/delivery record remains authoritative for requester identity and reply placement. A Task keeps references for navigation and future handoffs, not a competing destination authority for an active execution. New task-triggered executions use an explicitly resolved destination at admission.

Use one answer owner per requested delivery. A child may publish directly only when it fully satisfies that request and the existing completion policy permits it. Otherwise, the coordinator synthesizes the outcome. The task service and coordinator must not both publish independent completion messages.

The selected conversation contains the full result and links to the Task and artifacts. Inbox carries a concise attention item that opens that result. DM delivery is an explicit preference or instruction, not an automatic second copy or a fallback when a shared source becomes unavailable.

Review requests go to the Reviewer; requested changes go to the Assignee; final delivery goes to the Requester. Agent recipients receive actual supported handoffs rather than relying on incidental mention text. Subtask results return to their coordinating parent where appropriate, avoiding a separate notification to the original human for every internal step.

Recheck access before publication and notification. If a source conversation is deleted, inaccessible, or no longer appropriate, report the delivery blocker without exposing its content elsewhere. Changing a destination requires a supported, authorized action.

## 8. Scope and Data Ownership

Each Task has one immutable owning Space in the first release. Its canonical identity is distinct from message IDs, external issue IDs, Task Handles, Wake IDs, and native controller conversation IDs. Tasks do not create Agent Profiles, Computers, or isolated execution contexts merely to obtain a card identity.

| Fact | Proposed owner | Readers and recovery |
| --- | --- | --- |
| Native Task brief, roles, phase, review, and activity | A Space Task service in the owning Space Durable Object; mutations enter through its authorized commands | Space-authorized snapshots; canonical records cannot be rebuilt from model summaries |
| Task/execution associations and pending task handoff intent | The same Task owner, referencing existing executions | Reconcile exact operation/execution receipts; never infer ownership from a title |
| Workstation admission and execution | Existing Profile Work Coordinator and RuntimeCoordinator within their current boundaries | Tasks consumes their projections and terminal evidence |
| Hosted execution and native result destination | Existing Remote Agent and Core Native Delivery contracts | Tasks links evidence; does not overwrite these records |
| External issue/PR metadata and source state | The external provider; existing integration owner validates and projects it | Re-fetch after connection recovery; stale/unavailable stays visible |
| Attention, notification, and Space publication | Existing source-owned Inbox and Space delivery paths | A durable task event can request delivery, but is not publication proof |

This proposes logical ownership, not a finalized database migration or class layout. Any organization-wide Task index is a rebuildable read projection and must revalidate source access. No global Task writer, second execution scheduler, or private Flue-state reads are introduced.

Future global Tasks should mean tasks accessible to the current viewer in the selected Organization, with explicit filters and source labels. It must not expose private DM tasks to other members or silently omit a supported source kind. Initial shared-Space scope is presented consistently; unsupported DM/specialized kinds hide Tasks and reject creation, list, and mutation endpoints rather than exposing empty functional controls.

Task content uses existing Space visibility. Private source material and external credentials do not become shareable merely because a Task links to them. Disclosing a private request into a shared Task requires authorized, bounded content; private history, tokens, and native local paths are not copied.

## 9. External Issues and Pull Requests

Use two explicit relationships, not two writers for the same status:

1. **Track an external issue:** the Space entry shows provider-owned fields and source status. It records local source-discussion and follow-up references, but does not maintain a competing editable completion state. First-release operations can open the source; later write-through actions become visible as applied only after provider confirmation.
2. **Link evidence to a native Task:** one or more issues/PRs support a separately defined Space deliverable. The native Task owns that broader commitment and its acceptance. External closure is evidence, not automatic satisfaction of the broader work.

Adding extra acceptance requirements to a tracking entry is an explicit decision to create or link a native Task with a distinct delivery scope. It must not silently turn one external issue into two copies of the same work.

| Confirmed source event | Tracking entry | Native Task with linked evidence |
| --- | --- | --- |
| PR associated | Show relationship, author, and PR state | Add evidence; preserve current assignee |
| Review changes requested or checks fail | Show actual source outcome | Hand off when a declared rule applies; otherwise flag attention |
| PR merged | Show merged fact; refresh actual issue state | Reassess applicable completion/review conditions |
| Issue closed as completed | Show provider completion | Complete only if this fulfills the declared delivery conditions |
| Issue canceled or closed as not planned | Preserve exact reason | Require a decision about any remaining native commitment |
| Issue reopened | Show source reopened | Surface renewed attention; do not automatically replay prior work |
| PR closed unmerged or unlinked | Update the evidence relationship and retain history | Do not finish the Task merely because that PR ended |

Provider identity includes the connection/workspace or repository scope and stable object identifier. Ordinary mentions, closing relationships, and resolved issues are different facts. A stale event cannot replace a newer source snapshot. Webhook handling validates provenance, deduplicates deliveries, refreshes relevant current state, and uses bounded reconciliation for missed events.

Connection loss shows the last confirmed observation and an unavailable/stale indicator. Reconnection refreshes facts; it is not permission to replay side effects. External content remains untrusted, and callbacks grant no new execution authority.

Implement one provider only after there is an actual intake use case. Before enabling automatic flow, verify its real permission model, event coverage, relationship semantics, missed-event recovery, and current-state reads. Until then, links are explicitly links, not monitored dependencies.

## 10. Delivery Slices and Acceptance

### Slice A: Shared work with one complete handoff

Deliver capture from Messages, stable Task identity, roles, board/detail, result submission, optional review and rework, existing execution references, Inbox attention, and accurate original-conversation delivery. Include one real authorized Agent handoff; a static board alone does not satisfy this slice.

| Acceptance scenario | Required observation |
| --- | --- |
| A normal question and an explicit tracking request | Only the latter creates a Task; both receive the promised response |
| Exact create retry and a follow-up to the same work | No duplicate Task or restarted execution |
| Assignment without start, and assignment with explicit start | Responsibility and actual execution are shown accurately |
| Human requester, Agent assignee, human or Agent reviewer | Each eligible role can perform its intended operation; ineligible actors are rejected |
| Changes requested and a new submission | Feedback reaches the assignee; old approval cannot complete the new result |
| Agent callback delivered twice, late, or after reassignment | No duplicate handoff, stale acceptance, or revived task |
| Task cancellation while an execution is active | Further task work is fenced; actual Stop authority and pending stop outcome remain honest |
| Execution failure, no-review completion, and reviewed completion | Phase and result reflect the actual completion contract |
| Completed work with failed publication | Work is not rerun; delivery failure and exact retry are visible |
| Refresh, leave/re-enter, and current access revocation | State remains recoverable; inaccessible data and mutation controls are not exposed |
| DM and specialized Space entry points | Tasks is absent and unsupported server operations reject; ordinary messaging still works |

Use focused behavior tests at the owner seam, then supported real-user entry points for the shared handoff. Follow repository test guidance; do not build broad test suites that only mirror schema or UI implementation.

### Slice B: One external source

Only after Slice A and a demonstrated intake need, add one provider's external tracking and events. Verify another person's linked PR, close with different reasons, reopen, missed/duplicate/reordered delivery, and revoked connection. No event should silently start unapproved work or broaden source visibility.

### Later decisions

Consider cross-Space personal aggregation when users repeatedly miss work across rooms. Consider Intake/Triage when substantial unaccepted work must be reviewed before admission. Consider independent Goals when an outcome needs a lifecycle beyond changing delivery plans. Consider workflow customization only after repeated workflows cannot be expressed clearly with the initial handoffs.

Measure requester follow-up effort, repeated context, unhandled handoffs, unnecessary cards/notifications, incorrect completion claims, rework, and execution cost. Compare the same kinds of work with the existing conversation-only experience; do not publish efficiency claims from feature presence or card throughput.

## 11. Current Baseline and Implementation Decisions

This proposal was checked against local source at `5501efa1d` on 2026-09-15. It does not certify deployment or runtime behavior.

- [Space collaboration](space-collaboration.md) defines the current Board as a read-only summary and Threads as conversation placement. Tasks adds a separate work capability rather than redefining those existing objects implicitly.
- [Organizations and Center Agent](organizations-and-center-agent.md) retires the old private Center Agent Task product and rejects a heavyweight workflow system. An older Task-retirement sentence remains in the Space session section; reconcile that conflict during approved owner-document updates. Historical Task storage is not an implementation shortcut.
- [Task coordination prompt](../../services/remote-agent/agent-core/prompt/task-coordination.ts) and [execution schemas](../../packages/schemas/src/schemas/runtime/agent-task-coordination.ts) supply existing delegation/watch/continuation contracts. They are execution references, not a user task registry.
- [Space tabs](../../clients/web/src/components/spaces/space-view-tabs.tsx) currently exposes Messages and Files. Tasks would be a new view, with scoped eligibility rather than a renamed execution summary.

Before implementing, settle these concrete details in the owning contracts:

1. Approve initial Space-kind eligibility and the task-specific mutation/override policy, including external requester attribution.
2. Define the Task owner's exact schemas, revision checks, atomic event persistence, and handoff adapter to existing coordination/publication contracts. Physical tables and migrations remain implementation work.
3. Define how conversational review resolves to an explicit, authorized action and how a result version is identified for each artifact type.
4. Confirm the supported execution and continuation paths for both assignee and reviewer; name any capability gap rather than claiming uniform runtime support.
5. Choose the first external provider only when intake is included, and settle which source fields and status categories can be projected faithfully.

The implementation must update [Space collaboration](space-collaboration.md), [Organizations and Center Agent](organizations-and-center-agent.md), [data ownership](../architecture/data-and-observability.md), [shared contracts](../architecture/shared-contracts.md), [Web](../clients/web.md), [CLI](../clients/cli.md), and [Inbox](inbox.md) for the behavior each owns. Update [Remote Agent](remote-agent-runtime.md) and execution owner documents only for actual touched contracts.

Shared cross-client/service payloads belong in `packages/schemas`, using the existing validation and error conventions. UI invalidations remain refresh signals. Apply the Contract Impact Audit and local-component release checks when the eventual implementation touches their paths. Decide and author a Changelog entry when user-visible behavior ships; this draft alone does not create a product release.

Architecture acceptance: the proposal adds a canonical owner for native work and review, while preserving current owners of identity, admission, runtime execution, readiness, publication, external state, and notifications. It authorizes no duplicate execution truth, implicit destination changes, or permission expansion. Approval of an implementation must include the corresponding explicit owner-document changes.
