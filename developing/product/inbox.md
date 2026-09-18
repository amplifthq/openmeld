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
 Feedback Issue storage, Space message storage, or
  provider-specific messaging.
- Source of truth: This file owns the Inbox product model. Source owner documents
  remain authoritative for the work or event represented by an Inbox item.

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

## Item contract and ownership

Independent Local Agent Contexts do not create new Inbox identities or a new
execution authority. Recovery and interaction items remain keyed to the exact
Wake, source message, requester, and target Agent Profile. Multiple reserved or
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

**Dismiss** removes an item from that recipient's Inbox views and counts without
approving, rejecting, discarding, or otherwise changing the source work. Core
records Dismiss in `clearedAt`; the item row is not hard-deleted. The retained
recipient/source uniqueness row is the durable replay fence that prevents a
source reconciler from recreating the item or resending delivery. Dismiss is
idempotent and authorized against the recipient's current source access.
Organization and account deletion still follow their canonical cascade. A
future payload-retention pass must first preserve a content-free source receipt
or tombstone.

## Phase 1 source coverage

The first release creates items for these explicit user-visible events:

Thread reply updates are scoped to current members who authored the root or a
retained reply, including the current owners of participating personal Agents.
Space membership, viewing a thread, and owning a nonparticipating Agent do not
subscribe a person. This audience restriction also applies to explicit mentions
inside thread replies; main-timeline addressing keeps its existing audience.

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
2. An Agent or Center Agent reply intended for the member who initiated the
   interaction, a current human member explicitly mentioned by the reply, or
   the current human author of the target thread. A personal Agent's published
   reply also creates an ordinary unread update for its current owner, whether
   the owner, another person, or an Agent initiated the work. The owner need not
   have a separate Human membership when the existing personal-Agent access
   contract grants access. Delivery rechecks the exact replying Agent's current
   ownership; organization-managed Agents do not notify their administrator as
   a personal owner. Overlapping recipient roles produce one item per reply.
   Chats and Spaces reuse the same unread projection and read-through rules.
3. An Agent Interaction that explicitly requests approval, an answer, plan
   review, or other supported human response.
4. A Wake requested by the member that reaches a system-owned ending:
   a visible failure or stopped outcome, a `stay_silent` outcome, or an
   explicit final status. A successful final reply uses the Agent reply item
   instead of a duplicate success item. An accepted result without a valid
   public Space action is a visible failure, never a synthetic completion. A
   terminal failure is an urgent update whose preview carries the bounded
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

List titles reserve a 6px status dot with an 8px gap. An unresolved action or
review uses the existing red attention tone, including after it is read.
Otherwise, an unread open urgent item uses the yellow urgent tone, and other
unread items use the blue unread token. Read items without pending work have no
dot; the reserved space keeps titles aligned. Each item shows at most one dot,
with action priority above urgency and ordinary unread state. Existing text
labels and screen-reader unread text remain available. Reading does not resolve
pending work, and resolving an action removes its red attention treatment.

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

An open action makes the badge red; otherwise unread urgent updates make it
amber. Red means a human action is outstanding, not that every action is urgent.
Ordinary unread updates show a blue dot on the Inbox entry without contributing
to the numeric attention count. The bottom-right launcher also shows the same
highest-priority dot. Browser tabs reuse this exact Inbox summary and priority:
red for open actions, amber for unread urgent updates, blue for other unread,
and the original favicon when none remain. The title includes the highest
priority category and its count, retaining the current route title. Reading an
action never clears its red indicator; source resolution or recipient Dismiss
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

The compact preview uses the same summary breakdown. It separately queries
**Needs action**, **Needs review**, **Urgent updates**, **Mentions**, and unread
**Recent updates**, in that order, without duplicating an item across groups.
The `urgent_updates` list view
uses the same predicate as the urgent update count, so older urgent updates
cannot be displaced by a page of newer ordinary messages. The `mentions` view
selects unread structured Human mentions independently of recency. The
`recent_updates` view independently selects unread items outside all stronger
attention groups so a page of actions, urgent updates, or mentions cannot starve
ordinary updates either. That mentions exclusion applies only to the opt-in
`presentation=attention` projection; legacy/raw `recent_updates` callers keep
mentions because they do not query the separate group. The bounded preview
reserves room for each group; full Inbox remains the complete list. It may say
**All caught up** only when there are no unresolved actions and no unread items.

### Space message unread behavior

An Agent's presence alone never makes a message relevant to its owner. Personal
owner awareness requires actual structured Agent addressing, a Human message
in that Agent's DM, or that Agent's own published reply. Activation and Reference
both carry mention relevance; Reference never starts work. Automatic Thread Wake
continuation is not an explicit new contact. Center Agent and other managed
Agents have no personal owner for Inbox purposes. Local/Remote placement changes
none of these rules.

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
While any ordinary Space message remains unread, the Spaces destination in the
outer app rail shows one static blue dot across OpenMeld. Its accessible label
reports the complete unread ordinary Space message count. Core derives that
aggregate before the grouped summary's 500-Space presentation limit and
excludes current Direct Messages and legacy welcoming Spaces through the Space
Index classification; converted Direct Messages count as ordinary Spaces. The
outer dot does not identify a second unread owner or replace the per-Space
indicators; it guides the member into Spaces, where the secondary sidebar shows
which exact Spaces are unread.

Chats uses complete Core aggregates for unread messages, open action requests,
and unread urgent updates across current DMs, including Center Agent sessions.
The Chat row and destination use red for open actions, yellow for unread urgent
updates, then blue for ordinary unread. Grouped attention has no unread-page
limit, and reading a request does not resolve it. Only the Inbox icon carries
the numeric attention badge; Chat indicators remain dots with accessible labels.

Every final Center Agent reply in its current, unconverted member Direct Message
is projected as an ordinary Inbox update with a canonical Center Agent target
containing both the source Space id and source Signal id. While any such item is
unread, the Center Agent destination in the outer rail independently shows one
static blue dot. Conversion makes the Space Index classify that conversation
as an ordinary Space, so its unread items contribute only to the Spaces
destination even when their durable target remains `center_agent`. The dot sits
immediately after the label in the full rail and on the icon corner in compact
or collapsed tiers; it includes an accessible unread-count label and does not
pulse.

Opening any Space destination does not clear unread state on route entry alone.
For one open Space, Web reads Core's exact unread message targets and preserves
their main-conversation or thread-root scope; a browser Space cursor is not an
unread owner. Web writes one monotonic main-conversation read-through watermark
only after the document is visible and the message header and beginning of its
body remain in the conversation viewport for 150 ms. Long messages do not require
scrolling to their end. Unseen targets above, below, or outside loaded history
block advancing past their occurrence time; jumping past a message is not reading
it. Only Core unread targets can advance the watermark, never temporary Agent
progress, prefetching, or route entry. Background tabs cancel the pending dwell.
Each thread has its own monotonic read-through watermark, which advances only
while that exact thread is open and its message beginning passes the same dwell. Main
and thread watermarks make delayed projections of older already-viewed updates
arrive read while newer updates remain unread; one scope never clears another.
Core and Web reject implausible future read positions instead of letting a bad
client clock suppress later messages. Reading never resolves unfinished source
work.
Opening the exact Inbox item marks that item read and deep-links to its source
Signal in the same conversation.

Main-conversation unread navigation uses one chronological shortcut for updates
outside the viewport, combining targets above and below. It reveals the first
unread target and reports Core's complete unread count rather than the number
of targets that current viewport geometry happens to expose. Its blue **New
messages** divider is fixed at the first unread target observed for that Space
visit; passive visible-message reads do not move or regroup the divider.
Dismissing the shortcut hides the server-bounded unread batch without writing a
read watermark, so scrolling or resizing cannot resurrect that batch and a
later event can show a new shortcut. There is no per-message clicking
requirement.

The bottom history control remains the single return-to-latest action and does
not repeat unread counts. When the main conversation has unread targets, an
explicit activation first returns historical or scrolled views to the mounted
live tail, then advances only the main-conversation watermark through the
server-confirmed latest unread occurrence captured for that activation. It
works even when a short conversation is already at the bottom. New events after
the captured cutoff remain unread, and thread watermarks remain unchanged. A
newer history-navigation choice made while that cutoff is being prepared
abandons the activation before it can return to latest or write; its unused
cutoff is not retained as a retry.
Concurrent visible-message and explicit read-through writes are serialized and
coalesced within their main or exact-thread scope. A failed write keeps the
same cutoff for retry and reports that navigation succeeded but marking read
did not; there is no success toast.

For a thread target, the chronological shortcut opens that exact thread and
focuses its first unread target. The thread's blue **New messages** divider is
also fixed for that thread visit. A thread with recipient-specific unread
targets has a blue **Open thread** entry with an unread count; the count includes
replies and reactions, so it is not labeled as a count of new replies. Reading
the main root or its preview never acknowledges hidden thread replies. Thread
deep links from Inbox still open the exact thread.

This uses Slack's separation of conversation navigation, thread attention, and
read actions as a precedent, not an identical default: Slack offers immediate
mark-as-read on conversation entry and includes mentioned users in thread
notifications. OpenMeld preserves participant-only recipients and the visible
read-through contract above. References: [Slack read preferences](https://slack.com/help/articles/360043037853-Manage-your-Mark-as-Read-preference)
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
  default Mentions and replies policy; All new messages includes them. A visible
  tab suppresses delivery only for the conversation it is currently showing;
  a hidden tab can deliver any eligible item. Current-conversation suppression
  is temporary: leaving that conversation or hiding the tab re-evaluates the
  same unread item. The client records an item as delivered only after this tab
  creates the notification or another tab proves it already did; a permission,
  claim, or delivery failure remains retryable. A low-frequency browser-local
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
  forms a second unread store. After Web successfully creates a browser
  notification, it may play one browser-local OpenMeld sound. Ordinary
  directly addressed updates use the `ready` cue; urgent or open
  action-required items use the `chime` cue. Sounds default on for each member
  in each browser and can be turned off independently of browser permission.
  Web coalesces notifications observed within 350 milliseconds into one sound,
  with `chime` winning a mixed burst. The cue uses the fixed full app volume;
  there is no separate volume slider. Browser autoplay policy, missing audio
  support, or playback failure stays silent, never changes notification
  delivery truth, and never makes the Inbox item retry.
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
- Activating the launcher opens a responsive compact preview. The preview keeps
  source navigation and read-on-open behavior, shows **Needs action**, **Needs review**, and
  **Recent updates** together when both exist, and its maximize action opens the
  canonical full Inbox page.
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
