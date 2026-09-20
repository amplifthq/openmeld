# Space Tasks Design

## Agent Context

- Purpose: Propose a small Space work surface that preserves accepted work, responsibility, handoffs, and delivery across conversations and Agent executions.
- Read this when: Evaluating or preparing implementation of Space Tasks, task capture, review, external issue tracking, or task-triggered continuation.
- Update this when: A product decision in this proposal is accepted, changed, implemented, or invalidated by current owner contracts.
- Do not use this for: Current production behavior, execution authority, release permission, or restoring the retired Center Agent Task product.
- Source of truth: Scoped owner documents own implemented behavior. This file
  retains the product rationale, acceptance scenarios, and deferred increments.

Status: IMPLEMENTING — product decisions and first-release contracts are
implemented in the WIP change. This document does not certify merge,
deployment, or production availability.

Removal condition: Remove when the accepted feature ships and its durable rules have been incorporated into the scoped owner documents, or when the proposal is rejected or superseded. Git history is the archive.

### Confirmed decisions — interview round 1

The following product decisions were confirmed during design discussion. They define the first-release product scope and the deferred follow-ups. Engineering details listed in section 11 remain to be specified; product agreement does not authorize implementation.

| Decision | Rationale |
| --- | --- |
| A Task records the work OpenMeld participants accept, including an explicit follow-up-and-report request. External issues are references, not a second kind of card with a different state owner. | Tracking another team's fix must not imply responsibility for implementing it. |
| The first release supports ordinary shared collaboration Spaces, without DM Tasks or global Tasks navigation. | Prove shared handoffs before introducing private-task and aggregation surfaces. |
| Without required independent review, completion follows the requested delivery boundary and supporting evidence. | Avoid mandatory human approval for every card while preserving actual completion conditions. |

### Confirmed decisions — interview round 2

| Decision | Rationale |
| --- | --- |
| A clear request for a discrete deliverable can create a Task automatically, without a separate tracking phrase; ordinary questions and immediate small operations remain in Messages. | Preserve a delivery record without requiring users to learn task-creation commands. |
| A directly addressed Agent is the assignee of the work entrusted to it; Center Agent is not a mandatory intermediary. | Avoid a coordination turn that merely repeats an already clear assignment. |
| Discussion is shared, while changes to work commitments and review are role-controlled. | Collaboration must not allow unrelated participants to silently cancel work or replace its acceptance conditions. |

### Confirmed decisions — interview round 3

| Decision | Rationale |
| --- | --- |
| Changing the assignee alone does not start execution; an explicit request to perform the work can create, assign, and start it together. | Preserve both intentional scheduling and direct conversational delegation without redundant clicks. |
| Canceling a Task fences future work and requests authorized stops of linked executions; stopping one execution does not cancel the Task. | Cancellation must address ongoing work without fabricating process termination or undoing effects. |
| Explicit correction of the original deliverable reopens the Task; a distinct new deliverable becomes a linked Task. | Preserve rework context without letting a completed Task accumulate unrelated scope. |

### Confirmed decisions — interview round 4

| Decision | Rationale |
| --- | --- |
| Tasks reuse the source Thread; several Tasks may share one Thread, with explicit task references when an action would otherwise be ambiguous. | Preserve conversation context without creating a new discussion for every card. |
| Clear natural-language acceptance is supported through the same authorized, revision-bound command as a review button. | Keep collaboration conversational without treating casual feedback as approval. |
| The first release completes the internal work/review/delivery loop. Automatic GitHub and Linear event follow-up is a later increment, with GitHub first. | Verify task collaboration separately from provider event coverage and recovery. |

### Confirmed decision — interview round 5

| Decision | Rationale |
| --- | --- |
| Permit at most two automatic rework rounds after initial implementation, then require a human decision before another round. Escalate earlier for a real blocker or scope/authority change. | Bound unproductive Agent-to-Agent cycles without interrupting healthy in-flight execution or marking unfinished work complete. |

## 1. Product Decision

Add **Tasks** alongside **Messages** and **Files** in an eligible Space. Messages is the default place to request and discuss work. Tasks makes work that needs continued attention visible and actionable. Files holds existing Space materials and deliverables.

A Task is a piece of work explicitly accepted by OpenMeld participants in a Space, with an expected result and a continuing record of responsibility, handoffs, and outcomes. That work may be producing a deliverable or following an external event and reporting its outcome. Recording a Task does not authorize actions beyond the request. A Task can span several executions, contributors, and revisions of its approach.

The feature succeeds when users repeat less context, chase fewer updates, and can identify the next participant and inspect the result. Card count, status changes, and Agent runtime are not success metrics.

Tasks is not required for the ordinary request-and-reply loop. A request without a Task must still receive its result, an explicit failure, or a clear request for necessary input through the supported execution and publication contracts.

### Proposed vocabulary

These definitions describe the WIP product. They do not rename existing
execution Task Handles or claim production availability.

| Term | Definition |
| --- | --- |
| Space Task | The continuing record of a piece of work accepted in a Space and the result its participants owe. User-facing name: Task. |
| External work item | An issue or ticket whose identity and source state belong to its external provider. A Task can reference it. |
| Completion condition | A requirement that must be supported by evidence before the Task can be completed. |
| Independent review | Assessment of a specific submitted result by an authorized Reviewer other than its submitter, when the request or governing policy requires it. |
| Assignment | The recorded responsibility for advancing a Task. Assignment by itself is not a request to start an execution. |
| Start request | An authorized instruction to perform the work through existing execution admission. A pending start is not evidence that the Agent is running. |

### First-release scope

| Included | Deferred |
| --- | --- |
| Tasks in ordinary, non-DM collaboration Spaces | Tasks in Direct Messages, private Center Agent sessions, and specialized Space kinds |
| Creation from clear delivery requests in Messages and explicit tracking requests | Ambient conversion of conversation history or automatic import of every external issue |
| Human and Agent responsibility; optional independent review | Multiple primary assignees, arbitrary reviewer chains, and mandatory organizational role hierarchies |
| One board, a task detail panel, source-thread links, and Inbox attention | Global Tasks navigation, Board/List switching, custom workflow editors, and independent Goals |
| One real execution-to-review-to-delivery path using existing coordination | A separate runtime scheduler, new Agent framework, or hosted workstation product |
| Explicit GitHub issue association from authorized GitHub tools, with tool-path close sync and a close prompt when the Task finishes first | External event ingestion, webhooks, and Linear association until those provider contracts are implemented and verified |

Initial shared-Space scope is confirmed. It proves shared handoff without reviving the retired private Task product. Before expanding eligible Space kinds, inventory their full UI and mutation surfaces under the existing specialization rules.

## 2. User Experience

The first useful journey is:

1. A member requests a discrete deliverable in Messages, or explicitly asks to track, schedule, or hand off work. They do not need to say "create a Task."
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

Card discussion reuses the source Space Thread when one exists; a Task does not require its own new Thread. Several Tasks may share the same discussion. A message sent from task detail includes the exact Task reference so participants can distinguish its subject. If a plain message in a shared Thread has an ambiguous task target, clarify before mutating any Task; do not infer the target from title similarity or the most recently changed card. If creation from a root message needs a discussion Thread, associate it through existing Space operations. Keep the source message reference even when later discussion explicitly branches into a new Thread. Do not copy the conversation into a separate task comment system.

Creating a Task never retargets an already admitted execution. Delivery follows the existing Space reply-placement rules, including the current shared-Space Center Agent default, and the frozen destination of each execution. A later explicit delivery change applies only through a supported new admission or future handoff.

The empty state directs users to Messages to ask a person or Agent for work. A secondary **Add to Tasks** action on a source message supports explicit capture. There is no prominent blank-task form in the first release. Task creation is still a structured capability available to Agents and human clients.

## 3. Capture Policy

| Situation | Behavior |
| --- | --- |
| A question, explanation, lookup, or immediate small edit | Complete in Messages; no automatic Task |
| A long-running execution | Show execution progress; elapsed time alone does not create a Task |
| A clear delivery request such as fixing a defect and submitting a PR | Automatically create or associate one Task, even when one execution may finish it; no extra creation confirmation |
| An explicit request to track, assign for later, or coordinate a continuing deliverable | Create or associate a Task and acknowledge it at the source |
| A follow-up, correction, progress report, or requested rework | Update the existing Task when its identity is clear |
| Agent discovers another issue | Report it or associate evidence; create another Task only under explicit tracking intent or an approved intake rule |
| A request only to file an external issue | In a shared Space, GitHub issues filed through OpenMeld's GitHub tools also record a linked Space Task as the collaboration receipt, with mutual references. That does not import every GitHub issue or claim the Space is implementing the issue. Direct Messages still file the issue without a Task. |
| Explicit request to follow an external issue and report its outcome | Create or associate a Task for that follow-up obligation; reference the external issue and verify the required observation capability |
| An arbitrary link or mention of an issue | Treat as context; no automatic tracking |

Automatic capture follows the accepted request, not an artifact-shaped response or elapsed runtime. For example, explaining a registration error stays in Messages; fixing it and submitting a PR creates one Task; arranging it for next week with a named reviewer also creates one Task. A quick task is acceptable when it records an actual delivery obligation. Filing a GitHub issue from a shared Space is itself an accepted deliverable receipt and records the linked Task described above.

When intent does not clearly meet these criteria, Agents may suggest **Add to Tasks** rather than silently creating work. They should not ask this question for every message or generate a backlog from inferred obligations. An accepted intake rule must specify its source and Space; it is not a general permission to scan and promote all messages.

Creating the record, assigning responsibility, and starting execution are distinct actions. A single explicit request may authorize all three; the product must not add redundant confirmation when that intent is already clear.

A card-level assignee change records responsibility only. "Please fix this and submit a PR" also requests execution and does not require a second Start click. "Arrange this for next week" remains planned work in To do; it does not silently create a timer. A request for automatic future execution must use an explicitly supported scheduling capability and its existing authorization. Tasks adds no scheduler in the first release.

Creation uses a stable operation identity for exact retries. A shared source message may legitimately produce distinct tasks; source-message equality alone is not deduplication. Before creating, check known task associations. Duplicate intake for the same request reuses its Task, but one external issue may support distinct obligations such as implementing a fix and reporting closure. Matching external IDs or titles alone must not merge those obligations.

Split a Task only when a subtask has an independent assignee, deliverable, or meaningful handoff. Keep ordinary investigation steps in the plan or execution history. Subtask completion is evidence for the parent; it does not automatically satisfy the parent's outcome.

## 4. Responsibility and Permission

| Role | Meaning |
| --- | --- |
| Requested by | The verified person or Agent that requested this work; preserved as provenance |
| Created by | The actor that recorded it; may differ from the requester |
| Assignee | One primary person or Agent responsible for advancing the work |
| Reviewer | Optional person or Agent authorized to assess a submitted result against the task's conditions |

Task creation can precede assignment. A Task accepted for active work has a primary assignee. A reviewer is required only when independent review is part of the requested delivery; simple work can finish from its declared evidence without another human checkpoint.

A directly addressed Agent owns the Task entrusted to it. The system can deliver its submitted result to the named Reviewer and return authorized rework to that same assignee without requiring Center Agent to take over. Center Agent owns work explicitly entrusted to it, including any agreed coordination responsibility. Mentioning an Agent as context does not assign it work, and a group request with ambiguous ownership does not silently select an assignee.

Without a required Reviewer, the authorized assignee may complete the Task when its completion conditions are evidenced; the requester does not have to approve every result. For example, "fix the issue and submit a PR" can finish after the required fix, checks, and PR submission. "Deploy and verify the fix" remains unfinished until that later evidence exists. An assertion that the work is done is insufficient by itself. Existing action-specific approval requirements still apply.

The requester comes from trusted source attribution. An Agent creating a task for a human does not become the requester merely by using the tool. If the actual external requester cannot be mapped, retain provider provenance separately and do not invent a Human Profile or grant a role.

Confirmed role rules, subject to existing Space and execution authorization:

- Reads follow the owning Space's current content-access contract. Public links, search results, and aggregation do not grant mutation permission.
- Participants who may contribute to the associated discussion can add context and suggest changes. That participation alone does not allow them to change task responsibility, cancel work, alter review requirements, or accept a result.
- Task mutations require an eligible active Space member and action-specific authorization. Agent calls carry the verified execution and represented-requester context required by existing contracts.
- The requester, current assignee, or Space owner may edit the work brief and propose reassignment. The accepting action must not enlarge execution scope or disclose context to an ineligible target.
- The requester or Space owner sets or changes the review requirement and Reviewer. The assignee may propose a change but cannot remove independent review by reassigning it to themselves. An independent Reviewer differs from the actor that submitted the result.
- The current assignee submits a result. When independent review is required, the configured reviewer accepts it or requests changes. A Space owner may make an explicit, attributed override with a reason; overriding does not fabricate missing evidence.
- Reassigning the reviewer or materially changing the brief/result invalidates pending review of the previous version. Changing a role is not approval of the result.
- Declining an assignment leaves an explicit need for reassignment; it does not silently finish or cancel the work.
- The requester, current assignee, or Space owner may cancel with a reason while retaining the record. Reopening requires an explicit request from the requester or Space owner and a fresh assignment decision; it never restarts an old run by itself.

Task roles do not change the existing rights to stop a Wake, answer a private Controller interaction, access a Computer, merge a PR, or publish externally. In particular, being a Reviewer does not make an actor the Binding owner. Required account connection and human interaction use their existing private surfaces.

The implementation pairs UI eligibility with server rejection for unsupported
Space kinds and unauthorized actions. Source actor resolution uses existing
contracts; the Task feature cannot create membership or broaden capabilities.

## 5. Lifecycle, Evidence, and Concurrency

These phases describe all Space Tasks, including follow-up obligations referencing external work. External source state is displayed separately under section 9.

| Phase | Meaning | Normal transitions |
| --- | --- | --- |
| To do | Accepted for tracking; not yet actively being advanced | In progress, Canceled |
| In progress | The work is being advanced, including explicit waiting between steps | In review, Done when independent review is not required, To do after an explicit stop/defer decision, Canceled |
| In review | A specific submitted result awaits the configured review | Done, In progress for requested changes, Canceled |
| Done | The current delivery meets its recorded completion conditions | Reopen explicitly for more work |
| Canceled | The work will no longer be pursued | Reopen explicitly to To do |

An explicit start may leave the Task in To do while its execution is queued. Confirmed execution admission/progress or an authorized human start supplies the evidence for In progress. Assignment alone does not claim activity.

Waiting, execution failure, and delivery failure remain explicit details associated with the phase. A failed run does not erase work already completed or automatically move the Task backward. Show the actual failure and next recovery action. Ending a model turn to await a callback does not complete the Task.

Independent review references the submitted result and the brief/completion conditions being reviewed. A recorded approval of an earlier patch or file revision cannot accept a later one. A new result starts a new review cycle.

An explicit conversational instruction such as "Review passed; mark this Task complete" may invoke the same command as the review button without an extra click. The command must identify the Task, the latest submission being accepted, its expected revision, and the verified author of the instruction. An Agent interpreting a human message acts on that human's authorized instruction; it does not substitute its own Reviewer identity. Server-side role and revision checks apply to both entry points. Casual praise, an acknowledgement, quoted text, or an ambiguous task/result reference does not count as acceptance; clarify or offer the exact structured action instead. This task acceptance capability does not reinterpret private provider approvals or authorize other external actions.

Completing work records the available evidence: submitted artifact references, relevant execution results, and the current review decision where required. An Agent assertion, successful command exit, PR merge, deployment, and real-user validation have different meanings. Completion depends on the task's declared delivery boundary.

Task mutation commands use revision preconditions for changes that can conflict, including assignment, scope, result submission, review, reopen, and cancellation. Responses return the resulting revision and applied outcome. Exact operation retries return the original receipt rather than executing again. Agent and human clients use the same commands; neither edits storage directly.

Reassignment during an active execution is an explicit handoff. It records the new responsibility but cannot let an old callback submit as the new assignee or start overlapping work merely because the label changed. New execution must pass the existing admission and resource-ownership rules; old work must be reconciled or stopped through its existing owner before a conflicting replacement starts.

Cancel fences further task-triggered work immediately. It requests cancellation of linked active executions only through the existing authorized Stop path. If the actor cannot stop an execution, or stopping is unconfirmed, preserve that fact and show that execution separately. **Canceled** does not mean every process has stopped or every side effect was undone.

Show **Stopping linked execution** while an authorized stop is pending. If stopping fails or requires another actor, the canceled Task keeps an explicit message such as **Canceled — linked execution needs attention**, with the available recovery action. Task cancellation never implicitly reverts files, closes a PR, or deletes an external resource. A user who only stops an execution keeps the Task and its delivery obligation; show that work is stopped and needs a next decision rather than claiming completion or automatically restarting it.

Late callbacks retain their evidence but cannot reopen a canceled task, satisfy a superseded review, or start another delivery. Reopen is a new explicit decision; it does not replay the former execution automatically. The history retains previous completion and cancellation decisions. Archive/history presentation preserves the record; irreversible task deletion is outside the first release.

An authorized request to fix a defect in the original deliverable reopens that Task and starts a fresh work/review cycle when execution is requested. For example, a reported failure of the old-user registration link belongs to the completed registration-link fix. A request for a new mail-template editor is a distinct linked Task. Preserve prior completion and review records, and judge the new submission against the current conditions. Ordinary comments and questions do not reopen work; unclear scope or task identity requires clarification before mutation.

## 6. Automatic Handoffs

Task automation reacts to accepted events. It does not repeatedly ask a model to scan the board.

| Event | Deterministic responsibility | Where Agent judgment helps |
| --- | --- | --- |
| Work explicitly started | Admit one execution through existing routing and record its exact reference | Select the capable execution path within the request |
| Linked execution reaches a terminal outcome | Record evidence and activate only its declared continuation | Decide whether the requested result is ready, partial, or blocked |
| Result submitted | Record the result/version and create one reviewer attention item or an authorized review execution | Evaluate the result against the brief |
| Changes requested | Preserve findings; an Agent-to-Agent handback admits authorized rework within the automatic-round limit, or requests a human decision; a change request from a person returns the Task to In progress directly | Plan and perform the correction within existing scope |
| Necessary information supplied | Resolve the exact pending request and continue through its supported path | Interpret the information and choose the next step |
| Task completes | Record one completion event and request the designated delivery | Explain the result and its limits |

Creating or changing a Reviewer does not start an Agent by itself. The original requested review, an explicit start, or an approved rule must authorize the execution. Manual human steps remain available when no Agent is appropriate.

### Automatic rework boundary

The first release permits at most two automatic rework rounds between an Agent assignee and an Agent Reviewer after initial implementation, before requiring a fresh human decision. Initial implementation and its first review do not count. A round consists of one admitted automatic correction followed by review of the resulting submission. Duplicate events and retries reconciling that same correction do not create or count another round.

This limit applies only to the Agent-to-Agent cycle. When a person reviews the result, their change request is already a human decision and returns the Task to In progress directly; it neither consumes nor trips the automatic-round budget.

If the second corrected submission still fails review, do not start another automatic correction. Keep the Task unfinished and show **Needs decision — two rework rounds did not pass review**. Retain the latest result, review findings, and a concise account of what changed in each attempt. Ask the requester to decide whether to continue, revise the requirements, reassign the work, or cancel. Each option remains subject to the role and execution-permission rules in section 4.

Escalate earlier when the next correction would exceed the original scope, lacks required permission, or encounters a blocker that prevents useful progress. Do not spend the remaining rounds merely to reach the limit. Escalation to a person cannot be satisfied by either participating Agent approving another round. When the requester is an Agent, propagate the need for a human decision through the recorded request/coordination context rather than resetting the limit automatically.

Enforce the limit at admission of the next automatic correction, not with a wall-clock timeout on an active execution. A healthy correction or review already in flight continues under its existing execution contract. Reassignment, restart, a duplicate review result, or a metadata edit does not reset the count. An explicit human continuation records the additional work being authorized; it is not permission for unlimited future rework or replay of an uncertain effect.

The Task owner records the rounds with their exact handoff and submission references so the boundary survives reconnects. This is a condition on Task continuation, not another runtime budget or execution scheduler. Two rounds is the confirmed conservative starting policy; later changes should be informed by review success, rework cost, and human intervention evidence.

Task events and pending handoff intent must be durable. Reuse an existing outbox/delivery seam where its semantics fit. A task-owned pending intent records an owed operation; it does not reserve a runtime, own a lease, invent execution success, or become a general scheduler. Before implementation, resolve its transactional persistence and retry interface with the current owners.

Bind each handoff to the Task revision, submission/review cycle, exact target, and existing execution identity. Recheck current access, role, operating state, cancellation, and target eligibility before dispatch. Duplicate events must not create duplicate work. When an earlier dispatch may have succeeded, reconcile its existing receipt before attempting any new admission.

Center Agent coordinates when work is entrusted to it or an authorized handoff requires its synthesis, delegation, or routing judgment. Directly assigned work keeps its own assignee and does not automatically acquire Center Agent as an intermediary. Straightforward state reads, metadata refreshes, and notification bookkeeping do not require a model call. Active participants can operate the same Task directly within their permissions.

If a necessary event cannot be observed reliably, expose the limitation and a concrete next action. Do not promise an automatic return, substitute a Routine, or recreate the work with periodic prompts. Scheduled recurring work remains owned by Routines.

## 7. Delivery and Attention

The basic request/response loop works with or without Tasks. A Task adds continuing tracking and, when configured, a review barrier; it uses the existing publication and notification machinery.

Separate three facts: work has met its completion conditions, the result was published to the intended conversation, and the requester was notified. When the underlying deliverable is complete but its completion announcement fails, preserve completion evidence and show **Completed — result delivery needs attention**. When sending a report or message is itself the promised deliverable, successful publication is a completion condition; do not mark that Task Done merely because its draft exists. Retry only the owed publication through its existing idempotent path, never the underlying work.

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

### First-release behavior

External work items are explicit references attached to Tasks. GitHub issues
filed from a shared Space through OpenMeld's GitHub tools create or reuse one
linked Task: the Task stores the repository and issue number, and the issue
body receives an OpenMeld Task reference. If the Space Task list is truncated
and the linked Task is not on the returned page, GitHub tools refuse to treat
that as a miss: they do not create another card and do not skip close-sync.
Closing that issue through
`github_update_issue` closes still-active linked Tasks. Completing or
canceling a Task does not silently write GitHub; clients prompt the Agent or
person to close still-open linked issues. Direct Messages do not create Tasks.
This is not an import of every GitHub issue, not a webhook subscription, and
not a second Task lifecycle owned by GitHub.

The first release still promises no continuous provider-event wakeup, Linear
association, or automatic closure report from GitHub webhooks. On a request to
wait for an unobserved external event, explain the unsupported capability
before accepting an automatic follow-up obligation. Existing unrelated
provider tools retain their own capabilities and rules.

### Follow-up design: GitHub and Linear events

This is a future increment after Slice A, not a first-release acceptance requirement. Implement GitHub first; add Linear through the same Task-facing observation contract after its provider behavior is verified. These are integrations for explicit follow-up obligations, not an import of every issue into Space Tasks.

Use one Task model. The Task records the work its participants owe; the external item retains its provider-owned identity and state. Source metadata is a read projection attached to the Task, not a competing Task lifecycle.

For "follow another team's issue and tell me when it closes," create a Task such as **Report the outcome of issue #123**. Its assignee owns observation and reporting, not the other team's implementation. Merely posting or bookmarking the issue without a follow-up request does not create a Task.

For "fix issue #123 and verify the released behavior," the Task records that distinct delivery obligation. One Task can reference several issues or PRs. One issue can support distinct Tasks when their requested results genuinely differ; do not create duplicate Tasks just to mirror the provider.

If observation is unsupported, disclose the specific capability gap before promising automatic follow-up. Links alone do not provide monitoring. Accepted work that encounters such a gap remains visibly blocked rather than silently acquiring a timer or a new execution permission.

An accepted follow-up records the exact provider connection and source object, the condition being awaited, the responsible participant, and the Task revision that authorized it. The default is a one-time condition and report; recurring monitoring needs a separate explicit request and supported capability. The destination remains subject to the existing delivery contract.

The event path is: provider event -> validated integration observation -> relevant Task condition assessment -> existing authorized continuation or result delivery. The integration owns event verification, source refresh, and provider diagnostics. The Task owner owns the obligation and whether it is still active. Existing execution owners continue to admit and run Agents. Simple metadata refreshes require no model turn.

| Provider increment | Candidate observations | Required interpretation |
| --- | --- | --- |
| GitHub | Issue closure/reopening and reasons; verified issue/PR relationships; PR draft, review, check, merge, and unmerged-close changes | A mention is not automatically a closing relationship, and a merge is not proof of deployment or every issue's closure. Read actual current source state. |
| Linear | Issue workflow-state changes, cancellation/reopening, and supported attachment/relationship changes | Resolve team-specific workflow states through verified provider semantics, not display names. A linked GitHub PR does not establish its checks or merge state without the corresponding authorized source observation. |

| Confirmed source event | External reference | Task with linked evidence |
| --- | --- | --- |
| PR associated | Show relationship, author, and PR state | Add evidence; preserve current assignee |
| Review changes requested or checks fail | Show actual source outcome | Hand off when a declared rule applies; otherwise flag attention |
| PR merged | Show merged fact; refresh actual issue state | Reassess applicable completion/review conditions |
| Issue closed as completed | Show provider completion | Satisfy only the applicable condition; a follow-up Task still owes its report |
| Issue canceled or closed as not planned | Preserve exact reason | Reporting this closure can fulfill a follow-up Task; it does not prove a repair Task succeeded |
| Issue reopened | Show source reopened | Reassess still-active obligations; a completed one-time closure report stays Done unless further follow-up was requested |
| PR closed unmerged or unlinked | Update the evidence relationship and retain history | Do not finish the Task merely because that PR ended |

Provider identity includes the connection/workspace or repository scope and stable object identifier. Ordinary mentions, closing relationships, and resolved issues are different facts. A stale event cannot replace a newer source snapshot. Webhook handling validates provenance, deduplicates deliveries, refreshes relevant current state, and uses bounded reconciliation for missed events.

Subscription creation includes a current-state read and reconciliation so a transition during setup is not lost. When the condition is already satisfied, assess the current evidence once instead of waiting for an event that will not recur. Bound reconciliation to active tracked objects and recover from provider delivery gaps without repeatedly prompting Agents. Store one durable pending assessment or delivery for the relevant condition occurrence; notification suppression must not suppress the authoritative Task update.

Before starting follow-up work or publishing a report, recheck the Task's current revision, cancellation, assignee, current connection access, and destination access. Repeated events cannot create duplicate executions or reports. A late event for a canceled or superseded obligation is retained only as permitted evidence. If a source later reopens after a completed one-time report, refresh its visible source state without reopening the completed Task or creating a new commitment.

Connection loss shows the last confirmed observation and an unavailable/stale indicator. Reconnection refreshes facts; it is not permission to replay side effects. External content remains untrusted, and callbacks grant no new execution authority.

The report returns to the established conversation and uses existing Inbox attention when needed. It states the verified source outcome, such as "closed as not planned," rather than claiming the underlying problem was fixed. If the requested deliverable is that report, publication success is part of Task completion. A failed report retries only its existing publication intent, not the source mutation or repair work.

Before enabling each provider, verify its real permission model, event coverage, relationship semantics, missed-event recovery, and current-state reads. Final webhook schemas, binding configuration, reconciliation budgets, and storage migrations belong to that future implementation. Until then, links are explicitly links, not monitored dependencies.

## 10. Delivery Slices and Acceptance

### Slice A: Shared work with one complete handoff

Deliver capture from Messages, stable Task identity, roles, board/detail, result submission, optional review and rework, existing execution references, Inbox attention, and accurate original-conversation delivery. Include one real authorized Agent handoff; a static board alone does not satisfy this slice.

| Acceptance scenario | Required observation |
| --- | --- |
| An explanatory question, a fix-and-submit-PR request, and an explicit request to track later work | The question stays in Messages; the other two each create one Task without a special creation phrase |
| Exact create retry and a follow-up to the same work | No duplicate Task or restarted execution |
| Assignment without start, and assignment with explicit start | Responsibility and actual execution are shown accurately |
| A request to arrange work for next week | Task stays planned; no hidden timer or unsupported automatic-start promise is created |
| Human requester, Agent assignee, human or Agent reviewer | Each eligible role can perform its intended operation; ineligible actors are rejected |
| Direct assignment to a coding Agent with a QA Agent as Reviewer | Submission and feedback are handed off without an unnecessary Center Agent execution or ownership transfer |
| An unrelated participant comments, cancels, or replaces the Reviewer | Permitted discussion succeeds; unauthorized task mutations reject without changing state |
| Changes requested and a new submission | Feedback reaches the assignee; old approval cannot complete the new result |
| Two automatic corrections both fail review | No third correction is admitted; the unfinished Task requests a human decision with results and findings |
| Duplicate correction events, reassignment, or restart during rework | The same admitted round is reconciled; the automatic-round limit is neither double-counted nor reset |
| An early blocker or an already running healthy review | A blocker escalates without unnecessary rounds; the round limit never acts as a total execution timeout |
| Two Tasks share a Thread and receive a plain ambiguous instruction | Context remains shared; no Task mutates until the target is clear |
| Explicit reviewer acceptance in Messages versus casual praise, a stale result, or an unauthorized author | The same review command handles valid acceptance; ambiguous, stale, and unauthorized inputs cannot complete the Task |
| Agent callback delivered twice, late, or after reassignment | No duplicate handoff, stale acceptance, or revived task |
| Task cancellation while an execution is active | Further task work is fenced; actual Stop authority and pending stop outcome remain honest |
| Stop only the active execution | Task remains available for follow-up; no implicit cancellation, completion, rollback, or restart |
| Original-result defect, distinct new request, and ordinary comment after Done | Authorized rework reopens the original Task, a new deliverable becomes a linked Task, and commentary changes no lifecycle |
| Execution failure, no-review completion, and reviewed completion | Phase and result reflect the actual completion contract |
| Submit-a-PR request versus deploy-and-verify request | Only the former can finish from PR submission evidence; neither adds an unrequested human acceptance gate |
| Completed work with failed publication | Work is not rerun; delivery failure and exact retry are visible |
| Refresh, leave/re-enter, and current access revocation | State remains recoverable; inaccessible data and mutation controls are not exposed |
| DM and specialized Space entry points | Tasks is absent and unsupported server operations reject; ordinary messaging still works |
| A first-release request for automatic GitHub or Linear event follow-up | Unsupported monitoring is explained; no event subscription or automatic-report promise is fabricated |

Use focused behavior tests at the owner seam, then supported real-user entry points for the shared handoff. Follow repository test guidance; do not build broad test suites that only mirror schema or UI implementation.

### Follow-up B: GitHub event-driven follow-up

After Slice A, implement the GitHub portion of section 9 for explicitly accepted obligations. Verify another person's linked PR, close with different reasons, reopen, already-satisfied conditions at subscription time, missed/duplicate/reordered delivery, and revoked connection. Include a follow-up Task that completes by reporting an external cancellation while a linked repair Task remains unresolved, and a failed publication that retries without repeating work. No event should silently start unapproved work or broaden source visibility.

### Follow-up C: Linear event-driven follow-up

Extend the proven observation-to-Task contract with Linear-specific identity, permissions, workflow-state mapping, and delivery recovery. Reuse task assessment and publication semantics rather than introducing another Task lifecycle. Validate custom team states, cancellation versus completion, source changes after a one-time report, connection revocation, and linked-PR facts that require a separate GitHub connection.

### Later decisions

Consider cross-Space personal aggregation when users repeatedly miss work across rooms. Consider Intake/Triage when substantial unaccepted work must be reviewed before admission. Consider independent Goals when an outcome needs a lifecycle beyond changing delivery plans. Consider workflow customization only after repeated workflows cannot be expressed clearly with the initial handoffs.

Measure requester follow-up effort, repeated context, unhandled handoffs, unnecessary cards/notifications, incorrect completion claims, rework, and execution cost. Compare the same kinds of work with the existing conversation-only experience; do not publish efficiency claims from feature presence or card throughput.

## 11. Current Baseline and Implementation Decisions

This proposal was checked against local source at `5501efa1d` on 2026-09-15. It does not certify deployment or runtime behavior.

- [Space collaboration](space-collaboration.md) defines the current Board as a read-only summary and Threads as conversation placement. Tasks adds a separate work capability rather than redefining those existing objects implicitly.
- [Organizations and Center Agent](organizations-and-center-agent.md) retires the old private Center Agent Task product and rejects a heavyweight workflow system. An older Task-retirement sentence remains in the Space session section; reconcile that conflict during approved owner-document updates. Historical Task storage is not an implementation shortcut.
- [Task coordination prompt](../../services/remote-agent/agent-core/prompt/task-coordination.ts) and [execution schemas](../../packages/schemas/src/schemas/runtime/agent-task-coordination.ts) supply existing delegation/watch/continuation contracts. They are execution references, not a user task registry.
- [Space tabs](../../clients/web/src/components/spaces/space-view-tabs.tsx)
  exposes Messages, Tasks, and Files in eligible Spaces. Center Agent Direct
  Messages preserve their separate Graph navigation and omit Space Tasks.

The product discussion is complete. The WIP implementation specifies these
engineering details in the owning contracts:

1. Eligibility is ordinary shared Spaces; Direct Messages reject. Active member
   identity and action-specific role checks are server-owned.
2. Space Durable Object SQLite owns Task documents, append-only events, exact
   operation replay, and revision-bound writes at schema version 41.
3. Web and Agent clients use one shared mutation schema for assignment, brief,
   start, result, review, cancellation, reopening, and human continuation.
4. Reviewer and rework handoffs publish deterministic Space messages. Human
   targets use normal mentions and Inbox projection; Agent targets use normal
   Wake admission. The Task never becomes execution truth.
5. GitHub webhook and Linear event observation remain deferred in that order.
   Authorized GitHub tool-path association and close sync are first-release
   behavior; links still do not claim webhook monitoring.

The implementation must update [Space collaboration](space-collaboration.md), [Organizations and Center Agent](organizations-and-center-agent.md), [data ownership](../architecture/data-and-observability.md), [shared contracts](../architecture/shared-contracts.md), [Web](../clients/web.md), [CLI](../clients/cli.md), and [Inbox](inbox.md) for the behavior each owns. Update [Remote Agent](remote-agent-runtime.md) and execution owner documents only for actual touched contracts.

Shared cross-client/service payloads live in `packages/schemas`, using existing
validation and error conventions. UI invalidations remain refresh signals. The
WIP change requires the Contract Impact Audit and local-component release check
before delivery. Its Changelog entry remains a draft until delivery is proven.

Architecture acceptance: the proposal adds a canonical owner for native work and review, while preserving current owners of identity, admission, runtime execution, readiness, publication, external state, and notifications. It authorizes no duplicate execution truth, implicit destination changes, or permission expansion. Approval of an implementation must include the corresponding explicit owner-document changes.
