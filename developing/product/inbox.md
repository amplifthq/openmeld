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
can mark an item unread and can mark all accessible Inbox items read.
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

The compact preview uses the same summary breakdown. It separately queries
**Needs action**, **Needs review**, **Urgent updates**, and unread **Recent updates**, in that
order, without duplicating an item across groups. The `urgent_updates` list view
uses the same predicate as the urgent update count, so older urgent updates
cannot be displaced by a page of newer ordinary messages. The `recent_updates`
view independently selects unread items outside both attention groups so a
page of actions or urgent updates cannot starve ordinary updates either. The bounded preview
reserves room for each group; full Inbox remains the complete list. It may say
**All caught up** only when there are no unresolved actions and no unread items.

### Space message unread behavior

New Human-authored messages in conversations containing an ordinary personal
Agent also address that Agent's current owner, even without Human membership.
Self-authored messages do not generate this owner alert. Core validates current
personal ownership and excludes managed Agents and the designated Center Agent.
The owner receives one urgent `space_message` update per source message with
`sourceTarget.agentOwnerActivity: true`; overlapping member delivery is deduplicated.
This marker describes owner awareness, not an action request. It counts in the
existing Inbox urgent badge, but contributes only ordinary unread state to
Chats/Spaces navigation. Owner reads use the existing Space read watermark.
Current ownership and membership are rechecked on delivery and reads; alerts
never add Human membership or grant write access. No historical backfill occurs.
Browser delivery retains its permission/visible-conversation gates and groups
owner alerts by conversation and source minute. These awareness updates do not
generate urgent email.

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
only after the document is visible and the member has remained at the latest
main message for the normal read debounce. Scrolling up, switching tabs, or
arriving through a deep link without viewing the latest reply does not clear it.
Each thread has its own monotonic read-through watermark, which advances only
while that exact thread is open, visible, and held at its latest message. Main
and thread watermarks make delayed projections of older already-viewed updates
arrive read while newer updates remain unread; one scope never clears another.
Core and Web reject implausible future read positions instead of letting a bad
client clock suppress later messages. Reading never resolves unfinished source
work.
Opening the exact Inbox item marks that item read and deep-links to its source
Signal in the same conversation.

Main-conversation unread navigation uses one chronological shortcut for updates
outside the viewport, combining targets above and below. It reveals the first
unread target and dismisses that observed navigation batch after a successful
jump; dismissal does not write a read watermark. A new event can show the
shortcut again. The bottom history control returns to the latest messages and
does not repeat unread counts. There is no per-message clicking requirement.

For a thread target, this shortcut reveals and briefly highlights its root
message in the main conversation without opening the thread panel. A thread
with recipient-specific unread targets has a blue **Open thread** entry with
an unread count; the count includes replies and reactions, so it is not labeled
as a count of new replies. Explicitly opening that entry focuses its first
unread target. Reading the main root or its preview never acknowledges hidden
thread replies. Thread deep links from Inbox still open the exact thread.

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

The in-product Inbox is always available and cannot be disabled. Phase 1 has
two optional delivery channels:

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
  Space message updates stay in Inbox without a system notification. A visible
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
  exact Space message or thread, Agent interaction, Center Agent conversation
  Organization document, setting, or connected-channel message --
  instead of routing through Inbox. A failed
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
per-source rules, schedules, digests, quiet hours, snooze, Slack delivery, CLI
delivery, Web Push for a closed browser, Desktop delivery, or Mobile delivery.

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
  only through the visible-at-latest read-through contract.
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
