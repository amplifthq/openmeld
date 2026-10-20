# Inbox

## Agent Context

- Purpose: Define OpenMeld's workspace Inbox, attention model, item lifecycle,
  delivery channels, first-release source coverage, and product boundaries.
- Read this when: You are changing Inbox items, unread or attention counts,
  Inbox delivery, notification preferences, browser notifications, urgent email,
  or a product source that creates or resolves an Inbox item.
- Update this when: Inbox scope, classification, lifecycle, delivery policy,
  source coverage, navigation, or ownership changes.
- Do not use this for: Source-domain business truth, Agent Task execution,
  Feedback Issue storage, Space message storage, or provider-specific messaging.
- Source of truth: This file owns the Inbox product model. Source owner documents
  remain authoritative for the work or event represented by an Inbox item.

## Agent Direct Message activity

An accepted Human membership generation that someone else added creates one
ordinary `space_joined` update, including empty Spaces and invitations. A
member who added themselves, such as a Space's creator or an owner whose setup
opened a Direct Message with their own Agent, gets no update. It uses the membership's
`addedAt`, not visits, role changes, or index retries. Rejoining creates a new
generation. Historical memberships are established as read during migration
and after historical D1 import. No chat message or urgent email is fabricated.

The Space indicator includes this update; message badges and unread-message
positions count actual messages only. The badge shows `New` until the membership
notice is acknowledged when there are no unread messages. Actual unread messages
take precedence, without a second New badge or a time-based expiry. Opening the main conversation in a
focused window acknowledges its membership notice through the existing exact
Inbox read operation. Unseen main and Thread messages remain unread. Mark all
read also includes membership notices. The current source-access check remains
mandatory for every read and write.

Agent-authored Direct Messages include the receiving Agent's personal owner in
the existing owner-activity projection, including messages without a Wake.
The sender's owner can follow that Agent's activity as before. One owner of
both Agents receives one item. These are Agent-owner updates; only actual Human
participants receive the Human-directed Direct Message reason.

## Conversation names

Web and the Desktop renderer resolve conversation labels from the same authorized
Space/session indexes and account sidebar titles as the conversation sidebar.
Personal chat titles take precedence for Direct Messages; ordinary Spaces use
their current shared names. Inbox list, expanded activities, compact previews,
and message search share this display rule. Stored Inbox copy remains historical;
display resolution does not mutate source targets, read state, or delivery facts.
Browser/native notifications and email still use the stored server copy.

Owners observing a Direct Message between Agents see both current participant
names and avatars through the same presentation used by the conversation list.
Opening that conversation keeps the Human viewer's identity; it does not switch
to an owned Agent or silently grant participation.

## Search

Inbox search covers the current recipient's uncleared message items and other
activities, independent of the currently loaded feed pages. Message matches use
the canonical Space text search; non-message activities search their Inbox title
and preview. Every result rechecks current source access and opens its canonical
item. Search does not mark items read, dismiss them, or resolve their sources.
Removed Inbox items remain excluded even if their original messages are still
searchable from a conversation or workspace search.

Conversation and Inbox dialogs share the command menu's search reader. Searches
run after 300 ms without typing and wait for IME composition to finish. The
command menu displays message results inline rather than opening another dialog.
Changing or clearing the query cancels obsolete requests. Search accepts literal text of 3–200 characters,
including unsegmented Chinese text. Historical indexing and incomplete pages
remain visible; an unfinished or failed search must not claim there are no
matches. Results are transient, not part of persisted browser read caches.

## Attention feed and frozen selections

Permission and plan-review requests are ordinary Needs review items; questions
are ordinary Needs action items. The RuntimeCoordinator source supplies that
classification and does not infer urgency from local execution or request kind.
Recovery remains source-prioritized, with queue approval classified as review.
An exact legacy source replay can enrich missing classification and correct old
forced urgency without reopening, clearing, or re-notifying the item. Generic
Inbox source conflict checks remain strict; real explicit priority from another
source is not globally downgraded.

Version-9 summary receivers get priority, open-action and open-review counts from
the same full authorized dataset as the feed. Ordinary open work remains visible
without a red alarm. First personal-Agent contact participates in yellow priority
presentation without acquiring urgent email eligibility. Owner-only follow-up
chat is ordinary unread history, not repeated notifications; explicit Human
mentions, replies and requester relations survive owner-observer noise controls.
Structured source facts use per-item delivery identities rather than the retired
minute-bucket observer coalescing. Existing browser/native acknowledgement and
visibility boundaries remain separate; no cross-device delivery lock is added.

Typed Computer connection and Desktop update events have account scope in the
same Inbox table (`organization_id IS NULL`), never an arbitrary Organization
or one copy per Organization. Authorized Organization views may include the
current account's items; read and Dismiss target the same canonical id. Other
Organizations' private records never enter that view. Version 9 source-target
receivers opt in; older HTTP and RPC receivers retain their Organization-only
shape and cannot accidentally mutate account records. Computer access also
rechecks current device ownership and forgetting. Device sources do not enqueue
email merely because a connection action has yellow priority.

RuntimeTransportHub owns Computer incident facts beside its existing registration,
heartbeat and alarm owner. A compatible, dispatch-accepting live session first
establishes expected availability. The existing lease TTL is the reconnect grace;
initial registration, explicit unknown state, user stop and controlled update do
not establish a fault. One durable incident and a bounded projection retry slice
survive Hub restart and PostgreSQL failure. Recovery uses the same owner-Service online
evidence as Computer connection status, not socket presence, dispatch admission
or execution compatibility. Confirmed connectivity ends the same incident and
removes its priority and pending-action contribution without a user visit.
Read and Dismiss remain unchanged; an unread ended incident is ordinary history,
not a yellow request. Device re-enrollment is rechecked on registration generation
change. Recovery does not resolve other Computers, lanes, Agent issues or Wake
failures, and the source writes no Wake result or RuntimeCoordinator decision.

Desktop Main observes the existing native updater and reports installed/applicable
release facts through the session-bound account endpoint. It retains one local
installation id and a monotonic source sequence, not a notification lock. Core
atomically advances that sequence and projects one ordinary Inbox item per
account, installation, lane and offered release. Checking, download progress and
Later are not new events. A reported installed app version can mark an offer
installed; opening and Dismiss cannot. A newer verified feed supersedes obsolete
offers without asserting installation. Source retries preserve item identity,
read/Dismiss and occurrence time, and never enqueue email. Only the matching
native installation can open its Updates controls; Web shows device-specific
guidance. Native observation failure never blocks the updater. This is trusted
first-party client observation under the current account, not cryptographic
device attestation or proof that a person saw a notification.

The canonical attention feed is `GET /v1/inbox/feed`. All, Mentions, Needs action
and Needs review combine independently with unread, activity and conversation
filters. The activity menu selects All activity, Agents or People; People means
conversation messages without Agent relevance, not device or system events.
The conversation menu selects all types, Direct messages or Spaces, using the
current Space Index DM classification (converted DMs are Spaces). Both groups
can be combined and persist in the URL; Unread only stays beside the tabs.
The existing `agentsOnly` query remains supported; `peopleOnly` and
`conversationType` are additive. Every filter is applied before grouping,
counts, pagination and frozen bulk operations.
Mentions includes structured Human mentions, current personal-Agent mentions,
and incoming Direct Messages addressed to the Human recipient, including Center
Agent messages. A DM observed only through Agent ownership is not a direct
message to that Human. These messages use the shared Web/native delivery policy
and still honor conversation mute. This does not change the older unread-only
`view=mentions` API. Agents filters actual interaction/author/recipient facts, not
the presence of an Agent somewhere in a Space.

Core applies current membership, personal ownership, conversation visibility,
mute presentation and filters before counts, grouping or pagination. A direct
Human mention survives an Agent transfer; an owner-only relationship does not
survive merely because a different owned Agent remains in that Space. All is
ordered across the accessible dataset: priority attention, then ordinary
activity/history. All open requests stay yellow until resolved, including after
they are read. The same open-request rule drives Inbox, Space lists and the
sidebar; urgency still controls notification delivery independently.
First-contact information is yellow only while unread. Ended requests are
history, never persistent priority.

When RuntimeCoordinator confirms that an Agent interaction request has ended
(approval, plan review, or question), Core marks that request read and presents
it as **Request ended**, with no continuing request for a response. Existing read
timestamps, dismissal and history remain intact. Migration `0023` applies this
rule to already-resolved interactions; historical D1 import applies the same
correction. Failure notifications, final outcomes, connection incidents and model
issues retain their own read semantics. Reading never resolves an open request.

Single unread items expose **Mark as read** beside the overflow menu. Single,
group and frozen-view reads immediately update loaded rows and unread counts,
including the toolbar preview. Unread-only views immediately remove read items.
A failed mutation rolls back only its own change; concurrent successful reads
and later arrivals remain intact. Core remains the durable read-state owner.

Confirmed model issues reuse `system_attention_event` with an exact Agent target
and `agent-model:` source namespace. The model/Binding owner reconciles them on
normal controller reports, successful user model edits, and explicit unbinding.
Their owner-only source facts include the exact `personalAgentProfileIds`, not
just generic Agent relevance, so normal access checks can establish and revoke
current ownership. They are ordinary Needs action, not urgent email. Repeated
observations retain the same episode; a change or an authoritatively absent
Binding clears only that model issue, preserving read state and history.
Unbind retries also retry reconciliation when the Binding is already absent;
failed Binding reads and failed/unauthorized unbinds do not claim recovery.
Unknown same-model account evidence cannot claim recovery. The Inbox projection
never writes Wakeability, manual Profile enablement or model selection, and
resolving it does not restart work. Offline Profiles receive the notice when the
normal report resumes; no retirement-date job or immediate global sweep exists.

Legacy owner-observer items without exact personal-Agent source facts cannot
establish derived owner access, even if one or more owned Agents remain in the
Space. Their rows, read/Dismiss state and receipts stay intact; current Human
membership remains an independent access path. Only reliable source-owned repair
may restore an exact Agent relationship, never the current roster or preview text.
Old owner-only message/reply items also remain quiet under both message modes,
including delayed outbox arrivals and retired urgent awareness. Genuine Human
mentions, explicit replies to the recipient and non-observer DMs retain their
normal notification policy.

The four categories remain All, Mentions, Needs action and Needs review. In the
full Inbox, ordinary message updates are collected by Space and target scope,
then by main timeline or Thread when expanded. A Thread has one latest-reply
preview and a quick mark-as-read action. Open requests, urgent outcomes and
first-contact attention remain separate rows above ordinary updates; they cannot
be absorbed by a Space or Thread bulk action. Ordinary desktop, connection and
system notices share a System updates collection. Resolved system requests,
including restored or stopped Computer connection incidents, join that collection
even when their original importance was urgent. Reading an urgent informational
outcome alone does not make it eligible, and open requests remain separate.
This is read-time grouping of existing items; it does not rewrite source facts,
read state or resolution. Completed desktop installation
notices mark read in place instead of navigating to a selected-update panel.

Grouping shares canonical items and read state. Category and other filters run
before grouping, so marking a collection in Mentions reads only its matching
mentions. Different Organizations and target scopes never merge. Expanding a
collection performs no read mutation. Children load in bounded pages with an
explicit Show more action in the page's normal scroll flow.

Expand/collapse all and individual group overrides are browser preferences,
scoped to the account and Organization. They persist only presentation state
(at most 100 individual overrides), never message contents, access, or read state.
Unavailable browser storage does not prevent using the controls for that visit.

Expand/collapse all sits beside the filters; the frozen-selection mark-as-read
action sits beside the first list section heading. Conversation avatars reuse
the authorized Space index, Profile directory, and Center Agent session identity
used by the sidebar. Missing source identity retains the Inbox kind icon;
clients must not guess an avatar from message text or another Organization.

The Web action is labeled **Remove from Inbox**, not Delete. Single-item and
group removal require confirmation. Removing an item excludes it from the
personal Inbox and its unread count; it does not mark the source conversation
read, delete source messages/documents, or resolve a pending request. The removed
Inbox projection cannot currently be restored through the product. Confirmation
retains the selected item or frozen group snapshot, rather than reselecting
whatever happens to be visible after a live refresh.

A feed snapshot records a short-lived, account-and-Organization-bound set of
eligible canonical item ids, not message contents or a second read ledger.
Snapshots expire after fifteen minutes; cursors include the exact filters and
expanded group. Explicit group/view read or Dismiss uses that frozen membership
and rechecks current authorization. Later messages, delayed outbox deliveries,
and formerly hidden muted history cannot be accidentally cleared. These bulk
operations do not advance a conversation viewport watermark or close a request.
Counts describe canonical items rather than the number of grouped rows.

The additive `grouping=space` feed query opts into this presentation; callers
without it retain conversation-level grouping. Opaque cursors bind the grouping
mode. Deploy updated Core/Gateway contracts before the Web opts in; older servers
reject the new query. This changes no stored message, source access policy,
runtime authority, Service/CLI payload or protocol epoch, and needs no migration.

## Product promise

**Inbox** is each member's single workspace-level place to answer one question:
"What changed, and what needs me?"

It brings relevant work from Spaces, Agents, the Center Agent, Documents, and
system flows into one calm, scannable surface. It does not replace those
products. Opening an item exposes the source that owns the work. Invitation
decisions can be made inside Inbox through the source-owned approval endpoint.

Inbox is not the same concept as a notification:

- an **Inbox item** is the durable, user-visible record;
- a **notification** is an optional delivery of that item through a browser or
  email;
- the source product remains the authority for approval, execution, message,
  document, or failure state.

The existing **Feedback Inbox** remains a separate organization-owned intake
for Feedback Issues. Feedback enters a member's Inbox only after a future
workflow assigns a specific member or explicitly requests human intervention.
Phase 1 never broadcasts unassigned Feedback Issues to every member.

## Scope and recipients

### Authorization updates

Sources that require renewed human consent can project an urgent **Needs action**
item to the Organization's current owners and admins. Channel adapters cover
Slack, Feishu and Lark. Existing granted scopes or verified permission-bundle
versions remain authoritative; Inbox does not store a second authorization state.
Unknown grants and transient transport failures do not establish a consent request.

Each source and permission revision produces one item per manager. Opening a
Channel request goes to Channels, where a manager updates the existing connection.
Only verified source recovery resolves the request. Once any manager completes it,
all recipients' copies resolve and become read, and queued emails are suppressed.
This is an explicit read-on-resolution exception for shared authorization requests;
other Inbox sources retain their normal read semantics. Disconnecting the source
also clears an obsolete request without claiming that permissions were granted.

Current manager access is checked on reads and before email delivery. Existing
urgent-email preferences still apply. Already-sent email cannot be recalled.
Other source domains may reuse the guarded authorization-update producer with
their own source identity, revision, target and authoritative recovery condition.

Inbox is scoped by both `organizationId` and `recipientUserId`. A person sees
only their own items in the current workspace. Changing workspaces changes the
Inbox; it must not merge private attention state across organizations.

Phase 1 recipients are authenticated human members. Agents and the Center
Agent may create source events that produce items, but they do not receive or
manage a parallel machine Inbox in phase 1. Future clients and agent-facing
reads must reuse the same Core contract rather than create another store.

## Classification

Every item has two independent classifications:

- **attention**: `update` or `action_required`;
- **importance**: `normal` or `urgent`.

`action_required` means the source currently expects a human decision or
intervention. `urgent` means delaying that attention can block work or cause a
material failure. An ordinary unread update is not automatically urgent.

**Needs review** contains open document and organization approval requests.
**Needs action** contains other interventions, including approved invitations
whose delivery or joining remains incomplete. These views are disjoint.
`unresolvedActionCount` remains their combined total for compatibility and the
global attention badge. Reading or dismissing an item never approves it.

Routine invitation reviews have normal importance and retain transactional
review email independently of urgent-email preferences. The invitation source
reconciles its projections before Inbox list, item, and summary reads, preserving
personal read and dismissal state. Current owner/admin permission gates invitation
item, list, read, dismiss, and count access. Source completion resolves all copies.
Shared approval history remains available to current admins in Settings even
when they dismissed their personal Inbox item. Its Fluid Table places pending
requests before completed records and offers the same approve/decline actions.
Inbox remains the primary review surface; the Table is an additional entry
to the same source-owned decision, not a separate queue or approval state.

Phase 1 source kinds are:

- `space_message`
- `space_mention`
- `agent_reply`
- `agent_interaction`
- `wake_outcome`
- `center_agent_update`
- `document_review`
- `system_issue`

Source adapters choose these values from explicit source facts. Inbox must not
infer urgency from free text, model output, UI copy, elapsed time, or missing
data.

A structured Human Mention produces one `space_mention` update for that person.
It replaces the ordinary Space-message update for the same source and recipient,
so one message never creates duplicate Inbox or browser notifications.
During the bounded receiver-first rollout, readers may still encounter the
retired wire discriminator `space_reference`. They normalize it to
`space_mention` before product behavior or UI rendering. This is transport and
persisted-row compatibility only: people are never presented as Reference, and
new writers create only `space_mention`.

### Agent owner requests

Implementation status: MemberAgent program, PR #236, in progress.

Three source kinds carry decisions that only an Agent's owner can make. Each
is `action_required`, goes to the exact Agent owner, and is resolved only by
its source owner; reading or Dismissing never decides it.

- `agent_access_request`: a colleague's or identified external user's first
  Direct Message to the owner's Agent Profile waits for consent. Responses are
  **Allow once**, **Always allow <colleague> for this Profile**, and
  **Decline**; external users get only **Allow once** and **Decline**.
- `agent_space_request`: someone other than the owner mentioned or added the
  owner's Agent in a Space it is not in. Responses are **Add to Space** and
  **Don't add**. **Message <requester>** opens the Direct Message with the
  requester and keeps the item open. Editing or deleting the bound message
  voids the request and resolves the item.
- `credential_confirmation`: a sensitive operation made with the CLI login
  credential while that computer runs a task whose root requester is not the
  owner. The owner confirms or rejects that exact operation.

These three are `urgent` because each exists only when someone other than the
owner is the root requester. An `agent_interaction` item is `urgent` when the
Wake's root requester is not the owner and `normal` when the owner is the root
requester. The root requester is the server-written first element of the
request chain (see `developing/architecture/agent-transport-contract.md`,
Request Chain). Urgency is decided by that fact and is never inferred.

Agent Interaction items are coalesced per Session: the source event key uses
the Execution Context `contextId`, so a later question in the same Session
updates the same item, and urgent email is sent once per Session rather than
once per question.

## Item contract and ownership

Independent Local Agent Contexts do not create new Inbox identities or a new
execution authority. Recovery items remain keyed to the exact Wake, source
message, requester, and target Agent Profile. Interaction items are keyed per
Session by `contextId` (see Agent owner requests); each response still names
the exact Wake and interaction id. Multiple reserved or
interrupted Wakes may coexist; the first reserved work reference is only a
compatibility projection. Reading or dismissing one item cannot settle another
Context, release its reservation, or publish a reply.

Core owns one canonical item with:

- stable item id and recipient;
- source kind plus a deterministic source event key;
- bounded title and preview text safe for the recipient;
- attention and importance;
- a structured source target that OpenMeld clients can map to a canonical route;
- source occurrence and item update timestamps;
- Inbox-owned `readAt` and dismissal state.

An Agent Interaction target includes its stable source Space signal when the
producer knows it and an exact nullable thread root for every new
RuntimeCoordinator projection. A string identifies one thread; explicit null
identifies the Space main timeline. The interaction id remains useful while the
request is open, but resolved history must still navigate after
RuntimeCoordinator retires the transient interaction state. Older targets
without either additive locator remain valid during mixed-version rollout.
Clients must not treat a missing thread root as the main timeline: when the
origin conversation is unknown, browser alerts fail open and remain visible.

A linked Slack delivery uses a `message_channel` target containing the exact
workspace, channel, thread-root, and published-message ids plus Slack's
validated canonical permalink. OpenMeld does not claim to observe Slack's read
state. Activating that Inbox item marks only the OpenMeld item read and opens
the exact Slack message in a new tab; reading the Slack thread by another route
cannot clear OpenMeld unread state. If permalink lookup or Inbox projection is
temporarily unavailable, the durable terminal delivery remains the repair
source. Reconciliation retries, creates exactly one item, and upgrades legacy
Slack items from the former Center Agent target to the exact provider target
without resetting read, action-resolution, or dismissal state. A durable
last-attempt timestamp keeps one unavailable Slack message from starving later
repairs; reconciliation stops selecting an item after its exact target exists.

The `message_channel` target is durable data, not a presentation-only field.
All strict readers must accept it before Core starts writing it. Once written,
the compatible readers stay deployed even if Core stops producing new Slack
Inbox items; OpenMeld does not delete or rewrite a member's Inbox history to make
an older reader appear compatible. A Web tab left open across this rollout keeps
its complete Inbox and uses the prior Center Agent destination for new Slack
items; after reload, those items open the exact Slack message. It never treats a
valid new target as a broken item or broken entire Inbox list.

`organizationId + recipientUserId + sourceEventKey` is unique. Replaying the
same source event updates the existing item rather than creating duplicates.
Source content must be bounded and must not copy transcripts, credentials,
private local paths, raw provider objects, or diagnostic payloads into Inbox.

Inbox owns reading and recipient dismissal in phase 1. The source owns business
resolution. For example, opening an approval item may mark the Inbox item read,
but only the Agent Interaction response path can approve or reject it. When a
source is resolved, its producer updates the Inbox projection; Inbox never
resolves the source itself.

A producer may use `action_required` only when the source defines the exact open
condition and a source-owned path that emits its resolution. The mere presence
of retry, repair, or diagnostics controls does not turn a terminal update into
unfinished source work.

**Dismiss** removes an item from that recipient's Inbox views and attention counts without
approving, rejecting, discarding, or otherwise changing the source work.
Conversation unread remains independent of dismissal. Core
records Dismiss in `clearedAt`; the item row is not hard-deleted. The retained
recipient/source uniqueness row is the durable replay fence that prevents a
source reconciler from recreating the item or resending delivery. Dismiss is
idempotent and authorized against the recipient's current source access.
Organization deletion follows its canonical cascade. Account deletion explicitly
purges the recipient's Inbox through the durable cleanup owner while retaining a
non-signable identity tombstone for shared work attribution. A
future payload-retention pass must first preserve a content-free source receipt
or tombstone.

Historical native-delivery `admission_retry_exhausted` action notices may contain
a child message id paired with the parent Space. The authorized Inbox reader
omits that untrustworthy message anchor and presents the parent conversation
with guidance to review the outcome or remove the reminder. It does not promise
a retry control. This presentation correction preserves the stored evidence,
read state and pending count; recipient Dismiss clears the reminder and all of
its counts without resolving or restarting the failed task. New source replays
continue to use the native-delivery producer's existing repair contract.

## Phase 1 source coverage

Human requests keep the source owner's scope. Space-bound Plugin approvals,
Agent Interactions, Task reviews, Center Agent attention requests, and
Space-specific work recovery contribute to that Space's attention summary.
Inbox, the Spaces navigation, conversation sidebar, and directory cards/tables
consume that summary; they do not infer pending work from message error icons.
Organization document reviews, membership and Channel setup requests, connector
access upgrades, Computer incidents, and Agent-wide queue/model actions remain
at their Organization, account, or Agent scope. Do not attach those requests to
an arbitrary Space. Slack publication recovery retains its Message Channel
target. Feature-disabled request sources remain hidden.

The first release creates items for these explicit user-visible events:

Thread reply updates are scoped to current members who authored the root or a
retained reply, including the current owners of participating personal Agents.
Space membership, viewing a thread, and owning a nonparticipating Agent do not
subscribe a person. Explicit Human mentions and the exact Wake requester also
receive a Thread update when they are current Space members. Main messages reach
current Human members.

A changed reaction addition to a Human member's message creates one ordinary
unread update for that message's current Human owner, excluding self-reactions.
This applies to main messages and thread replies independently of participation.
The item links to the reacted message, uses the reaction time, and follows normal
Inbox notification preferences. Removal does not create another notification;
adding it again creates a new event. Existing delivered items remain history.

1. A visible Space message, including a Human member's own messages published
   through CLI or automation without an explicit author read confirmation,
   with a targeted reply or
   structured Human Mention receiving the more specific source kind.
2. Any formal Agent or Center Agent message, including proactive Routine results,
   without requiring a requester, mention, or special final-reply purpose. Main
   messages reach current Human members; Thread messages use the audience above.
   A personal Agent's published
   reply also creates an ordinary unread update for its current owner, whether
   the owner, another person, or an Agent initiated the work. The owner need not
   have a separate Human membership when the existing personal-Agent access
   contract grants access. Delivery rechecks the exact replying Agent's current
   ownership; organization-managed Agents do not notify their administrator as
   a personal owner. Overlapping recipient roles produce one item per reply.
   Chats and Spaces reuse the same unread projection and read-through rules.
3. An Agent Interaction that explicitly requests approval, an answer, plan
   review, or other supported human response, with urgency and per-Session
   coalescing as defined in Agent owner requests.
4. A formal system-owned Wake ending published in the conversation:
   a visible failure or stopped outcome, a `stay_silent` outcome, or an
   explicit final status. A successful final reply uses the Agent reply item
   instead of a duplicate success item. An accepted result without a valid
   public Space action is a visible failure, never a synthetic completion. A
   terminal failure is urgent only for its exact requester; other current
   conversation recipients receive an ordinary update. Its preview carries the bounded
   public failure reason; it does not become an unresolved action merely because
   retry and diagnostics are available. When that failure is presented under
   the original Wake message, the Space producer targets that source Signal
   directly instead of exposing the suppressed failure Signal as a second
   navigation truth. Other Wake endings remain ordinary updates.
5. A linked member's Center Agent work started through a Message Channel when
   the result or intervention request is available in OpenMeld.
7. A Center Agent document update awaiting human review. It is sent only to
   current owners and admins who can perform that review. Organization Brief
   and knowledge updates resolve through approval, discard, or replacement. A
   Profile Report update resolves when a human saves the visible report through
   the normal Document editor, even when no text edit was needed; it never adds
   a separate approval action.
8. A concrete system problem only after its owner defines a stable event id,
   exact recipient, safe summary, supported recovery destination, and clear
   condition. Phase 1 provides the typed adapter but does not synthesize items
   by polling current-state or diagnostic tables.
9. One evidence-backed Opportunity that the Center Agent has chosen to present
   to the current verified member. It is an ordinary normal-importance update;
   the Opportunity domain, not Inbox, owns the member's decision.
10. An Agent Profile Creation Request that needs the target owner's decision.
    The item opens the canonical **Agents → Requests** view. Approve, decline,
    cancel, retry, and creation status remain owned by the request domain;
    reading or dismissing the Inbox projection never decides the request.
11. An ordinary Organization member's explicit request for owners and admins to
    set up one Message Channel provider. The Message Channel setup-request
    record owns deduplication and resolution; Inbox projects the request to each
    current owner or admin and links to the Organization Channels page.
12. An invitation request uses the existing `organization_member_request` source
    category with an `invitation:<requestId>` key and an
    `organization_join_request` target. It opens the authorized request detail.
    Each current owner and admin receives an urgent action because joining is
    blocked on their decision. These reviewer-only items identify the recipient
    email so the action and transactional email are understandable. Source reads
    and email delivery recheck current reviewer permission. Decline/cancel resolves
    the action. Approval resolves it only after invitation delivery or the
    applicant's membership fulfillment is confirmed, for every reviewer.

Agent Profile Creation Requests persist their current Inbox projection intent
with the source request mutation. A failed projection remains retryable and is
redriven from that durable intent; replaying the same request also retries it.
Core reconciles rows written during a mixed-version rollout to the request's
current state, so a pending request converges to one action item and any later
decision converges to that item's resolution. Inbox remains a projection and
never becomes approval or request-state authority.

Producers must identify one or more exact recipients from source-owned identity
facts. They must not guess from display names, notify every administrator as a
fallback, or create an item when the target identity is unknown.

Space-backed producers recheck authoritative current Space membership before a
delayed write. Inbox list, count, item read, read mutation, and urgent-email
delivery also fail closed against the current Space Index projection. Losing
Space access therefore removes the item from the member's usable Inbox surface;
Organization membership alone never preserves access to private Space content.

Phase 1 intentionally excludes generic Agent Activity events, unassigned
Feedback Issues, diagnostic-only state, typing/progress/presence events,
successful background bookkeeping, and internal queue or execution records.
Those are not human attention merely because they exist.

### Opportunity projection

The Opportunity domain owns recommendation identity, evidence, recipient, and
the member's `open`, `accepted`, `deferred`, or `dismissed` decision as defined
in `developing/product/opportunities.md`. Inbox stores one bounded
`organization_opportunity` projection whose source key is the canonical
Opportunity id and whose target opens the Center Agent. It never copies action
authority, a destination Channel, or a downstream tool instruction.

Opening or Dismissing the Inbox item does not accept, defer, or dismiss the
Opportunity. A Center Agent decision does not rewrite this historical update.
Phase 1 does not create an action badge, browser notification, email, Slack,
Lark, Feishu, or other proactive delivery from this source; the existing Inbox
surface is the only durable reminder.

## Read and attention behavior

Inbox provides **All**, **Needs action**, and **Needs review** tabs. An independent
**Unread only** switch filters any tab and persists as `unread=true` in the URL
when switching tabs. All retains its nonempty groups under this filter. Unread
items remain visually explicit without relying on color alone. The existing
unread query supplies paginated data; filtered tabs continue loading through
unrelated items before showing an empty state. Legacy `view=unread` links open
All with the switch enabled.

Plugin action approvals retain their originating Space from verified Local
dispatch or native-delivery provenance. The request owner supplies that optional
association to the same Inbox item used for approval; Space attention does not
create another request or unread record. Unscoped manual requests stay in Inbox.
Reading a request leaves pending attention in place; source approval, rejection,
expiry, or revocation ends it. Only the recipient with current Space access sees
the associated Space attention. Lack of Space access does not hide a
recipient-owned Plugin approval from Inbox: delegated work can originate in a
child Space without Human membership. Request detail navigation and approval
authorization remain request-owned.

List titles reserve a 6px status dot with an 8px gap. An unresolved action or
review uses the yellow attention tone, including after it is read. Red is
reserved for an explicit error, never inferred from a pending action count.
Otherwise, an unread open urgent item uses the yellow urgent tone, and other
unread items use the blue unread token. Read items without pending work have no
dot; the reserved space keeps titles aligned. Each item shows at most one dot,
with action priority above urgency and ordinary unread state. Existing text
labels and screen-reader unread text remain available. Reading does not resolve
pending work, and resolving an action removes its yellow attention treatment.
Submitting an Agent interaction response optimistically removes one pending
action from that Space's cached attention count. Failure restores the snapshot
only if no newer snapshot has replaced it. Settlement refreshes Inbox projections;
this presentation update does not assert that execution has resumed.

Opening an Inbox item marks that item read as part of navigating to its source.
Keyboard activation behaves the same way. Merely scrolling an item into the
viewport, hovering it, or focusing the browser does not mark it read. Members
can mark an item unread and can mark all currently presented Inbox attention
items read. Ordinary updates hidden by a conversation mute remain unread.
The bulk **Mark all as read** button appears only with **Unread only** enabled,
immediately to the left of that switch. A compact confirmation explains that
the action includes items outside the current filter and clears the corresponding
Space unread indicators in the current organization. Pending actions and reviews
remain open. Canceling makes no changes; confirming closes the dialog and starts
the existing optimistic mutation without a blocking wait.

For an external Message Channel source, the same activation contract runs
before the validated provider permalink opens. Provider read receipts are not
Inbox truth and are never inferred or polled when the provider does not expose
an authoritative per-member read contract.

Members can also Dismiss any item they no longer want in Inbox. Dismiss
immediately removes the item from **All**, **Unread**, **Needs action**, and the
global attention count, but leaves any unfinished source action available at
its canonical source.

A resolved action is no longer presented as actively urgent. Its historical
title and preview may remain visible in **Updates**, but an `Urgent` treatment
must not imply that the member still has an outstanding decision.

The sidebar header Inbox badge counts two disjoint sets: uncleared, unresolved
`action_required` items (read or unread), plus uncleared, unread urgent `update`
items. Resolved actions never contribute. An urgent action counts once, as an
action. Ordinary unread updates do not inflate this count. Reading an urgent
update clears its contribution; reading an action does not resolve it. Dismiss
removes either contribution without changing source business state.
Core computes both exact counts over the complete accessible recipient Inbox,
independently of list pagination. Web caps only the displayed sum at `99+`.

Open actions and unread priority updates make the badge yellow. Pending work
does not imply an error or grant urgent-email eligibility.
Ordinary unread updates show a blue dot on the Inbox entry without contributing
to the numeric attention count. The bottom-right launcher also shows the same
highest-priority dot. Browser tabs reuse this exact Inbox summary and priority:
yellow for pending work or priority updates, blue for other unread,
and the original favicon when none remain. The title includes the highest
priority category and its count, retaining the current route title. Reading an
action never clears its yellow indicator; source resolution or recipient Dismiss
does. Opening the tab or Inbox alone does not clear any indicator.

The authenticated tab observes the existing summary query in the background
at its existing interval, subject to browser throttling. It does not require
notification permission, create another unread store, or merge Organizations.
Workspace changes and logout remove the previous scope's title and icon.
Unknown summaries use the original icon and an unavailable title instead of
claiming that the Inbox is clear. Loading starts with the original title/icon.
Indicator colors come from the same themed UI classes as the Inbox; the tab
composites a static dot onto the existing logo rather than maintaining logo
copies. There is no animation or green healthy-connection indicator.

The bottom-right Inbox launcher uses the same tone on its icon and label, with
no number. Both entry points expose the exact action/urgent-update breakdown in
their accessible names and hover descriptions. Missing or failed summaries are
unknown, never zero; the header renders no badge without a confirmed count.
Initial loading retains the plain Inbox label without a checking message or
placeholder badge. Background refreshes and read/dismiss mutations retain the
last confirmed count until Core returns the updated summary, without an
intermediate visual change or an optimistic count.
Failed summaries still expose their unavailable status. Entry activation alone
never clears an item.

The default full Inbox, compact preview, global indicators, and Desktop menu bar
use Core's opt-in **attention presentation**. An explicit conversation mute
hides that conversation's ordinary updates from these attention surfaces,
including items created before the mute, without reading, dismissing, deleting,
or changing their raw Inbox records. Open actions and reviews remain visible
whether read or unread; unread urgent updates and unread structured Human
mentions also remain visible. Removing the mute reveals the preserved ordinary
history again. Notification delivery remains a separate policy and the mute
continues to suppress every message notification from that conversation,
including urgent updates and mentions.

The raw list remains available to notification delivery and bounded diagnostic
consumers so preference changes cannot replay historical items as newly
delivered. Saving a conversation preference invalidates only attention lists
and summaries; raw delivery state is unchanged. Attention summary categories
are disjoint: open action/review, unread urgent update, unread mention, and other
unread update. Core computes the projection over the complete accessible Inbox;
clients never reconstruct it from a loaded page.

The toolbar preview uses the canonical `GET /v1/inbox/feed` with the full
Inbox's All category and Space grouping. It shares the **Needs your attention**
and **Updates** sections, source access, ordering, expansion preferences and
read mutations. Open requests remain visible after reading; read history remains
browsable. Resolved system history stays inside **System updates**, and Space
updates retain their conversation groups. Clients never group a truncated page
of individual events or derive summary counts from the displayed rows.

The preview fetches twelve grouped rows per page and loads the next page when
the scroll sentinel becomes visible. Expanded collections use the shared
bounded member pages and **Show more** control in the same scroll area.
Initial loading, initial failure, refresh failure and pagination failure remain
distinct; failed refreshes and pagination retain loaded content with a retry.
Expired snapshots disable group mutations until refreshed. Opening the preview
or expanding a group does not mark it read. Group read actions retain frozen
snapshot membership and never resolve pending work.

Compact rows bound their title and summary, with accessible read actions.
The fixed footer always offers **Open full Inbox** for search, filters and
removal; the header provides **Close Inbox**. The Core summary alone supplies
the header status and may say **All caught up** only when there are no unresolved
actions and no unread items. An empty feed says **No updates yet**.

### Space message unread behavior

Every formal published main-conversation message is an unread update for current
Human members, including proactive Routine results, Agent replies, task results,
and system-owned outcomes. A requester or mention is not required. Thread updates
remain scoped to participants and explicitly addressed recipients. Public browsing
does not establish membership. Transient progress and membership notices are not
new conversation messages. Failure urgency belongs only to the Wake requester;
other conversation recipients receive an ordinary update.

Read state, Inbox dismissal, source requests, and notification delivery are separate.
Dismiss removes an item from the recipient's Inbox, but does not mark its message
read in the Space. Only reading or an explicit mark-as-read action changes that
read fact. Business requests retain their source-owned resolution rules.

An Agent's presence alone never makes a message relevant to its owner. Personal
owner awareness requires actual structured Agent addressing, a Human message
in that Agent's DM, or that Agent's own published reply. Activation and Reference
both carry mention relevance; Reference never starts work. A Human message in a
current Agent DM establishes contact even when it references the recipient Agent;
a Reference alone in an ordinary Space does not. Retained-history scanning uses
the same contact rule, without replaying an old reminder or altering Wake targets.
Automatic Thread Wake continuation is not an explicit new contact. Center Agent
and other managed Agents have no personal owner for Inbox purposes. Local/Remote
placement changes none of these rules.

Space freezes first-contact identity in the publication transaction using the
Organization, exact main/DM or Thread-root scope, initiating Human **account**,
recipient account, and personal Agent. Only that first source signal carries
`sourceFacts.firstContactAgentProfileIds`; later messages and retries preserve
the original identity. A second Human Profile of the same account cannot create
a self reminder. Long-running main/DM scopes conservatively have one contact
boundary: no topic inference, model turn, cooldown, read or Dismiss resets it.
Retained structured history seeds existing contacts without replaying awareness;
an unavailable/pruned prefix is conservatively not treated as a provable first.

The underlying update remains `importance: normal`, so first-contact awareness
does not create an urgent email. Source facts distinguish Agent activity,
personal-Agent mentions and merged Human mention/reply/requester/owner reasons.
An explicitly addressed Agent's owner can receive the exact Thread item without
subscribing to the entire Space or gaining Human membership/write permission.
Current ownership and membership remain read/delivery authorities. Recipient
selection is frozen before a fallible Inbox write, while current eligibility is
checked independently on retries. The bounded rollout repair preserves item ids,
occurrence/read/Dismiss/resolution state and terminal email receipts; it only
downgrades the retired owner-observer writer and suppresses pending urgent mail.

Authorship does not establish reading. Web composer sends confirm only their
exact authored message with `authorHasRead: true`; Core omits that author's
Inbox candidate while preserving all other recipients. The confirmation is
persisted with the message and its projection intent, so delayed projection
and idempotent retries cannot recreate a self reminder. It never advances a
main or thread read-through watermark. CLI sends omit the confirmation by
default. Unconfirmed self messages use ordinary `space_message` updates even
when they mention the author or reply to the author's thread; they do not
escalate to browser delivery or urgent email. Existing historical projections
are not backfilled. Account ownership and current membership remain the
recipient authority.

Every Inbox message projection backed by a Space carries its canonical source
Space id and Signal occurrence time. Web reads one Core summary of at most 500
unread message projections grouped by Space. Approval, question, and plan-review
requests remain action items in Inbox; they do not masquerade as unread Space
messages. The Spaces secondary sidebar shows a static blue dot and stronger
name treatment for every visible ordinary or pinned Space with unread messages.
Unpinned Spaces with unread messages sort before read Spaces, newest unread
first; pinned Spaces keep the member's explicit pin order. The indicator is
accessible without color and does not pulse. Direct Messages remain in their
owning navigation surface instead of reappearing in the Spaces sidebar; each
unread Direct Message shows the same static blue indicator on its exact
conversation row so the member can identify what needs attention.
The Spaces destination in the outer app rail shows yellow while any accessible
Space or Direct Message has pending attention, then blue for ordinary unread
messages. Its accessible label reports the complete unread message count. Core
derives the ordinary Space aggregate before the grouped summary's 500-Space
presentation limit and excludes current Direct Messages and legacy welcoming
Spaces through the Space Index classification; converted Direct Messages count
as ordinary Spaces. Web combines that total with the complete DM total. The
outer dot does not identify a second unread owner or replace the per-Space
indicators; it guides the member into Spaces, where the secondary sidebar shows
which exact Spaces are unread.

Direct Messages use the same Core attention projection, including Center Agent
sessions. Conversation rows use yellow for open actions or unread urgent updates,
then blue for ordinary unread. Grouped attention has no unread-page limit, and
reading a request does not resolve it. Only the Inbox icon carries the numeric
attention badge; conversation indicators remain dots with accessible labels.

Every final Center Agent reply in its current, unconverted member Direct Message
is projected as an ordinary Inbox update with a canonical Center Agent target
containing both the source Space id and source Signal id. While any such item is
unread, the reply contributes to the Spaces destination's DM unread total.
Conversion makes the Space Index classify that conversation
as an ordinary Space, so its unread items contribute only to the Spaces
destination even when their durable target remains `center_agent`. The dot sits
immediately after the label in the full rail and on the icon corner in compact
or collapsed tiers; it includes an accessible unread-count label and does not
pulse.

Opening a Space never clears unread on route entry alone. The canonical recipient
Inbox rows own read state. Web acknowledges exact item IDs and occurrence versions
whose message header and beginning are rendered in a focused, visible viewport.
A short 50 ms batch retains observations during scrolling; moving away does not
erase already observed updates. Hidden Threads, unloaded history, background tabs,
and covered content are not read. Out-of-order reading acknowledges only observed
items, without advancing over earlier unseen updates. Existing legacy read-through
endpoints remain supported for older clients; the new viewport path does not write
those watermarks. Reading never resolves unfinished source work.

If the message appears before its Inbox row, Web sends the exact source Signal
and occurrence time. Space resolves the retained publication intent and current
recipient eligibility. Core inserts the canonical recipient row and marks that
version read in one transaction. Outbox replay preserves the read fact; no second
read ledger or historical replay is introduced. Navigation anchors are separate
from source identity: an anchored failure is read only when its outcome is visible,
and reaction reads cannot advance beyond the rendered reaction revision.

The blue unread pill stays available until the complete Space unread count is zero.
Its left side always navigates to the earliest remaining target across main and
Thread messages, opening the exact Thread reply when necessary. Sidebar and Space
list unread dots use the same ordered targets; ordinary row links keep their normal
navigation. Navigation itself never marks unrelated messages read. The bottom
history arrow only returns to the latest message.

The pill's X has the accessible name and tooltip **Mark all as read**. It opens a
confirmation dialog that explicitly includes thread replies. Preparation freezes
canonical Inbox membership on the server using the existing expiring feed snapshot
storage. Confirming rechecks recipient, Organization, Space and current source
access; later arrivals and items updated since preparation remain unread. Cancel
writes no read state. Retry reuses the same selection, and expired selections ask
the user to reopen the dialog. Clearing does not affect other Spaces or open work.

The main and each Thread keep a stable **New messages** anchor while their scope
has unread updates, then remove it when that scope reaches zero. **Open thread**
remains available with neutral styling after its unread count reaches zero. Full
scope counts and the bounded navigation page come from the same canonical rows;
counts are not inferred from only the currently loaded page. New clients opt into
item IDs and scope counts with `includeItemIds=true`, and source event identities
with `includeSourceKeys=true`, preserving strict legacy
response shapes. Exact visible reads update shared query projections optimistically,
restore on failure, and reconcile against Core after persistence. No dismissed-pill
state or browser read ledger owns unread truth.

This uses Slack's separation of conversation navigation, thread attention, and
read actions as a precedent, not an identical default: Slack offers immediate
mark-as-read on conversation entry and includes mentioned users in thread
notifications. OpenMeld preserves participant-only recipients and the visible
visible-read contract above. References: [Slack read preferences](https://slack.com/help/articles/360043037853-Manage-your-Mark-as-Read-preference)
and [Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions).

The Center Agent may create an explicit response request only for the verified
member in the current OpenMeld Space conversation. `response_needed` is a
normal action-required item. `work_blocked` and `material_failure_risk` are
urgent and are valid only for concrete blocking or time-sensitive material
risk; model tone, elapsed time, and ordinary unread replies never upgrade an
item. A normal response request may use browser delivery when enabled but does
not create urgent email. An urgent request follows the member's urgent-email
preference. The member's next reply in the same Space resolves all open Center
Agent response requests for that member and Space; reading or Dismissing alone
does not resolve them.

When a running Agent Profile Wake ends because structured Usage is exhausted,
restored Usage automatically retries only that interrupted request. This retry
does not create an Inbox action. After the retry succeeds, later queued Wakes
remain held behind one separate owner approval item. That item is action
required and urgent, so it may use urgent email; approving it resumes FIFO from
the oldest held Wake. Reading or Dismissing it does not approve queued work.
If the interrupted request cannot be replayed safely or that one automatic
retry fails, OpenMeld creates exactly one urgent `Needs attention` item linked
to the original Wake. Repeated failure or recovery reports update the same
idempotent item instead of creating Inbox noise. Reading or Dismissing it does
not resolve the recovery gate. The owner may skip the interrupted work; that
action is idempotent and allows the oldest later Wake to continue.

A hosted Center Agent task continuation that remains unacknowledged after all
three admission attempts creates one normal update `system_issue` item for the
represented member. Without a supported recovery action, failure alone does not
make an item urgent or action required. Its stable source identity is the
continuation Native Delivery plus `admission_retry_exhausted`. Its target opens
that delivery's own failure Signal, otherwise its original thread or Space.
A watched child task's result Signal must never be paired with the observer's
Space ID. Queue redelivery and terminal-effect replay update the same item
rather than creating duplicate alerts. Reading or Dismissing the item does not
claim that the continuation ran or resolve its underlying failure.
Source-owner replay repairs only the retired producer's exact unresolved
urgent/action projection, including its mismatched child Signal target. It keeps
the same source identity, occurrence, read and removal state, and suppresses
pending urgent email. Its Inbox resolution becomes `not_applicable`, not a
claim that the underlying task succeeded. General source conflicts still fail
closed. Authorized Inbox RPC preparation also asks the native-delivery owner
to reconcile up to 80 legacy items for that recipient before reading the feed
or its counts. This reaches already-settled records without a new task event or
a user Read/Dismiss action. Each successful repair leaves the legacy selection;
subsequent refreshes drain additional batches. Missing or mismatched source
evidence is preserved rather than guessed. This is a bounded historical repair,
not a second execution writer.

The source inventory and extension contract are in [Inbox actions](inbox-actions.md).

## Delivery channels and preferences

### Message notification preferences

Human replies in an existing thread carry a recipient-specific
`replyToRecipient: true` Space source-target marker for the current Human owner
of the thread's root message. The Space resolves that owner from its retained
root Signal and active membership; the marker never comes from a title, quoted
text, or a client-selected recipient. Self replies (including another Profile
owned by the same account), ordinary thread participants, and nonparticipants
do not acquire this marker. Existing thread-recipient restrictions remain
unchanged. Explicit mentions retain Human Mention semantics.

Mentions and replies admits these marked updates without making them urgent or
creating email deliveries. Conversation mute, read state, source access, and
visible-conversation suppression still apply. Older unmarked Inbox rows are not
backfilled or inferred from their title.

**Default message notifications** is an account preference: **All new messages**
or **Mentions and replies**. Existing accounts default to Mentions and replies,
preserving direct-message, mention, addressed reply, and urgent-update delivery.
The preference applies to both Web and Desktop. Desktop's native process
independently revalidates it before delivery using the shared notification policy.
Every authorized Space and Direct Message header exposes a bell with **Use
default**, **All new messages**, **Mentions and replies**, and **Mute message
notifications**. Use default displays the current account value and follows
future changes. An explicit override belongs only to that recipient and
conversation, survives account-default changes, and can be removed by choosing
Use default. Settings never change another member's preferences.

All new messages admits newly observed unread conversation updates already
projected into that recipient's Inbox. It does not subscribe the member to
every thread, broaden source access, backfill old messages, change message
importance, or create email deliveries. Muting suppresses conversation message
updates, including urgent message updates; independent action-required items
retain their existing delivery rules. Raw Inbox content, read state, and source
resolution remain unchanged. The default attention presentation hides muted
ordinary updates while retaining open work, unread urgent updates, and unread
Human mentions as described above. **Urgent email alerts** stays an independent
account setting, including for urgent items from a muted conversation.
This includes Human Mentions and urgent terminal Wake outcome updates: neither
bypasses a conversation's message mute. An open action-required item retains
its own delivery eligibility.

Browser delivery must also pass the browser-local switch, permission, and
visible-conversation gates. The header links to global notification settings
and explains when browser notifications are off. Before native delivery, Web
reads the recipient-authorized current message preference again after obtaining
the delivery lock. A failed preference read stays retryable; inaccessible
conversations are ineligible. Preferences never create a second unread store.

**Show an example** in global Settings creates one browser-local sample when
browser notifications are enabled. It creates no Inbox item or delivered-item
receipt and respects the sound preference. The UI reports that an example was
requested and explains browser/system and Focus checks if nothing appears;
creating a Notification object does not prove that the operating system showed
a banner.

The in-product Inbox is always available and cannot be disabled. Phase 1 has
optional delivery channels:

- **Browser notifications** are browser-local and become enabled when the
  browser grants permission unless the member has explicitly turned them off
  in this browser. When permission is still undecided and the member has never
  enabled, disabled, or dismissed notifications in this browser, OpenMeld shows
  one concise introduction on entering an actual Space, after onboarding. It
  does not show on initial landing, Home, or the Space directory, and waits for the member to
  choose **Enable notifications** before requesting native browser permission.
  **Not now** dismisses that introduction for this member in this browser; it
  never grants, denies, or changes browser permission. The introduction explains
  that notifications can be enabled later in Settings > Notifications. The switch remains
  global for all Spaces and Direct Messages and is reachable from Settings ->
  Personal -> Notifications and from any Space Info. Phase 1 delivers newly
  observed unread items that are urgent, open action-required, or directly
  addressed to the member: references of that member, replies intended for them (a
  successful Wake reaches its requester through its final reply item), their
  system-owned Wake endings addressed to that requester (visible failure,
  stopped, `stay_silent`, policy-blocked action, or explicit final status), and
  messages in a current Direct Message. Formal Agent DM replies address the
  active human participant even without a Wake correlation; ordinary Space
  replies retain explicit-recipient rules. Ordinary
  Space message updates stay in Inbox without a system notification under the
  default Mentions and replies policy; All new messages includes them. Only a
  visible, focused window suppresses delivery for the conversation it is showing
  or advances its automatic read position. A visible second window without focus
  is not evidence of reading. Leaving the conversation, hiding the tab, or losing
  focus re-evaluates the same unread item. Browser delivery is acknowledged only
  on the Notification `show` event, never on constructor success. `error`, close
  before `show`, or no acknowledgement within ten seconds remains retryable; the
  unconfirmed attempt is closed. Account/Organization changes, disabling delivery,
  and listener unmount abort pending locks and unacknowledged attempts. A late
  event cannot settle an aborted attempt. Even `show` does not prove an OS banner
  or that the member saw it. Browser-local receipts deduplicate acknowledged
  attempts; permission, claim, and delivery failures remain retryable. A low-frequency browser-local
  timer re-evaluates pending failures even when the Inbox query data does not
  change. The browser-local pending ledger stores each member-, Organization-,
  and item-scoped retry independently so concurrent tabs cannot overwrite one
  another. After reload, the client resolves pending ids through bounded,
  authenticated single-item reads even when an item has moved beyond the first
  Inbox page. Every recovery attempt requires a fresh Core read rather than a
  client freshness-cache hit; missing, read, resolved, or otherwise ineligible
  items clear their pending record. Retry timers are owned by the current feed,
  so a late failure from a previous member or Organization cannot block its
  retries. A queued delivery uses a fresh recipient-authorized Core item read,
  then rechecks the committed member, Organization, item eligibility, and
  visible conversation immediately before creating the notification. Clicking
  the notification opens that refreshed item's canonical source target -- the
  exact Space message or thread, Agent interaction, Center Agent conversation,
  Organization document, setting, or connected-channel message -- instead of
  routing through Inbox. Repeating the same explicit click requests source focus
  again even when its URL is unchanged. A failed
  revalidation remains pending and retryable. Unmounting the authenticated
  listener invalidates that context, so a delivery waiting on a browser lock
  cannot publish content from the previous account. Browser delivery never
  forms a second unread store. After the browser acknowledges a notification,
  Web may play one browser-local OpenMeld sound. Ordinary
  directly addressed updates use the `ready` cue; urgent or open
  action-required items use the `chime` cue. Sounds default on for each member
  in each browser and can be turned off independently of browser permission.
  Web coalesces notifications observed within 350 milliseconds into one sound,
  with `chime` winning a mixed burst. The cue uses the fixed full app volume;
  there is no separate volume slider. Browser autoplay policy, missing audio
  support, or playback failure stays silent, never changes notification
  delivery truth, and never makes the Inbox item retry.
  Notification observation uses the authenticated insertion cursor endpoint,
  not the first page of the occurrence-sorted Inbox list. A fresh listener
  establishes an empty baseline instead of replaying old unread history. Each
  refresh reads at most 50 entries; remaining pages are requested at a one-second
  cadence, with the normal ten-second browser poll after catching up. Delayed
  source events retain their insertion position even when their occurrence time
  is old. The observer advances only after eligible ids are retained in the same
  pending ledger. Network or storage failure holds the cursor for retry; reload
  recovers retained pending ids and establishes a fresh observation baseline.
  Settings distinguish the saved preference from storage availability: blocked
  reads or a failed pending-record write show a paused error, disable unusable
  controls/sample delivery, and never rewrite the member's preference. Write
  failures notify mounted settings subscribers immediately, including when reads
  still succeed because storage is full. The observer keeps polling at its
  retained cursor; successfully saving the failed pending record clears the pause.
  Each authorized observation refresh with delivery enabled also checks recovery
  once while a write failure is recorded, including empty pages in a hidden tab.
  Recovery cannot depend on the failed item remaining unread or accessible.
  Refresh and focus/visibility checks use the same fresh temporary write,
  readback, and removal sized for the failed record. Reads and unrelated same-value
  writes are not recovery evidence. Snapshot reads never perform recovery writes;
  probes never change saved preferences, pending ids, or the observation cursor.
- **Desktop notifications** independently deliver the same eligible Core Inbox
  items while the authenticated GUI is running, including unfocused, minimized,
  and hidden windows. Quit ends GUI delivery and does not stop the Service.
  The shared client listener owns bounded observation, retry and deduplication;
  the native process supplies the background cadence and OS delivery adapter,
  never another Inbox or execution authority. A native `show` acknowledgement
  settles delivery; failure or no acknowledgement remains retryable. Desktop
  reads its own account-local enabled and sound preferences, defaulting on;
  browser permission, browser preferences and Web presence do not control it.
  Settings > Personal > Notifications and Space Info show Desktop wording.
  macOS permission is unknown unless an API establishes it; platform support
  is not authorization. Focus and OS notification settings remain authoritative
  for presentation. The test button checks OS delivery only. Native sound
  replaces the Web sound cue, and bounded Core previews retain their existing
  privacy scope. Only a focused, visible Desktop reading the exact conversation
  may suppress its notification or advance its read position. Notification
  clicks revalidate current account and source access before restoring the
  window and opening the canonical item target.
- **Urgent email** is enabled by default at the account level and may be turned
  off in **Settings -> Personal -> Notifications**. Only `urgent` items are
  eligible. Email links to the same Inbox item/source and carries bounded safe
  content.
- **Invitation review email** is transactional mail to current
  owners/admins. It reuses the same durable delivery ledger with an explicit
  `invitation_review` purpose and does not depend on the urgent-email preference.
  Auth rechecks current reviewer role before sending. It links to the same
  recipient-authorized Inbox item; the email itself never approves the request.

Browser permission and the OpenMeld sound preference are device/browser state.
The email preference is durable account state. Phase 1 does not provide
schedules, digests, quiet hours, snooze, Slack delivery, CLI
delivery, Web Push for a closed browser, or Mobile delivery.


## Delivery reliability

Core records one delivery per eligible Inbox item and channel. Urgent email is
processed from the durable record, retried with bounded backoff by the Core
scheduled task, and becomes `sent`, `failed`, or `suppressed`. Reading an item
does not recall already-sent email. A Dismiss, disabled preference, resolved
action, or revoked source access observed before claim suppresses an unsent
delivery. Any of those changes racing an already claimed provider send is
best-effort and cannot recall that in-flight email.

Cloudflare Email Service returns a provider message id but offers no
delivery-id idempotency key or uncertain-send lookup. The Core ledger therefore
provides at-least-once delivery across the external-send boundary: after a
successful provider send, a crash before the ledger records `sent` can produce
a duplicate retry. Copy and handling must tolerate that narrow case and must
not claim exactly-once email delivery.

Auth owns account email identity and the Cloudflare Email Service binding.
Core requests delivery by user id through a strict shared RPC contract; it does
not read Auth's private user table, persist an email address in Inbox, or log
message content. Auth sends both plain-text and HTML transactional variants and
returns only a delivery result safe for Core's ledger.

## Client reuse

Core contracts use organization and recipient identity explicitly and return
structured source targets rather than Web-only URLs. Web maps those targets to
routes in phase 1. List pagination and direct recipient-authorized item lookup
are separate contracts so an email or browser deep link never scans an
arbitrary number of list pages. Future Desktop and Mobile clients reuse the same item,
counts, preference, and mutation contracts and may add their own delivery
adapters without changing Inbox truth.

## Phase 1 acceptance

- The current Organization opens to the Center Agent conversation as Home after
  authorization. Inbox remains a canonical full page reached from its permanent
  bottom-right global launcher and compact launcher preview.
- Inbox stays out of the primary product rail. A bottom-right global launcher
  remains available across the authorized Web shell and shows the
  high-attention count.
- Activating the launcher opens a responsive compact version of the canonical
  grouped feed, with source navigation, read-on-open, group read actions and
  continuous pagination. **Open full Inbox** remains visible below the scroll
  area and opens the canonical page.
- Unread Center Agent replies show the rail dot in every rail tier and clear
  only through the visible-message read-through contract.
- Explicit Center Agent response requests classify normal versus urgent from
  the model-visible impact enum, and the member's next reply resolves the open
  source request.
- Items are deduplicated, private to their recipient, filterable, and have
  deterministic read/unread behavior.
- Opening every supported item reaches its canonical source.
- Agent Profile Creation Request items navigate to the exact request and never
  treat Inbox read or Dismiss as approval or decline.
- Source resolution never occurs through Inbox read or Dismiss mutations.
- Every full-page item offers Dismiss; it removes only the recipient's Inbox
  projection and updates unread and attention counts without a refresh.
- Browser delivery is permission-aware and derives from Inbox data.
- Urgent email is default-on, user-disableable, retryable, and contains no
  sensitive diagnostic or transcript data.
- Source adapters cover every phase 1 row above and reject unknown recipient
  identity instead of broadcasting.
- Empty, loading, error, offline, and permission-denied states are explicit.
- Web styling reuses shared shell, Fluid, focus, color, and shape tokens and
  remains usable under reduced motion.
