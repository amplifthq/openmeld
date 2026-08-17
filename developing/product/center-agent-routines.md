# Center Agent Routines

## Agent Context

- Owner: Center Agent Routine and Run product semantics and cross-owner
  invariants.
- Purpose: Define the Center Agent Routine and Run product contract, including
  organization ownership, authority, scheduling, native delivery, result
  surfaces, client surfaces, and operational boundaries.
- Read this when: You are changing a Routine definition, Run lifecycle,
  scheduler behavior, Center Agent Routine tool, Routine destination, Routine
  Web or CLI surface, or Routine-related Remote Agent delivery.
- Update this when: Routine vocabulary, permissions, limits, schedule semantics,
  Run state, target/result behavior, tool policy, or mixed-version rollout
  requirements change.
- Read with: `developing/product/organizations-and-center-agent.md` for Center
  Agent identity and represented-member authority,
  `developing/product/remote-agent-runtime.md` for native delivery,
  `developing/architecture/data-and-observability.md` for durable ownership and
  diagnostics, `developing/architecture/shared-contracts.md` for schemas, and
  `developing/clients/web.md` or `developing/clients/cli.md` for presentation.
- Do not use this for: Workstation Wake execution, general Space collaboration,
  Remote Agent provider configuration, production tenant setup, or evidence
  that an official-organization Routine has been configured or run.
- Source of truth: This file owns the durable product and cross-owner contract
  for Center Agent Routines. Source code, shared schemas, and migrations remain
  the implementation truth and must be reconciled with this file in the same
  change when behavior moves.

## Current Implementation Status

As of 2026-07-23, the repository implements the Center Agent Routines MVP
product contract end to end:

- shared strict Routine, Run, target-space, turn-envelope, private-tool, and
  CLI JSON contracts;
- D1 Routine and Run ownership through migrations `0025`, `0026`, `0028`,
  `0036`, the Routine native-delivery chain migration `0063`, and the
  unattended-action/continuation fence migration `0064`;
- the Core minute Cron scheduler, atomic occurrence claim, catch-up and
  quarantine behavior, and Remote Agent native delivery;
- Workflow-first Run execution with an explicit Legacy rollback engine;
- the Web Routine management and Run-history client, the eight CLI commands,
  and the six verified member-attributed Center Agent management tools; and
- one-time and recurring schedules;
- an OpenMeld Space or the durable originating Slack thread as the explicit
  success and failure destination; and
- one executable capability catalog and one exact enabled Organization Skill
  release snapshot inherited by interactive Center Agent and unattended
  Routine turns by default, with only the explicit capability-owned exceptions
  below and the same delegated-member authorization, attribution, audit, and
  fail-closed contracts.

The approved Web navigation places **Routines** under the Center Agent product's
stable secondary navigation. It is a daily use-and-creation surface, not global
configuration and not a root product peer. Current navigation placement is
owned by `developing/clients/web.md`.

Implemented repository capability is not evidence that a particular deployed
environment has the required migrations, bindings, or release, that an
official Organization has a configured Routine, or that a real production Run
has completed. Production configuration and dogfood evidence must be reported
separately from this product contract.

## Product Promise And Vocabulary

A **Routine** is an organization-owned instruction that asks the designated
Center Agent to do work once or on an explicit recurring schedule. A **Run** is one
durable scheduling or execution record. It normally represents one occurrence;
one aggregate `skipped` Run may instead summarize a bounded range of missed
occurrences after an overdue gap.

The user-facing promise is:

```text
An organization member defines a Routine
-> Core claims one eligible occurrence or records one aggregate skipped Run
-> the designated Center Agent executes the unattended instruction
-> the explicit OpenMeld Space or Slack thread receives one result or one explicit failure
-> skipped Runs remain visible in Routine history without adding destination noise
```

Use these terms consistently:

- **Routine** is the only product, UI, CLI, API, schema, and code noun for the
  organization-managed scheduled instruction.
- **Run** is one durable scheduling or execution record. It normally represents
  one occurrence and may summarize a bounded overdue range when `skipped`.
- **scheduled tasks pathway** is an internal architecture term for the lower
  trigger pathway. It is not product copy and does not name the user object.
- Do not introduce another product noun for a Routine or a Run.

The first intended dogfood example is a daily Routine that asks the official
OpenMeld organization's Center Agent to triage its Feedback Inbox and publish a
summary to a selected triage Space. That is an example, not evidence of current
configuration or production execution. The Feedback tool slice is independently
owned by `developing/product/feedback-loop.md`; this feature does not implement
or provision it.

A daily team-learning journal is another valid dogfood use of the same generic
Routine and Organization Documents infrastructure. It is not a special Routine
kind: the definition supplies the source, writing instructions, document
placement, and destination policy needed by that Organization.

That definition may express editorial and action principles instead of a fixed
article template. A team-learning Routine can require the Center Agent to read
recent entries, identify what actually changed, save the complete
evidence-based entry to Documents, and publish only the new and useful part to
Slack. It may also stay quiet when there is no material update. Section names,
section count, ordering, and length remain an editorial decision for the
current evidence; the product must not special-case a diary, local date,
repository, or channel. Humility comes from distinguishing facts,
interpretations, and unknowns, while usefulness comes from naming a concrete
action already completed or a well-supported next contribution.

### Center Agent Self-Evolution

**Center Agent Self-Evolution** is the built-in onboarding Routine for
continuous Organization learning. It is a product template over the existing
Routine, App, Message Channel, Project, Organization Documents, and Space
contracts. It is not a new scheduler, runtime, memory system, Agent framework,
or special Routine kind.

Web recommends the template only when the current Organization has at least one
active App connection or one connected Slack Message Channel. Local Service
presence and Organization member count do not qualify the recommendation.
Owners and admins may enable it because the Routine receives the existing
`organization_documents.save_approved_knowledge` grant. Other members may see
the recommendation but cannot grant unattended approved-knowledge writes.

Setup lets the approver choose:

- one or more currently connected App or Slack sources as the instruction's
  learning scope;
- all active Projects or one target Project;
- a daily, weekly, or custom recurring schedule and timezone; and
- one eligible OpenMeld Space as the complete learning archive; and
- optionally, one Slack channel for a concise team report.

The source selection is durable instruction scope, not a new security boundary.
The existing App, Channel, represented-member, provider-scope, and tool
contracts remain the only access authority. App connections expose only their
implemented model-visible actions. A Slack Message Channel exposes only the
authorized channel, member, and history reads already owned by the Channel
contract. The Routine must treat the data returned by those tools as its access
boundary and must not imply broader Slack access.

The built-in Routine stores `externalActionPolicy = read_only`; this is an
execution boundary, not only prompt wording. Remote Agent permits declared
read actions and blocks external App, GitHub, and Slack writes before an
operation claim, connection resolution where applicable, or provider call.
Generic App actions whose current catalog metadata does not explicitly declare
`effect = read` fail closed. The policy does not block the Routine's approved
Organization Document grant, its one final result in the frozen OpenMeld
Space, or an optional Slack team report when the same Routine definition also
contains the bounded `slack.publish_channel_report` grant. Core rechecks that
stored grant from the canonical Routine and Run before any Slack call; the
instruction text alone never authorizes publication. It may maintain approved
knowledge only in a dedicated **Center Agent Self-Evolution** folder:

- **Organization Understanding** keeps the current durable picture;
- **Opportunity Ledger** tracks evidence-backed opportunities, confidence,
  expected value, audience or owner, next step, status, and review time; and
- **Learning Log — YYYY-MM** records material observations and changed beliefs
  in time order.

The Space report is the complete user-facing learning result. When the optional
Slack report is enabled, Slack receives only a concise summary of what changed,
the strongest opportunities, useful missing capabilities, the Documents
updated, and an invitation to continue in the thread. It never receives the
full Organization Documents. The report follows the current intended audience
and selected Slack evidence when they clearly establish a language, then uses
the optional Organization working-language hint, with English as the final
fallback. The Agent makes this semantic decision during the Run; a Routine does
not add its own detector, model call, or stored language state.

The Routine may recommend connecting another App, Slack, or Local Service only
when current evidence supports a concrete benefit. It does not create another
Routine in this slice. Routine generation, evaluation, and a Routine-building
Skill remain separate future work.

The **Opportunity Ledger** is approved Organization Document content, not the
typed member-private Opportunity product defined in
`developing/product/opportunities.md`. Phase 1 performs no import, export, or
automatic synchronization between them. A Self-Evolution Run cannot call the
Opportunity recommend, list, or decision tools and cannot turn a document row
into an Inbox item or member decision.

The Web recognizes the built-in template through a stable instruction marker
plus its stable product name. A user-created Routine that only reuses the
display name is not treated as the built-in template. This avoids a new
database discriminator while preserving honest presentation.

Recognition does not prove that the template can perform its visible promise.
The Core-owned management projection reports whether the stored definition has
approved-knowledge access, the bounded Slack report grant, and read-only
external actions, plus whether the represented member can repair that
combination. Web calls the Routine configured only when those facts match the
marker-bound instructions. A mismatch remains the same generic Routine but is
shown as **Needs repair**. Ordinary edits, including a Slack channel-name
change, omit capability fields and preserve the stored definition; Web writes
them only after the user explicitly changes whether Slack reporting is enabled
or confirms an authorized permission repair.

## Organization Scope And Definition

Every Routine belongs to exactly one organization. Its creator is attribution
and member-management scope, not the owner of the product object. A creator
leaving the organization does not move or automatically stop the Routine.

The stored definition includes:

- a stable Routine id, name, and unattended instructions
- the owning `organizationId`
- `scheduleKind = once | cron`; a one-time Routine stores `runAtMs`, while a
  recurring Routine stores one five-field schedule expression and one explicit
  IANA `timezone`
- `destinationKind = space | slack_thread`; a Space destination stores
  `targetSpaceId`, while a Slack destination stores the durable team, channel,
  thread, and OpenMeld conversation locators
- a bounded structured `authorizedActions` grant for unattended capabilities
  that require more than free-text instructions; the default is no grants
- `enabled`, `paused`, or terminal `completed` status
- the derived `nextDueAt` UTC timestamp
- creator, last updater, and creation/update timestamps

For a recurring Routine, the timezone is captured as an explicit IANA value at creation. It does not
silently follow a member's device timezone afterward. A later explicit update
may replace it, and Core then recomputes the schedule projection.

A one-time Routine stores one absolute future timestamp. Atomic claim changes
its definition to `completed` and clears `nextDueAt` before delivery, so a later
scheduler tick cannot claim a second Run. `completed` describes schedule
exhaustion, not successful execution; the claimed Run still independently ends
as `completed`, `failed`, or `skipped`.

The destination is required and never server-selected. A Web or CLI caller must
explicitly select a same-organization eligible Space. In an interactive Center
Agent conversation, `current_conversation` explicitly selects the current
OpenMeld Space or current Slack thread; Core never derives this from a later
message or a mutable channel name. A Slack destination freezes its team id,
channel id, root thread timestamp, canonical conversation id, and a
presentation-only label. A Center Agent DM may appear in the Core-owned
eligible-target projection, but it is still selected explicitly.

One claimed Run must use its frozen destination snapshot for worker
submission, successful result publication, failure publication, and recovery.
Updating the Routine's destination affects later claims, while an already claimed
Run keeps its recorded routing destination. This routing invariant applies
across claim, admission revalidation, native delivery, and failure redrive.
This contract does not define claim-time snapshot semantics for the Routine's
name, instructions, schedule, or timezone.

## Authority And Member Attribution

All active organization members may list Routines, read Run history, and create
a Routine.

Mutation authority is:

| Operation                     | `member`                           | `owner` / `admin`               |
| ----------------------------- | ---------------------------------- | ------------------------------- |
| List Routines and Runs        | All organization Routines          | All organization Routines       |
| Create                        | Allowed                            | Allowed                         |
| Update, pause, resume, delete | Only Routines created by that user | Any Routine in the organization |

Core owns this authorization and fails closed. Client controls and model
instructions are not authority.

The Center Agent exposes six management tools in an ordinary
interactive turn:

```text
openmeld_create_routine
openmeld_list_routines
openmeld_update_routine
openmeld_delete_routine
openmeld_pause_routine
openmeld_resume_routine
```

These tools are member-attributed delegation, not autonomous Center Agent
privilege. The Remote Agent derives a verified human speaker from the durable
interactive turn. Core then verifies the current designated Center Agent, the
speaker's current active organization membership, and the represented member's
role and creator scope before calling the same Routine service used by human
clients. A missing, unverified, stale, non-member, or mismatched speaker fails
closed.

An explicit verified-member request authorizes create, update, pause, or resume
without a second confirmation when the required fields are clear. Interactive
delete remains the destructive exception: the Center Agent restates the Routine
name and exact delete action and obtains one separate confirmation. A clear
affirmative reply to that exact proposal completes the safeguard; the Center
Agent must then execute without asking again. Remote Agent issues a one-time
token bound to the represented user, Organization, exact Routine, and exact
delete input; the first call ends the turn and the token cannot be consumed by
the same submission. The private Routine RPC still carries no confirmation
token. Core's separate hard layer remains current identity, represented-member
authorization, quota, schedule, and target validation.

An unattended action grant is part of Routine create or update authority. The
Center Agent may add one only when the verified requester is a current
Organization owner or admin and explicitly grants that action. A Routine's
creator may retain or remove an existing grant but cannot add one without that
role. Current Core recognizes
`organization_documents.save_approved_knowledge`, which lets a Run finalize an
ordinary knowledge document without per-Run approval. Instructions cannot
invent this grant, and the public Routine read projection intentionally omits
it so older strict clients keep their existing response contract.

A current verified member instruction such as "start the loop you proposed" or
"use the plan we agreed" authorizes creation only when the
provided Memory, channel context, or Space context already contains the exact
Routine name, schedule, destination, and unattended instructions. That prior
context supplies details; the current verified request supplies authorization.
A proposal alone must not create a Routine. If one required create field is
missing, the Center Agent asks only for that field and states the default
assumption it would otherwise use.

The organization red line against autonomous destructive Center Agent power
still applies to Spaces, members, Agent Profiles, connections, and other
organization resources. It does not prohibit a verified current member from
using the Center Agent as an attributed interface to the same Routine mutation
that member could make through Web or CLI.

## Durable Ownership And Scheduling

D1 is the only product truth for Routine definitions and Run history:

- `routines` stores definitions and the `nextDueAt` read projection.
- `routine_runs` stores durable records for individually claimed occurrences
  and aggregate `skipped` records for bounded overdue ranges.
- Core is the only runtime writer for both tables.
- Remote Agent Durable Object state, Flue private tables, client caches, and
  eligible-target projections must not become a second Routine registry or Run
  ledger.

The Routine definition also owns one immutable `creationAttribution` snapshot.
It freezes the verified represented human's display name at creation and, only
when an exact Local Agent native delivery carried that authorized create,
optionally freezes its bounded `{ kind: "local_agent", client }` carrier. Core
resolves and writes the snapshot in the same insert as the Routine. A later
profile rename, membership removal, or audit-retention change does not rewrite
it. The snapshot contains no session or conversation locator and is descriptive
only; it never grants authority or replaces current membership checks. Legacy
rows without the snapshot project an explicit unknown display name instead of
guessing from current profile state.

Creation attribution answers only who caused the definition to exist and which
Local Agent client carried that request. Later definition changes remain
separate attributed audit events, Run history remains execution evidence, and
future instruction-source or definition-revision evidence must use their own
explicit contracts rather than widening this snapshot.

`nextDueAt` is a rebuildable projection from the stored schedule and reference
time. Core writes it on create, schedule update, resume, and atomic
claim/advance. For a recurring Routine, pausing sets it to `null` and resuming
calculates the first future occurrence without catching up the paused interval.
For a one-time Routine, resume is valid only while its `runAtMs` remains in the
future. Claim moves it to `completed` instead of calculating another due time.

Published clients that predate practical Routines use a frozen legacy read
projection. It shows only recurring Space Routines and refuses to mutate a
one-time or Slack-thread Routine. Current Web, CLI, and API-client consumers
explicitly opt into a versioned contract. CLI uses `practical-v2`; Web Routine
management uses the list-only `management-v2` projection so it can present
stored capability state and immutable creation attribution without reading Core
storage or reconstructing facts from audit history. The capability-only
`management-v1` projection remains frozen for mixed-version compatibility.
These projections are wire contracts only; they are not a second Routine
registry or alternate Core state.

Core receives one Workers Cron Trigger each minute. On a Routine tick it:

1. recovers eligible ambiguous Routine submissions;
2. retries due visible failure publications;
3. fails stale Runs that never advanced beyond `claimed`;
4. scans a bounded global batch of enabled definitions whose `nextDueAt` is due;
5. creates one Run and advances `nextDueAt` in one D1 atomic batch; and
6. admits the claimed Run to Remote Agent native delivery.

Routine execution is Workflow-first without changing that scheduling
authority. Core freezes `executionEngine = legacy | workflow` on each claimed
Run. The global default is `workflow`. Operators may select `legacy` globally
as an emergency rollback or for explicit Organization ids through
`OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS`. Changing either configuration
affects only later claims. An existing Run never changes engine or falls back
from Workflow to Legacy.

Both engines keep D1 as Routine and Run product truth and use the same Remote
Agent admission, Run idempotency key, callback validation, target snapshot, and
Space publication code. The `legacy` engine uses Core's bounded pre-ACK
recovery scans and the compatibility Queue for admission and publication
recovery; an accepted execution is never failed by that Queue. The `workflow`
engine creates one Cloudflare Workflow instance whose id is the Run id, retries
the idempotent worker submission step, and waits durably for the validated
callback event without a fixed total callback deadline. When the initial Center
Agent registers an all-terminal delegated continuation, Core records that
initial callback without publishing or terminalizing the Run, waits for one
resumed Center Agent callback, and lets only that callback own the final
destination result. If the resumed turn is deterministically rejected before
execution, Core must deliver the exact `terminal_failure` continuation event
before projecting the Run terminal. The Workflow owns a retryable continuation
failure finalization step that validates the failed native delivery and
idempotently projects the D1 Run and downstream terminal effects. Caller-side
projection is only a latency optimization; an accepted event remains sufficient
for the Workflow to finish after that caller write fails. A failed event send
leaves the Run submitted; replay resends that event from the frozen terminal
native-delivery record without admitting another worker turn. Once the Workflow
has finalized the matching Run, replay returns the terminal delivery without
sending another event to the completed instance. A
minute Cron retry creates an instance when `get(runId)` reports it missing. For
an errored instance, Core restarts only a recognized failed phase: callback
finalization, continuation callback finalization, or continuation failure
finalization restarts from its exact finalization step so the received event
remains cached; an idempotent submission failure may restart from the beginning.
An
unknown error phase or explicitly terminated instance fails closed for operator
inspection rather than erasing durable progress. This recovery must not execute
or terminalize the Run through the legacy path. Workflow state is an execution
mechanism and operational diagnostic, not a second Routine registry or Run
ledger.

New Workflow instances retain successful terminal state for one day and
errored or terminated state for 30 days. The short success window bounds
routine storage after D1 and the destination hold the durable outcome. The
full paid-plan error window preserves operator inspection for failures that
must remain fail closed. Terminal-state retention does not limit an active
callback wait or shorten D1 Run history.

`UNIQUE(routineId, scheduledFor)` is the idempotency fence for a recorded
occurrence or aggregate overdue range. The claim/advance update also compares
the stored due timestamp, so concurrent scanners cannot both advance the same
schedule position. The Run id is reused as native delivery `routineRunId`,
worker `idempotencyKey`, and Space publication `clientMessageId`; the Routine
turn envelope also carries it as `runId`.

The scheduler's global scan batch is an operational safety bound and must remain
independent from the per-Organization Routine product limit. The current batch
admits up to 250 due definitions per minute; reaching that bound is observable
through the tick summary and defers remaining due work to a later tick without
creating a second scheduler authority.

MVP scheduling guardrails are:

- no schedule may produce occurrences less than five minutes apart;
- an organization may have at most 50 Routines;
- all 50 Routines may be enabled at the same time;
- a paused Routine still occupies one of the 50 definition slots;
- the catch-up window is the smaller of one hour and the distance to the next
  occurrence;
- recovery after multiple missed occurrences creates one aggregate `skipped`
  Run and may execute at most the newest occurrence still inside the catch-up
  window; and
- stored schedule recovery supports timestamps from 1970-01-01 through the end
  of 2998. Values outside that horizon must quarantine the definition instead
  of executing it.

Quarantine pauses the Routine and preserves a diagnosable `skipped` Run. It is
a scheduler containment transition, not a human or Center Agent `pause`
mutation, so it does not fabricate a `pause_routine` actor audit. The skipped
Run and structured scheduler evidence carry the Routine id, organization id,
Run id, and stable failure code for diagnosis.
Ordinary timestamps remain nonnegative. Run and `lastRun` `scheduledFor`, plus
the Runs `beforeScheduledFor` cursor, are signed safe integers so pre-1970
quarantine evidence remains readable. A negative `scheduledFor` is public only
when `status = skipped` and `failureCode = routine.schedule_invalid`; every
other negative Run combination fails closed. Writers and readers must not
clamp, hide, or migrate a valid quarantine value into a false ordinary
occurrence.

Pause and delete stop future scheduling; they are not cancellation controls for
an already submitted Run. A claimed Run that has not reached native delivery is
rechecked and becomes `skipped` when the Routine was paused or deleted. Once a
Run and native delivery atomically reach `submitted`, native delivery owns its
completion or explicit failure.

This Routine-level rule is distinct from the Organization creator's
**Pause Center Agent** emergency control. Pausing the Center Agent requests
cancellation of already submitted Center Agent native deliveries, including
Routine deliveries, and prevents later claims, recovery, or replay from
starting new Center Agent work. A Routine affected before admission or during
recovery fails explicitly with `remote_agent.center_agent_paused`; the Routine
definition remains unchanged and may run again after the Center Agent resumes.

## Run Lifecycle And Result Surface

The shared Run states are:

```text
eligible occurrence -> claimed
claimed -> submitted | failed | skipped
submitted -> completed | failed
overdue range or quarantine -> skipped
```

- `claimed` means Core won the occurrence and is preparing admission.
- `submitted` means the Run and native delivery were atomically linked and the
  durable worker request exists.
- `completed` means one final result was published to the frozen destination.
- `failed` means execution or delivery reached an explicit terminal failure;
  the frozen destination must receive the failure unless publication remains visibly
  pending or outcome-unknown under its fence.
- `skipped` means no model turn was started. It may record one claimed
  occurrence or summarize a bounded overdue range. It stays visible in
  management history and does not publish a destination message.

The Routine read projection includes a required `lastRun` field whose value is
either a strict summary or `null`. The Runs surface reads paginated strict Run
records. `lastRun` and Runs are read models over `routine_runs`; clients must not
infer a terminal state from native-delivery internals or cached timestamps.

Deleting a Routine removes its definition while retaining its Run history for
audit and diagnosis.

A Routine Run uses the Remote Agent native-delivery exception. It does not
create a user Wake, enter RuntimeCoordinator, or fabricate a source Space
message. The native delivery ledger links the delivery to `routineRunId` and
records the frozen result surface: `conversationKind = "space"` for OpenMeld
Space delivery or `conversationKind = "slack"` with the Slack thread locator.
Exactly one is the user-visible result surface.

Each occurrence causes one initial Center Agent execution. It may also cause
explicit delegated Agent executions and at most one resumed Center Agent
execution when the initial turn registered
`resume_parent_when_all_terminal`. Regardless of that internal work, the Run
has at most one visible destination result. The fences are layered:

- D1 occurrence uniqueness and atomic initial Run/native-delivery linking
  prevent a second logical Run;
- a Routine Run may own an ordered native-delivery chain under one
  `routineRunId`; `routine_runs.native_delivery_id` points to the only delivery
  currently allowed to publish or terminalize the Run;
- `routine_runs.continuation_delegation_id` atomically admits one logical
  all-terminal delegation; retrying that exact delegation is idempotent and a
  different second delegation fails closed;
- the durable worker request and Run id let ambiguous submission recovery replay
  the same identity rather than invent a new turn;
- the Core-owned Organization daily admission counter uses the Run id as its
  idempotency key, so recovery never recounts one Run;
- the Remote Agent admission receipt deduplicates the same request digest and
  idempotency key;
- callbacks must match the Core-originated incomplete delivery identity;
- an initial callback with a registered all-terminal continuation becomes an
  intermediate terminal delivery, keeps the original Routine envelope for the
  resume, and never publishes; stale non-current callbacks are also fenced out
  of publication;
- the admission watchdog may close only a still-unacknowledged submission; a
  compatibility deadline probe for an accepted execution is ignored;
- explicit cancellation targets one durable worker submission and cannot stop
  unrelated work in the same conversation;
- callback and failure branches combine D1 claims or terminal compare-and-swap
  with the destination-specific publication fence; Space deduplicates by Run
  id, while Slack uses its native-delivery publication claim and records
  provider-ambiguous outcomes without automatic reposting; and
- the native delivery terminal outcome projects back into the Run instead of
  creating a second in-flight Run authority.

Ambiguous worker submission is not immediate permission to fail or resubmit a
new model turn. Core persists the worker request before the call, revalidates
the current Routine admission boundary during bounded recovery, and replays the
same Run identity. The private D1 staging value uses a versioned storage
envelope around the shared worker-request schema. Core may read an unversioned
historical value only when it still satisfies the current strict shared schema.
If an older value can no longer be decoded safely, Core must not fabricate
missing identity or routing authority: it terminalizes the Run with
`remote_agent.worker_submit_request_invalid` and publishes the normal visible
failure to the frozen destination. The Organization daily admission limit is
checked before the worker call; quota rejection fails the Run with
`remote_agent.daily_quota_exceeded`, preserves the reason in `failureCode` and
`failureDetail`, and publishes the normal visible Routine failure. A structured
worker admission rejection is deterministic:
Core immediately terminalizes the Run with the worker's bounded reason code and
does not wait for ACK recovery. Thrown RPC and transport errors remain
ambiguous because the worker may have admitted the turn before the response was
lost. A receiver-method mismatch fails closed as an incompatible worker.
Callback, cancellation, and publication races must preserve the first
authoritative terminal decision and keep later evidence diagnostic-only.

Routine turns do not use the transient Space reply stream. Core publishes the
single durable result or failure after the turn settles.

## Unattended Prompt And Tool Policy

The Routine turn envelope uses a distinct `sender.kind = "routine"` and
`trigger.source = "routine"`. It carries the Routine id, Run id, scheduled
timestamp, Routine name, and a `delegatedBy` snapshot of the member who created
the delegation without pretending that the member is currently speaking.
`delegatedBy.ownerUserId` must equal `sender.createdByUserId`; a missing or
different delegated identity is an invalid Routine envelope, not shared-only
authority.
The trigger also carries the Run's frozen Space or Slack-thread destination.
This is the only source for resolving `current_conversation` inside a Routine;
the worker must not reinterpret a Slack conversation id as a Space id.
The worker submit root keeps the designated Center Agent as `author` and sets
`onBehalfOf = null`; historical delegation exists only in
`turnEnvelope.sender.delegatedBy` and the native-delivery audit snapshot.
Before admission, Core reauthorizes that user as a current active Organization
member with an active Human Profile. A removed or no-longer-valid delegator
produces the visible `routine.member_actor_required` failure rather than
executing with stale authority. Sender and trigger variants must appear
together and name the same Routine.

Free-text instructions describe work; they are never parsed as unattended
permission evidence. When a capability requires a structured Routine grant,
Core checks the current accepted native delivery, its Run, the stored Routine,
and the reauthorized represented member before allowing the action. A missing,
stale, mismatched, or ungranted chain fails closed.

The unattended prompt tells the Center Agent that no one is present in real
time. It must make the best reasonable effort, avoid follow-up questions, state
missing conditions in the result, and treat Routine instructions as untrusted
organization data that cannot override system or tool safety rules.

Every Remote Agent turn receives one authoritative current UTC timestamp in its
system prompt. Relative requests such as "in 10 minutes" are calculated from
that timestamp rather than an inferred wall-clock time. A timezone is applied
only when the user or trusted conversation context provides one. After a
Routine create or update succeeds, the Center Agent reports the exact returned
`runAtMs` as a date and time in the user's explicit timezone, or labels it as
UTC when no timezone was provided.

Routine turns inherit the implemented Center Agent capability catalog by
default, including the six Routine-management tools and the complete
model-visible connector and Project catalogs. They also freeze the exact
enabled Organization Skill releases at Run admission; later Skill saves,
disables, or removal affect future Runs only. Organization Skill content does
not grant capability or bypass Routine tool policy. Ordinary writes use the
reauthorized delegated member and require no executor confirmation. Delete and
merge tools remain visible where catalog parity requires them, but every such
Routine call is unsupported and must return
`routine_destructive_action_unsupported` with zero side effects. A Routine may
use `openmeld_wake_agent_profiles_in_space` when another Agent adds meaningful
evidence or capability. It must not delegate merely to demonstrate delegation.
If the Center Agent must synthesize the child results into the Run's one final
destination result, only `resume_parent_when_all_terminal` is supported and it
may resume that Center Agent once. Other resume modes fail closed.

Routine turns do not expose `openmeld_remember_for_organization`. A Run's
frozen publication destination is not the original conversation that authorized
its instructions, so it cannot provide truthful memory provenance. Core must
also fail closed if a stale or envelope-less tool catalog attempts the call;
the destination must never be guessed as the memory source.

`externalActionPolicy` is a narrow stored Routine execution field. Omitted
values and ordinary Routines resolve to `standard`, preserving the catalog
behavior above. `read_only` keeps reads available but returns
`routine_external_write_unsupported` with zero side effects for external
writes. It is used by Center Agent Self-Evolution; it is not a new general
permissions framework and does not replace each capability's existing
authorization, connection, attribution, audit, or destructive-action contract.

Slack channel list, member, and history reads remain inherited. A Routine uses
its reauthorized delegated member and the same Core authorization, App
membership, audit, pagination, and no-persistence rules as an interactive turn.
Scheduling neither broadens Slack visibility nor joins a channel.

An explicitly authorized top-level Slack publication uses the ordinary
model-visible channel publication tool. For a one-off result, the tool binds
the publication to the current execution; for an approved Organization
document, it accepts the exact document id and Core derives the current
approved revision. During a Routine, Remote Agent binds `current_turn` to the
trusted Run id. A completed exact retry returns the stored publication result
without a second provider call. Reusing one source revision for changed text
or a different represented member fails closed. A provider outcome that may
already have published also fails closed instead of inventing another source
identity to force a post. No behavior is special-cased by diary, date,
repository, or channel name.

Agent Task discovery and watch remain the explicit exception.
`openmeld_watch_agent_task` schedules a future continuation for an independently
existing task, while a Routine supports only the continuation created by its
own explicit Agent Wake. `openmeld_list_agent_tasks` is the companion discovery
surface for that watch contract rather than a general task-history browser, so
the pair remains absent together instead of exposing a dead-end partial
capability. Both names keep negative Routine capability tests.

Opportunity recommendation, history, and decision are a second explicit
interactive-only exception. A Routine has no live member to review a new
Recommendation, must not choose a recipient, and must not resurface deferred or
dismissed work. The three Opportunity tools remain absent together and keep
negative Routine capability tests. A Routine may write evidence to the
Self-Evolution Opportunity Ledger only under its separate approved-document
grant; that document does not mutate typed Opportunity state.

The durable Routine envelope supplies the reauthorized delegated member. Each
exposed capability keeps its existing Core authorization, connector ownership,
attribution, audit, destructive-confirmation, and fail-closed rules; scheduling
does not create a bypass. A tool that cannot satisfy its normal contract fails
visibly rather than disappearing from the Routine catalog unless this owner and
the capability owner explicitly name that catalog exception. Capability
additions therefore flow to interactive and Routine turns together by default.
The shared catalog includes the stateless `codemode` tool, which can compose
only those same active definitions. Code Mode is not an alternate authority,
identity, destructive-confirmation, scheduler, or Routine state owner; every
inner call re-enters the ordinary capability boundary.

This inheritance-with-explicit-exceptions rule is a product invariant, not a
snapshot of the current inventory. Any tool available to the ordinary Center
Agent is available to a Routine by default, with the same inputs,
capability-owned contract, and delegated-member authorization. The ordinary
effect occurs only when that contract can be satisfied without fabricating a
live conversation step.
For ordinary non-GitHub Apps, this includes member-owned connections:
connection selection uses the Routine's reauthorized delegated member exactly
as it uses the verified requesting member during an interactive turn, so that
member's connection wins and Organization access is the fallback. GitHub is the
explicit exception: a Routine must use the Organization's GitHub App
installation and the OpenMeld bot. It cannot request or borrow a member's
GitHub identity.

The only general execution difference is conversation timing. A Routine has no
live requester to answer a follow-up question. Its durable instructions are
standing task direction for ordinary safe actions, not a destructive permission
database. It makes the best reasonable effort from those instructions and
context; when a required input or authority is missing, it returns an explicit
actionable result instead of asking a real-time question. Delete and merge are
the explicit effect exception: they are unsupported during a Routine. This
difference alone does not justify changing connection identity or creating a
Routine-only ordinary-write permission model.
Any exception beyond the Agent Task discovery/watch and Opportunity sets above requires an
explicit product decision in this owner document and the
capability owner plus a negative capability test; absence from the Routine
catalog is never the default.

Future unattended destructive support must not revive free-text parsing. It
requires a Core-owned structured grant confirmed when the Routine is created or
updated, bound to the Routine revision, exact capability, effect, and targets,
then frozen into the Run and validated against the canonical action. That grant
system is not implemented in the current product.

GitHub reads and writes therefore set `githubActor = organization` and use the
Organization's GitHub App installation. A GitHub write explicitly described by
the durable Routine instruction executes as the OpenMeld bot in that Run
without a live confirmation. GitHub file deletion and pull-request merge are
unsupported during a Routine and return
`routine_destructive_action_unsupported` before any provider side effect.
Generic Apps apply the same rule to actions classified as destructive by
first-class `effect` metadata or the legacy effect vocabulary. That
classification describes the action's effect; it never interprets free-text
instructions as permission. Connection attribution, audit, provider policy,
idempotency, and Core authorization remain unchanged for ordinary actions.

Routine deletion is unsupported during a Routine and returns
`routine_destructive_action_unsupported` before reading the Routine directory
or calling Core deletion. Interactive deletion still resolves the requested ID
and name against Core-owned current state and uses its exact later-turn
confirmation bound to that target.

Project create, update, and Default Project selection are inherited as ordinary
represented-member writes with durable operation IDs. They carry no free-text
authorization evidence. Interactive Project removal retains its later-turn
token; Project removal during a Routine is unsupported in both Remote Agent and
Core and returns `routine_destructive_action_unsupported` with zero side
effects.

Ordinary verified interactive turns retain the normal Center Agent tool surface
and the six member-attributed Routine tools.

The Remote Agent's Agents SDK/Flue alarm mechanism remains callback-only. Its
only scheduled callback retries delivery of worker completion callbacks to
Core. It must not store or schedule Routine definitions or create new Routine
turns. Routine scheduling belongs exclusively to D1 plus the Core minute Cron
Trigger.

## Web, CLI, And Conversation Surfaces

Web exposes Routines at `/o/{orgSlug}/center-agent/routines` inside the Center
Agent product's stable secondary navigation. The page reads the current Center
Agent designation before it
requests Routines. When the Organization has no designation, Web shows one
short explanation and links to `/o/{orgSlug}/center-agent/chat`; it does not render
the Routine management surface. Once designated, Web reads the canonical
Routine, Run, permission, and eligible-target projections.
`canManage` controls update, pause, resume, and delete; read-only members still
see Runs. A cached target list is not authority. If the stored target is no
longer eligible, Web shows it as unavailable and requires an explicit eligible
replacement before saving.

Web creates and edits one-time or recurring Space Routines. It displays
Slack-thread Routines and their Runs, but does not offer a destination-losing
edit control until Web has a durable Slack-thread picker.

CLI exposes exactly eight commands:

```text
openmeld routines list
openmeld routines create
openmeld routines show
openmeld routines update
openmeld routines pause
openmeld routines resume
openmeld routines delete
openmeld routines runs
```

Create accepts either `--run-at <ISO-8601>` for one future Run or one raw
five-field schedule expression/the shared daily `HH:MM` helper plus an explicit
timezone. CLI creation and destination changes require an explicit target
Space. Delete prompts
in interactive Human View; Agent View, `--json`, and other non-interactive use
require explicit `--yes` before the request is sent.

Human View, Agent View, and `--json` are separate output contracts. Human View
uses terminal cards. Agent View uses flat presenter frames. Only explicit
`--json` emits the versioned `cliJsonOutputEnvelopeSchema` shape through
`emitCliJsonEnvelope`. Routine success payloads use strict shared HTTP response
schemas; the existing strict v1 error envelope remains unchanged.

The conversation surface uses the six verified member-attributed tools defined
above. From Slack, create and update may explicitly select
`current_conversation`, which persists the current root thread destination. It
must not infer a destination, fabricate confirmation, or promise an action
before Core authorizes it.

## Observability And Audit

Each successful create, update, pause, resume, or delete writes one durable
audit row in the same D1 batch as the mutation. A direct human Web or CLI path
records the current human profile as `actorProfileId` with `onBehalfOf = null`.
A Center Agent tool path records the designated Center Agent profile as
`actorProfileId` and the verified represented human in `onBehalfOf`. When that
tool call belongs to an exact Local Agent delivery, the row also records the
delivery correlation so the Audit Log can show which Local Agent carried the
request. For create only, the Routine definition independently freezes the
bounded creation snapshot described above; the audit row remains the event
evidence for that mutation. A rejected or unapplied mutation writes neither
mutation nor audit.

The Center Agent **Audit Log** under
**Center Agent → Center Agent settings** is readable by every current workspace
member. Audit action set v17 exposes successful Routine create, update, pause,
resume, and delete rows with their requester and Local Agent source when one is
verified. Earlier action sets continue filtering Routine mutations, so an old
client never receives an action outside its frozen enum. Routine Run history is
still the execution record; mutation attribution and Run evidence are not
substitutes for each other.

Run history is operational execution evidence, not a duplicate mutation audit
feed. The Run and native delivery ledger link through `routineRunId`, while the
published Space signal id or Slack message timestamp provides the visible-result pointer. The native
delivery ledger records and coordinates delivery evidence; after `submitted`
it must not become a second in-flight execution authority beside the Remote
Agent durable submission.

Diagnostics must correlate `organizationId`, `routineId`, `runId`, native
delivery id/idempotency key, schedule kind, destination kind, scheduler claim,
worker submission, callback, and publication outcome. Slack-created Routines
also retain the durable conversation locator through the normal
ingress/native-delivery evidence chain. Alerts must distinguish ingress not
accepted, queued but not consumed, Routine rejected, Run not claimed, worker
submission ambiguous, callback missing, publication failed, and publication
outcome unknown. Deterministic worker admission rejection records its stable
reason code and rejection message immediately instead of collapsing into an
ACK recovery timeout. Diagnostics may include identifiers, timestamps, state,
bounded reason codes, publication pointers, and retry evidence. They must not log Routine
instructions, prompt bodies, credentials, or arbitrary worker payloads.

## Mixed-Version Deployment Windows

Routine rollout has three different strict mixed-version windows. Do not collapse
them into one generic Remote Agent deploy order.

1. Apply D1 migration `0025` before `0026`, and apply `0035` before enabling
   queued Slack ingress.
2. Apply additive migration `0028_routine_run_workflow` before selecting the
   Workflow engine. Existing non-skipped Runs are frozen to `legacy`; skipped
   historical evidence has no execution engine.
3. Apply `0036_practical_center_agent_routines` before any producer sends
   one-time or Slack-destination Routine fields.
4. Apply `0063_crazy_nick_fury` before Core can create a Routine continuation
   delivery. It replaces the one-delivery unique index with a non-unique Run
   lookup index; the Run's current `native_delivery_id` remains the final-result
   ownership fence.
5. **W2 turn-envelope window, Core to Remote Agent:** deploy the Remote Agent
   worker that accepts `delegatedBy`, the rollout-optional frozen Routine
   destination, durable Slack locators, the optional Routine continuation
   evidence, and the strict
   Routine sender/trigger variant before Core's
   scheduler can emit Routine turns. Roll back Core's emitter before rolling
   back that worker consumer. Current Core always emits the destination. During
   the short old-Core window, the worker may execute the turn but fails visibly
   instead of guessing if a tool needs the absent `current_conversation`.
6. **W5 private-tool-RPC window, Remote Agent to Core:** deploy the six Core
   receiver methods before the final Remote Agent worker exposes their callers.
   Roll back the Remote Agent callers before removing Core receivers.
7. **W6 admission-response window, Remote Agent to Core:** deploy Core's worker
   response-union reader before Remote Agent can return a structured admission
   rejection. Roll back the Remote Agent rejection producer before rolling back
   the Core reader. An old Remote Agent may still throw and enter bounded ACK
   recovery; a new Remote Agent must never send the rejection variant to an old
   strict ACK-only Core.
8. Deploy the Core Routine HTTP/RPC producer and shared API client before
   Gateway routes, then Web and the published CLI consumers. Keep strict
   response-shape windows short and
   fail closed on missing or unknown fields instead of guessing compatibility.
9. Keep `OPENMELD_ROUTINE_ENGINE_DEFAULT=workflow` as the normal execution
   mode. A scoped rollback adds an Organization to
   `OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS`; a global rollback explicitly
   changes the default to `legacy`. Both choices apply only to new Runs.
   Already claimed Runs finish on their frozen engine, and a Workflow-owned Run
   never starts a second legacy execution.

The signed Run `scheduledFor` and `beforeScheduledFor` contract must be
coordinated across Core, Gateway, the shared API client, Web, the Remote Agent
Center Agent tool consumer, and CLI. Existing nonnegative rows remain
compatible. An older strict parser rejects valid negative quarantine evidence,
so a partial rollout leaves that history unavailable rather than safely
degraded. Ship those readers in one release window without relaxing the W2,
W5, or W6 ordering above.

The W1, W2, W3, W5, and W6 cloud execution boundaries do not change workstation
OpenMeld Service, daemon, or RuntimeCoordinator contracts and do not by
themselves require a workstation hard cut. W4 does change the published
OpenMeld CLI and is therefore local-component release-sensitive. The branch
that actually publishes the integrated feature must complete the CLI package
and any release-tool-required Service bundle version bump, stamp
`release/local-components.json` with an explicit update policy, pass
`pnpm run verify:release-ready`, and use the guarded CLI release from that same
commit. Compatibility review currently supports an `available` policy rather
than a forced hard cut, but the final release card owns that decision.

## MVP Boundaries

MVP does not add:

- a Core-side budget breaker or a per-organization scheduler Durable Object;
- an arbitrary Slack destination picker outside a durable originating
  conversation;
- an implicit destination;
- a second Routine registry in Remote Agent or client state;
- a Routine-owned implementation of the Feedback tool slice;
- a separate user-configurable one-off Run object outside a one-time Routine;
- production tenant configuration, an official organization preset, or
  dogfood proof.

Remote Agent global disablement and the per-organization blocklist remain the
operator containment boundaries. The uniform Organization daily admission limit
is separate from containment and has no official-organization exemption. Usage
diagnostics remain read models, not a budget enforcement engine.

## Owner Boundaries

- `developing/product/organizations-and-center-agent.md` owns Center Agent
  identity, designation, and the distinction between autonomous privilege and
  represented-member delegation.
- `developing/product/space-collaboration.md` owns Space message and visible
  outcome meaning.
- `developing/product/remote-agent-runtime.md` owns native delivery, worker
  callback, and Remote Agent tool-runtime boundaries.
- `developing/architecture/data-and-observability.md` owns D1, ledger,
  projection, audit, and diagnostic boundaries.
- `developing/architecture/shared-contracts.md` owns strict Routine HTTP/RPC,
  turn-envelope, and CLI JSON schemas.
- `developing/clients/web.md` and `developing/clients/cli.md` own client-specific
  presentation and interaction.
- `developing/engineering/development-workflow.md` owns rollout verification
  and mixed-version deployment practice.

## Product Invariants

These are required contract invariants. Implementations and recovery changes
must prove them end to end; the presence of a stored snapshot or projection is
not by itself evidence that every writer and publication branch complies.

- One organization owns each Routine.
- Each individually claimed occurrence has at most one Run; one aggregate
  `skipped` Run may summarize a bounded overdue range.
- D1 is the only Routine definition and Run-history truth.
- `nextDueAt` is a projection, not a second scheduler truth.
- A destination is explicit, organization-scoped, and frozen for one
  claimed Run across execution and every result-publication path.
- A Routine destination update affects later claims; an existing claimed Run
  keeps its recorded destination routing authority.
- Ordinary timestamps are nonnegative. Negative Run `scheduledFor` values are
  reserved for `skipped` plus `routine.schedule_invalid` quarantine evidence.
- Core enforces owner/admin/member creator scope for every mutation path.
- Center Agent Routine tools represent a verified current member; they do not
  create autonomous Center Agent authority.
- One occurrence causes at most one model turn and one visible destination result.
- Failed Runs produce an explicit destination failure; skipped Runs stay
  visible in management history without a destination message.
- Routine native delivery does not enter RuntimeCoordinator or fabricate a
  user Wake.
- Agents SDK/Flue alarms retry callbacks only; Core Cron owns Routine timing.
- New Runs use Workflow by default; Legacy is an explicit future-Run rollback,
  and an already claimed Run never crosses engines.
