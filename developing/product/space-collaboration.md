# Space Collaboration

## Agent Context

- Purpose: Define how OpenMeld Spaces support collaboration between Humans and Agent
  Profiles, including the Space guide, Entry Brief, Board, membership, member
  directory, Wake, Reference, threads, replies, and visible outcomes.
- Read this when: You are changing Space membership, member directory,
  guide/Entry Brief/Board semantics, messaging, addressing, Wake authoring,
  thread placement, reply placement, final visible outcomes, or Space-facing
  product copy.
- Update this when: Space collaboration semantics, membership or member
  directory semantics, guide/Entry Brief/Board meaning, addressing relations,
  thread behavior, reply placement, Space action meaning, or final outcome
  rules change.
- Do not use this for: RuntimeCoordinator mechanics, dispatch claim details,
  local daemon lifecycle, database ownership, trace field design, React/Web
  implementation, endpoint details, or schema implementation.
- Source of truth: This file owns the durable product semantics of Space
  collaboration.

## Pinned messages and files

Active human Space members can pin retained chat messages from the message's
More actions menu. Pins are shared Space state. A pin references the original
message; it does not create a separate document or change its version history.
The Messages view shows one compact preview at a time, with the original author,
the person who pinned it, and a jump to the original message. The preview stays
on one line and truncates. Multiple pins use previous/next navigation without
stacking cards above the conversation.

Edit precedes Pin in the message menu. Successful message pinning offers an
Undo toast that removes that same pin. Already pinned messages have no pin
action in the menu; the pinned preview still supports removal.

Files have a separate pin action in the Files browser. Pinned files and messages
share one compact preview and previous/next navigation above the conversation.
Files appear first, followed by messages; selection follows the source identity.
Opening a pinned file uses the existing Files viewer. The pin follows the file's
identity and latest revision, including renames, rather than copying its content.
Trashed files are omitted. Pinning a message with attachments does not pin those
files, and unpinning a file never unpins its surrounding message.

When a pinned file receives a newer revision after it was pinned, its title shows
a compact `New updates` badge until the current reader opens that revision.
The badge uses a nested Fluid Surface (Surface 2). Read progress is scoped to
organization, profile, Space, and file in the current browser; it does not sync
between devices. Opening older history never moves the read revision backwards.
Failed content loads do not acknowledge a previewable file as read.

Only the original pinner can remove a pin, including through the API. The close
button dismisses the entire pin preview for the current reader. For the original
pinner it opens a Fluid menu with Dismiss and Unpin file/message; unpin affects
only the selected item and requires no confirmation. Dismissal is saved per
Organization, Human Profile, and Space in this browser. A Pinned action immediately
before Members restores the preview. New pins do not reopen a dismissed preview;
when no pins remain, both preview and recall action disappear.
Pinning an already pinned message does not transfer ownership. Pins whose source
message is no longer retained are omitted from the display. This is separate
from the broader shared-document and knowledge synchronization work in #851.

## Product Role

A Space is the shared cloud room where Humans and Agent Profiles collaborate.

It is where users write messages, share context, ask Agent Profiles to work, and
see the result of that work. In the product model, the Space is both the origin
of agent collaboration and the visible outcome surface.

A Space owns collaboration meaning:

- who participates in the room
- what messages are visible
- how a message addresses Humans or Agent Profiles
- where replies and thread messages belong
- what final outcome the user can see

An explicit request to coordinate with another member assigns work to the
addressed Agent. Delegating, contacting a teammate, checking progress, and
collecting results are contributions in their own right; the person performing
the underlying task does not make the coordinator merely a reference or candidate.

A Space member directory is a read projection of Space participation plus the
mention and addressing labels needed by clients and dispatch prompts. It helps
users and agents choose valid send targets; it does not create membership,
prove Wake readiness, or decide execution authority.

An unavailable Agent status read must not hide the authorized member directory
or other members' available status. Core keeps the affected Agent in the list
and uses its existing Wake Availability projection: an unverifiable status is
unavailable, while independently confirmed route evidence keeps its established
meaning. A failed read does not establish that the Agent is offline. Membership,
identity, and access verification retain their own failure behavior.

A focused Agent read may combine one resolved directory member with that
member's Core-owned current Agent Wake Availability projection. This avoids
returning the complete directory and unrelated runtime diagnostics when the
caller only needs one teammate's exact addressing and current preflight state.
The convenience read must preserve Core's readiness status and reason codes; it
must not reconstruct readiness from membership, Binding existence, or route
presence, and it does not prove that a later Wake will complete.

An ordinary Organization Space may add the Organization's currently designated
Center Agent through a dedicated server-authorized membership mutation. The
Organization directory candidate is presentation only: the mutation must fail
closed if the designation no longer matches the Agent Profile identity the user
selected. Once added, the Center Agent follows ordinary Agent Profile member
semantics for listing, addressing, Wake, removal, and degraded Direct Message
behavior. This does not create another Space kind or apply the locked Center
Agent Direct Message mutation rules to an ordinary Space.

## Space Tasks

Shared Spaces and private conversations, including Center Agent chats, may own
**Tasks** as durable collaboration commitments. Messages remains the default place to ask, discuss, and complete
small work. A Task records a clear deliverable that needs continuing ownership,
progress, review, or later closure. Tasks inherit the source conversation's
membership and visibility; private tasks do not become Organization-shared.

A Task preserves the trusted requester and creator, one optional assignee, one
optional independent reviewer, its source message and Thread, completion
conditions, an explicit set of zero or several Projects, linked GitHub and
Linear issue references, current result, current review, revision, and
append-only activity.
The active phases are **To do**, **In progress**, and **In review**. **Done**
means the declared completion boundary was met; **Canceled** means the accepted
commitment is no longer being pursued. Reopening is explicit. Assignment alone
does not start an Agent or claim that work is running.

The source Message or Thread remains the collaboration surface. The composer
offers **Create task** in its existing attachment/add menu. It opens an inline
draft with a title and optional assignee and reviewer. Closing the draft keeps
the message, mentions, and attachments. **Create task** publishes the message
and Task together; **Create and start** also activates the explicitly addressed
Wake targets. The message, Task, and dispatch outbox share one transaction.
Retries use the message identity and do not create another Task.

The Tasks view also offers **New task**, and the message menu can capture an
existing message. Ordinary message sending never infers Task creation. Agents
create Tasks through the existing Task API when explicitly requested.
Several Tasks may share one Thread, but a mutation must identify one exact Task.
Project association is a revision-checked Task scope change owned by the Space.
Existing Tasks remain unassociated until an authorized person or Agent makes an
explicit choice. A Task's Project list order never selects an external target;
one operation resolves its own relevant Project. Project association does not
change Space visibility, membership, Task permissions, or execution authority.

The composer has no global Task or Session mode selector. Each Agent mention
keeps its Wake/Mention only menu. For supported local controllers, Session and
Access & workspace appear directly below a divider. Each Wake target owns its
selection; one Agent's selection never applies to another Agent. No selection
is required to send a normal message. A Task is a work record, not an execution
session. Marking it In progress changes its phase; it does not launch an Agent.

Session selection support comes from the shared Agent Controller policy. Core
rejects explicit choices for unsupported controllers before publishing the
message, creating its Task, or enqueueing its Wake. CLI checks the same policy
before uploading message files. Omitted choices retain normal routing. Validated
material handoffs keep their separate contract: a hosted recipient uses its
existing Computer; accepting the handoff does not create a new cloud session.

Composer authoring adds optional `taskDraft` and `contextSelections` fields.
Task creation and the original message's dispatch commit together. Dispatch
context names the existing Task, assignee, and reviewer so Agents can update it
without creating another record. This adds no separate message or Wake.
The latter is keyed by explicitly activated Agent profile IDs and cannot be
combined with the legacy shared `contextSelection`. Core resolves one selection
for each dispatch; downstream controller contracts stay unchanged. Public
message read projections omit these authoring controls for existing strict
readers. New cloud accepts old writers; old cloud rejects the new fields.
Deploy the cloud changes before the new Web client. No local component update
or database migration is required.

The requester, assignee, reviewer, and Space owner have action-specific
permissions. The assignee starts work and submits results. With no reviewer,
submission completes the Task against its stated conditions. With a reviewer,
submission enters review. Accepted review completes the Task; requested changes
return it to the assignee. Agent-to-Agent handoffs use normal Space Wake
admission and stop after two automatic rework rounds, then require a human
requester or Space owner to authorize more work. Task state never substitutes
for RuntimeCoordinator or native-delivery execution truth.
An explicit Task delegation assigns the existing Task and records its reviewer
with the initial Wake intent in one Space transaction. Ordinary assignment still
does not Wake anyone. Creating and delegating a new Task can commit its brief,
assignee, explicit reviewer decision, and initial Wake intent together. A failed
transaction creates neither the Task nor its handoff; retrying the identical
operation returns the original receipt. The requester/owner permission check and
live member and reviewer checks apply before that transaction. Native Agent tools
use this operation when new delegated work should start now, and reuse an existing
Task when one already represents the request. Delegation remains **To do** until its assignee explicitly
starts it; a queued or failed handoff is shown separately. Generic Wake,
ordinary replies, and execution completion never advance the Task. Every
initial, review, and rework handoff carries the same Task identity and its
current brief in the Agent dispatch context.
When the Center Agent arranges a Task for its verified current human requester,
Core rechecks the live delivery, Binding, and requester access. The requester
must still be an active member of this Space and the Task's requester. This
permits creation with an initial handoff, assignment, brief updates, and reviewer selection; it does not
permit the Center Agent to start, submit, or accept another Agent's work.
A requested reviewer must be an active Space member before delegation succeeds.
An unavailable reviewer is a blocker, not an implicit choice of no review.
Reviews name the exact submitted result revision the reviewer saw. A concurrent
result or Task change requires a fresh decision; clients do not replay an old
acceptance against a refreshed revision. A human Space owner can take over an
Agent-requested Task decision, and approving further rework hands the next
correction to the assignee through the same Space Wake path.

A submitted result awaiting a Human reviewer creates a separate pending Inbox
request, in addition to its public handoff message. At the automatic-rework limit,
the existing Human decision target receives the request instead. Task mutations
persist Inbox projection intent in the existing delivery outbox; retries use the
current Task state and close superseded requests. Reading the handoff, marking
the Space read, replying normally or dismissing Inbox attention never approves
the result. Agent reviewers retain their existing Wake path without treating
their personal owners as substitute reviewers.

Task transition messages are idempotent and return to the source Thread when
one exists. They mention a human reviewer through normal Inbox delivery or
Wake an Agent reviewer through the existing Space path. Completion posts the
result back to the original request. Canceling fences later Task mutations and
requests an authorized Stop for a linked active Agent Wake; an unavailable or
failed Stop does not undo the Task cancellation or claim that execution ended.
The Task detail shows the source message, latest review feedback, activity, and
pending or failed delivery actions. Space persists handoff, completion, and
linked-issue sync intents with Task transitions and retries them through its
background alarm. Task cancellation targets recorded Wake references from its
source and later handoffs, with exact Stop authorization and visible failures.

GitHub issues filed from a shared Space through OpenMeld's GitHub tools are
associated with a Space Task when the Task list can confirm whether that issue
is already linked. The issue body receives an OpenMeld Task
reference, and the Task stores the repository and issue number. Closing that
issue through those same GitHub tools, or through a verified GitHub App
webhook after the issue is already linked, updates the external issue observation.
Provider closure, including Completed, Not planned, or Duplicate, never submits
a result, accepts review, completes, or cancels the Task. Moving work to another
issue is not proof that its requested outcome has been delivered. The assignee
submits the verified outcome through the Task workflow; its reviewer accepts
that exact result when review is required. A requester or other authorized
member cancels work explicitly. Reopening the issue refreshes the observation
and does not reopen a completed or canceled Task.
Closing or completing a Task does not silently patch GitHub; the Task result
prompts the Agent or person to close the linked issue when it is still open.
This is authorized association for already-linked issues, not an import of
every GitHub issue and not Task creation from GitHub events. A confirmed Linear
issue creation can attach an exact typed reference to one eligible source Task.
The Linear reference keeps its issue UUID, display identifier, team scope,
optional provider project, and URL. Failure to attach after creation is a
partial outcome; recovery adds only the Task reference. Linear references do
not claim status monitoring, close synchronization, or automatic follow-up.
Webhook deliveries grant no new execution authority and do not start Agent
work or review. Member-authorized Task handoffs retain their normal permission
checks and Wake behavior. Creating or linking an issue records who created the
Task, but leaves its assignee empty until an executor is explicitly selected;
the Center Agent is not an implicit implementation owner.

Project Common Agents are selection suggestions in a Task assignment flow.
When one is outside the Space and belongs to the caller, **Add and assign**
discloses that the Agent and its owner will join the Space, applies the
existing atomic membership operation first, then makes the revision-checked
Task assignment. When it belongs to another member, the add becomes the owner
request described in Agent Owner Participation; nothing joins and the Task is
not assigned to that Agent until the owner lets it join. A membership success
followed by assignment failure is shown as a partial outcome; it is never
silently rolled back or described as successful assignment. Assignment alone
does not start an execution.

## Editing and Recalling Messages

An active Human member can edit or recall their own sent messages, without a
time limit. This does not grant permission to change another Human's messages,
Agent replies, or system notices.

Editing replaces the message in its original position, preserving its identity,
timestamp, reply links, and thread. Show `(edited)` only when content changes.
The editor lives directly in the existing bubble and preserves the bottom
composer draft. Existing message attachments can be kept or removed. Removing
all text while keeping attachments remains a valid message; removing all
content asks for recall confirmation.

Recall replaces the original row with a small system-style notice naming the
sender. Original text and attachments are absent from the public message and
quoted previews, while existing threads remain accessible. Recall is not file
deletion: independently stored Space Files retain their own lifecycle.

Only the sender can choose **Edit again** to recover the last successfully saved
version into the appropriate composer. This creates a draft, never an automatic
send or resurrection of the old message. Protect an existing draft with a
replacement confirmation and do not overwrite text entered while recovery is
loading. The draft retains its source message identity across refreshes and
failed sends. Only successful publication consumes recovery: keep the divider
notice, remove **Edit again**, and release the private recovery snapshot in the
same transaction as the new message. Sending unrelated identical text does not
consume recovery. Recovery otherwise lasts as long as the underlying message is
retained; this is not a browsable edit-history feature.

Editing and recall update the initiating client's view optimistically. A failed
write restores the authoritative message and preserves the edit for retry.
Concurrent stale edits must not overwrite a newer version. Existing Wake and
mention delivery remain historical actions: editing does not issue another Wake
or notification, and recall does not stop already-running work. Agents reading
current conversation context must detect message changes before publishing a
reply based on an obsolete observation.

## Email Invitations Into A Space

An Organization owner or admin who is an active member of an ordinary team
Space can invite a person by email from **Add People or Agents > Invite**.
Personal Organizations and unconverted Direct Messages do not support this
action. Existing directory additions remain a separate, immediate operation.

Ordinary Space members can submit an email invitation request or share an
approval-required link from the same dialog. Core records the Space sponsor;
an Organization owner/admin reviews Organization entry without needing to join
the private Space. Approval and acceptance recheck the sponsor's current Space
and Organization membership. This is one Organization invitation-request flow,
not a separate Space approval engine. Only direct invitation management requires
the Organization invitation-create permission.

An invitation is bound to one verified account email and one Space. Opening
the link never accepts it. The recipient reviews the sender, Organization,
Space, and ordinary Organization-member role, then explicitly accepts. Login
and verification preserve the destination; successful acceptance uses shared
Space entry. Wrong-account, expired, revoked, and unavailable invitations fail
visibly. Organization invitations and targeted guest invitations have explicit
audiences; neither is a computer connection request.

A Space owner may enable external guest invitations after confirming the
history, files, messages, and Agent exposure. This does not publish the Space
to the internet. Guest invitations require the intended verified account but
never create Organization membership. Guests use the existing conversation
and cannot open Organization directories or manage the Space. Disabling guest
access blocks existing external guests and closes their live connections;
re-enabling it restores their existing memberships. Removing a guest from the
Space remains effective until a new invitation is accepted or the person
explicitly rejoins under a currently enabled link-join policy. Link self-join
admits only the caller's verified Human Profile as a Space Guest, never an
Organization member; it requires guest access to be enabled separately.
When an owner submits the first guest invitation while guest access is off,
Share confirms the exposure once, enables guest access, and continues that
same invitation. It does not make the owner enable a duplicate setting before
inviting the guest.

Discover includes Organization-open Spaces and the signed-in recipient's
pending invitations, labeled **Invited**. A private invitation exposes its
invitation summary, not its discussion history, before acceptance.

Better Auth remains the Organization invitation and membership writer. Core
owns the Space invitation intent and policy; the Space owns the membership
grant and an atomic accepted-or-revoked receipt. PostgreSQL status projects that receipt.
Acceptance can retry after Organization joining or an acknowledgement failure;
it cannot use an old accepted invitation to re-add a removed Space member.
Acceptance rechecks the sender's current authority. Revoke never removes an
already accepted membership. It cancels an unused native Organization invite
only when this workflow created it and no other live Space invite needs it.

Pending invites stay separate from members. Senders can resend or revoke them;
the initial expiry matches Better Auth's 48-hour invitation lifetime. A recipient
can find pending invitations at account-level `/invitations`, without already
belonging to the Organization. This is not Organization Inbox membership.
Web and CLI use the same authenticated `POST /api/auth/space-invitations`
contract in `packages/schemas`; clients do not derive authorization from UI.

## Agent Owner Participation

The Add People or Agents picker shows the effective membership selection:
selecting one of the caller's own ordinary Agents also checks the caller.
Selecting another member's Agent does not add it; it submits the access request
described below. The count and checkmarks
agree before submission. Deselecting the last Agent removes an implicitly
selected owner; an explicitly selected owner remains selected. Deselecting an
owner also clears their selected Agents. Search filtering must not erase the
effective selection. Core still resolves the authoritative owner at mutation
time; these checkmarks are not permission facts.

An ordinary human-owned Agent Profile participates in an ordinary Space with
its owner. When the owner adds their own Agent, Core resolves the Agent's current
authoritative `ownerUserId` and that Organization member's active default Human
Profile, then submits the Agent and Human through one atomic Space membership
mutation. A cached owner name or caller-supplied Human Profile is never enough.
If the owner is already an active member, the Human addition is an idempotent
no-op. If Core cannot resolve the current owner and Human Profile, the whole add
fails instead of admitting an ownerless ordinary Agent.

When anyone other than the owner mentions or adds another member's Agent in a
Space that Agent is not in, the Agent is not added and not woken. Core instead
creates a request bound to the exact message id (or the add operation), stored
on the MemberAgent; editing or deleting that message voids the request and its
author sees that it was voided. The mention chip shows "Requested <owner>". In
the @ picker these Agents are grouped under "<owner>'s Agents · not in this
Space". A colleague's Agent is left out only when its profile id is already a
member; a shared name or Harness never hides it. Choosing one inserts the
owner-qualified name (`@Tali's Codex`) so it never reads as a member's
mention. Each row shows the Agent's shared Wake availability; an unavailable
Agent shows that label (for example "Unavailable") instead of "Asks <owner>"
and can still be chosen, because choosing it only asks the owner. The
owner receives an `agent_space_request` Inbox item and becomes a read-only
observer of that Space, then chooses **Add to Space** or **Don't add**.
**Message <requester>** opens the owner's Direct Message with the requester and
leaves the request pending: talking is not an answer. Only Add to Space, Don't
add, or the requester withdrawing closes the request. Requests closed by the
retired Reply by DM decision keep their `replied_by_dm` status. Adding the Agent adds its default Profile (or the mentioned
Profile) and dispatches the original message with the request chain
`[requester, Agent]`; the owner remains an observer rather than becoming a
member. Invitations and organization self-join never add another owner's
Agent.

Managed Agents, including the designated Center Agent, do not inherit this
rule. Their Organization-managed identity and existing specialized membership
contracts remain authoritative.

In an ordinary Space where the owner joined with their Agent, the resolved
owner is an ordinary active Human member with the same collaboration rights as
other members. Such an owner cannot leave or be removed while one of their
ordinary Agent Profiles remains active in that Space; remove the Agent first.
An owner who is only an observer is not a member, so this rule does not apply
to them. Removing the Agent never silently removes its
owner. This order keeps both actions explicit and prevents a membership cleanup
from unexpectedly removing a person.

Existing ordinary Spaces reconcile this invariant once inside the owning Space
when a current member/status snapshot is first read after the policy ships. The
Space checks each unmatched Agent against canonical Organization identity,
adds only missing ordinary-Agent owners, then records a local completion
marker. An unavailable owner identity leaves the marker unset so a later read
can retry. This compatibility step never adds the owner of an Agent that joined
through an approved request. This bounded compatibility step updates the Space member projection
and live membership invalidation only; it does not rebuild unread state, replay
history, or emit historical new-member notifications.

A current one-Human/one-Agent Direct Message is the deliberate exception. The
ordinary Agent owner's Human Profile is a derived read-only observer, not a
third persisted member. Both DM participants see that the named owner can view
the conversation. The observer may read the shared conversation and advance
their own read position, but generic collaboration writes remain unavailable:
the observer cannot publish messages, create or reply to threads, write Space
Files, add or remove members, or change Space metadata, lifecycle, publication,
visibility, access, or password settings.

The same derived read-only observer applies to an ordinary Space that contains
an Agent the person owns, or a pending request for one, while that person is
not an active member. It has the same write limits as a DM observer.

The observer may explicitly choose **Join conversation**. Core accepts only the
owner's exact active default Human Profile and uses the existing irreversible
Direct Message conversion transaction to add that Profile, set
`directMessage.convertedAt`, and turn the conversation into an ordinary Space.
After conversion, the owner is a normal member and may participate. This
observer and join behavior must not appear or succeed for Human-to-Human DMs,
Center Agent DMs, managed Agents, a different Agent owner, anonymous viewers,
or ordinary Spaces where the owner is already represented by an active Human
member. **Join conversation** applies only to Direct Messages; an
ordinary-Space observer reads but has no conversion action.

A Space does not own local execution readiness or in-flight execution truth.
Those are transport concerns. The Space owns what the user said, who it was
addressed to, where the conversation belongs, and what became visible.

When a verified user explicitly chooses a new or dedicated Space as the work
surface, that choice is binding even when the requested work is short. The
Center Agent creates the Space before starting the work and does not silently
substitute the current conversation, a Task, or a plain reply. This same rule
applies through Web, OpenMeld Spaces, Slack, the OpenMeld CLI, and every other
contracted Message Channel. A newly created Space remains private and
members-only unless the requester explicitly asks for broader access.

### Colleague use of an Agent

Implementation status: MemberAgent program, PR #236, shipped.

Every Wake has exactly one human root requester (see
`developing/architecture/agent-transport-contract.md`, Request Chain). In a
group Space where an Agent Profile is already a member, any member may mention
it without asking the owner; an identified external root requester still needs
the owner's consent every time.

A colleague's first Direct Message to another member's Agent Profile creates
the DM Space in `pending_owner_consent`. The colleague's message is stored, not
dispatched, and shows "Waiting for <owner>". The owner receives an urgent
`agent_access_request` Inbox item and email with **Allow once**, **Always allow
<colleague> for this Profile**, and **Decline**; identified external users get
only **Allow once** and **Decline**. Approval always starts a new Session for
the colleague. Grants are recorded per `(grantee, Profile)` with
`granteeKind` `member` or `external` and are revocable; revoking blocks new
tasks while running ones finish. A colleague's Agents inherit that colleague's
grant. The owner is a read-only observer of the DM and may Join, which converts
it as described above. Anonymous visitors are rejected at the entrance.
No Wake and no membership exist before consent.

The grant list of a Profile is owner-only. A member reads only their own
standing grants through `GET /v1/organizations/current/agent-access-grants/mine`:
unrevoked `always` grants in the active Organization, on active Agent Profiles
only. Clients use it to show "You can use" or "Asks <owner>" on a colleague's
Agent, and to label the primary action **Ask to use** when the owner answers
first. It never shows another member's grants. When a colleague's Agent cannot
start work, clients show only the closed public reason set
(`publicWakeabilityReason`), worded neutrally with no fix steps, and disable
chat while the Agent is unavailable. An offline Agent keeps chat, because the
message waits for its computer.

A request keeps the owner's answer apart from what is true now. Its
`decision` (`allow_once`, `always_allow`, `decline`, `join`, or `ignore`) is
written once with the answer and never changes; it is null while the request
is pending and when it closed without an answer (withdrawn, or void before
one). Its `status` is where the request is now. The grant it wrote keeps its
own lifecycle, and the request view carries that grant as it is now:
`grant.status` `active` or `revoked`, with `revokedAt`. The requester's state
is derived from these facts in one shared place: an active standing grant
means always allowed; otherwise the latest Direct Message request decides. A
pending request is waiting, a decline is declined, and an allowed request
whose grant is active is always allowed or allowed for that chat by its
decision. An allowed request whose grant was revoked is `revoked` (shown as
**Access removed**), and the requester asks again from their next message. An
`allow_once` covers only the request's own DM; a new DM starts unsent.

The owner can turn a member's access into a standing grant later, for example
after **Allow once**, with owner-only
`POST /v1/agent-profiles/:agentProfileId/access-grants` and body
`{ granteeUserId, scope: "always" }`. It writes a new `always` grant with its
own lifecycle and retires the member's active one-chat grants for that
Profile, so removing the standing grant later removes access in every chat,
including the original DM. It never rewrites the decision of the request that
led to it.
External users are refused, and an active standing grant is returned as it
is. Writing or revoking a grant broadcasts `space.agent_access.changed` to the
Spaces where that person asked for the Agent, so open views refetch.

#### Agent access list

Requesters and owners see one shared list of access entries. An access entry
is one person's right to use an Agent Profile they do not own. It names the
Agent Profile and its owner, the person, one rule, and the Spaces it concerns.
The rules are:

- **Always allowed**: an `always` grant; it covers every chat with that
  Profile.
- **This chat only**: an `allow_once` decision; it covers that request's DM.
- **Waiting for <owner>** (the requester) or **Waiting for you** (the owner):
  a pending request.
- **Declined**: the owner declined the latest request.
- **Access removed**: the owner removed access after allowing it.
- **In this Space**: the Agent is a member of a group Space, so its members
  may mention it.

Every row has the same layout: avatar, name (with the Agent's name when the
list mixes Agents), a secondary line with the rule and, for a decided row, a
relative time, and one control on the right. What the control does depends
on the viewer, never on the surface:

- The owner manages decided rows from a compact menu under the current rule.
  The only change of rule is an upgrade: a member on **This chat only** can
  be moved to **Always allow <name>**, which retires their one-chat grants.
  There is no way back to **This chat only**; the owner chooses **Remove
  access**, which revokes every active grant the person holds for that
  Profile, and the person asks again. Removing an `always` grant asks for one
  confirmation, because it applies to every chat with that Agent. Pending
  rows are answered inline with **Allow once**, **Always allow**, and
  **Decline**. External requesters never get **Always**.
- The requester sees plain state text on their own row, with **Withdraw**
  while it waits and **Ask again** after a decline or removal.
- Everyone else reads the row.

The list is built only from the existing Core projections: access requests,
the owner's `GET /v1/agent-profiles/:agentProfileId/access-grants`, and the
requester's `GET /v1/organizations/current/agent-access-grants/mine` through
the shared requester-state derivation. It holds no state of its own.

Access is managed in the Space. The Space Members panel shows an **Agent
access** section when it has rows: in a DM, the requester's entry for the DM's
Agent; in a group Space, the Agents in it that other people own and pending
requests to add an Agent. The link
`?panel=members&section=agent-access&highlight=<entryId>` opens the panel,
scrolls to the row, and briefly highlights it. Other surfaces, such as the
Space header's access state, open the section with the same link.

The Agent detail page shows the same rows read-only. The owner sees one row
per person with the Spaces where the rule applies, each linking to **Manage in
<Space>**, followed by a collapsed **Recent changes** log. A teammate viewing
someone else's Agent sees one **Your access** row and links to their chats
with it. Both views refetch on the Space's Agent access change broadcast.

## Space Identity

The Space name is Space-owned identity. It is the same canonical value used in
the Space header, Space lists, history, references, and shared projections; a
client must not keep a second browser-owned display name.

An ordinary Space may be renamed by its creator profile. When an Agent Profile
created the Space on behalf of a user, the owning Human Profile may rename it.
Missing or mismatched creator ownership must fail closed. A valid name is
trimmed, non-empty, and no longer than 80 characters.

Renaming changes only the Space identity. It does not change membership,
access, Direct Message origin, Wake readiness, execution truth, or message
history. Center Agent Direct Messages keep their specialized immutable metadata
contract: clients hide the rename surface and Core rejects the mutation.

## Space Guide, Entry Brief, And Board

A Space guide is durable, steward-maintained collaboration context. It may
describe the room's purpose, stable working rules, safety boundaries, handoff
expectations, or links to canonical decisions. It is not the current task, live
execution state, a private scratchpad, or a place for secrets.

When the Center Agent creates a Space, one-time checklists, tasks, status
updates, notes, and other conversation content belong in a Space message, not
the guide. The completion reply must describe the content's actual destination
so opening the Space never makes the requester think that completed work is
missing.

The Space Entry Brief is the compact shared prompt projection for a newly
Woken Agent Profile. It identifies what the Space is, who the Agent Profile is
in that Space, the current Space identity and guide when present, and the
read-only command for more context. The current Entry Brief does not carry a
second per-profile `roleInstructions` channel; durable room rules belong in the
Space guide, while the activating message remains the task source.

The hosted Center Agent follows the same room-rule source. For every ordinary
Space Wake, including a Wake in an ordinary Direct Message Space, and Routine
execution whose frozen destination is an OpenMeld Space, Core reads the current
guide from the Space Durable Object and places the optional projection in that
turn's Remote Agent envelope. Center Agent DMs, Slack conversations, and
Slack-destination Routines do not receive a Space guide. This is a per-turn read
projection, not cached conversation state.

Every Agent prompt introduces the guide with one shared heading
(`SPACE_GUIDE_PROMPT_HEADING` in `@openmeld/space-mesh`) that tells the Agent
to follow it for all work in the Space, with OpenMeld rules and safety
boundaries taking precedence.

In Web, an ordinary Space shows the guide in a Guide tab after Files. Every
member can read it; Space owners can edit and save it there, and Core still
authorizes the write. The guide accepts up to `MAX_TEXT_LENGTH` (100,000)
characters, the same cap as other Space text. Web does not show a running
count and reports the cap only when an edit exceeds it. An unsaved edit
survives switching Space tabs, and the tab rereads the guide each time it
opens. Center Agent DMs do not show the tab; the public Space page shows the
guide read-only under Space context.

The Space Board is a read-only, room-scoped summary for collaborators and
agents. It composes:

- Space identity, purpose, and guide from Space-owned truth
- member counts and Center Agent presence from the Space member projection
- current work and recent outcomes from a RuntimeCoordinator-written query
  projection

The Board does not create membership, prove Agent Profile readiness, decide
execution authority, or replace Space history and Wake diagnostics. `Working
now` may be shown only from a current RuntimeCoordinator projection with
explicit freshness; a durable `running` row by itself is insufficient. Missing,
stale, or unavailable execution evidence must stay visible instead of being
presented as live work.

Wake progress may expose a bounded public source context so Human View, Agent
View, and the Center Agent can identify the requester's Profile, kind, display
name, sanitized source-message preview, and thread. Space supplies those facts
at read time; execution owners continue to supply lifecycle and freshness. This
projection does not expose or retain private agent context. Local Agent reasoning
uses the separate transient stream described below, not this read model.

Local Agent thinking and reasoning streaming is enabled by default. The Human
account owner can disable it in Settings > Privacy & Safety for all of their
local Agents across Organizations. Only thinking or reasoning text actually
emitted through the provider's official integration is eligible; this does not
authorize extracting hidden model state or streaming the private final answer.
The setting explains that people with access to the Space can see live output.
OpenClaw is excluded.

The existing working title, elapsed time, and Stop control remain available.
Agent work stays above the answer in both the main conversation and Threads,
from live output through the settled reply. The shared bounded viewport opens
for live work and lets the reader pause following by scrolling up. It collapses
after a successful final reply and remains available for manual inspection.
Hosted Center and Remote Agents, and supported Local Agent controllers, can show
explicitly authored public updates alongside automatic tool steps. These
updates explain meaningful phases; they are not a continuous activity signal,
a Space message, or a final reply. Exact Local Agent retries are idempotent and
do not resume a parent task. Provider thinking stays private.
Disabled local streaming is explicitly
attributed to the Agent owner; an unsupported connection is distinguished from
waiting for a provider that has not emitted reasoning. Absence of reasoning is
never evidence that a running Agent is stuck.

Local Agent reasoning is ephemeral. It is not a Space message, Work summary, Agent Activity,
search input, notification, export, transcript, execution journal, or diagnostic
body. OpenMeld retains no reasoning text in storage or browser persistence.
The mounted conversation retains already received live work across transport
reconnection so a brief interruption does not collapse the reader's work view.
This is in-memory presentation only, not evidence of continued execution or a
durable transcript. Navigation, profile changes, access revocation, an observed
privacy-disable frame, and terminal outcomes clear the tail. During lost
connectivity, privacy and outcome updates take effect when received; the existing
stale-updates notice covers prolonged interruptions. Provider-owned local session
retention is outside this OpenMeld promise.

An ambient `Working` indicator identifies current Wake activity in that Space,
not the author of an older reply or a historical **Work summary**. When Core has
target attribution, a detail surface may name the Agent Profile that is
working, for example `Clico Codex is working`; multiple active targets use an
honest aggregate. The compact Space sidebar keeps its existing orb-only visual
state and exposes that attribution from the orb tooltip instead of adding names
to the row. Space keeps the frozen membership display name for this read model
even after deletion removes the active member, because an accepted Wake may
still be stopping. Clients must never expose a raw Profile id as the Agent name.
If attribution is unavailable during a mixed-version rollout, the compatible
fallback is `An agent is working`, not a guessed participant.

## Space Files

### Image previews

Selecting and sending an image preserves the same original through pending,
failed/retried, and accepted message presentation. Publication or message
acknowledgement does not itself close an open viewer, replace a usable image
with a skeleton, or fetch a second copy. Filenames are labels, not identity:
two selected files with the same name remain distinct.

Loading, ready, and error states occupy the same frame. Known dimensions reserve
the displayed aspect ratio; older or unsupported images use a stable fallback.
A long screenshot remains fully visible within a multi-image cell, and the
focused viewer uses original bytes. A genuinely cold image has a loading effect
only while active; reduced-motion and unavailable graphics have a static
placeholder. Errors expose a retry action rather than perpetual loading.
Current access checks still apply, and access revocation removes cached private
pixels even from an already open preview.

### Video previews

Human and Agent video files share one renderer in conversations and Files.
Users can play in place or expand through Morphing Dialog, continuing from the
current position. Closing or leaving the active surface stops sound. New messages
never start playback automatically. Message references retain exact revisions.

Idle videos show a first frame through native lazy media loading near the
viewport, without downloading every video in a conversation. Local selections
can be previewed before sending and retain
their original through publication. Codec support depends on the client;
unsupported media retains retry and download. This adds no transcoding,
external-provider embedding, or video attachment namespace. Existing file-size
limits and access policy still apply.

### Selected work handoffs

Message details offers **Hand off** to ask another Agent to continue work from
a readable result. The default is a brief with optional shared files; it needs
no Project, repository, or commit. **Include a repository** adds an explicit
Project/repository and complete published commit SHA. The sender selects an
existing Agent in the Space that supports the selected materials. The brief includes the goal, current state,
verified evidence, attempted approaches, decisions, constraints, open questions,
next steps, and completion criteria. The original shared result is loaded into
the draft; private native history is never an input. Shared files are optional,
explicitly selected, and pinned to exact revisions.

These handoffs use the same ordinary Message/Thread publication and Wake owners
as selected-file work. The accepted manifest binds the source message revision,
receiver, selected materials, and execution choices. A changed or recalled source,
changed retry payload, or different destination thread is rejected. An unknown
send outcome retains the same request identity for retry. The UI says requested
until existing execution/publication owners produce the actual outcome.

Without a repository, workstation handoffs select a new isolated Space-only
Context and never resolve a default Project or borrow a local repository.
Brief-only work supports Codex, Claude Code, and Remote Agents. Selected shared
files without a repository support Codex App Server and Remote Agents; Claude's
Space-only boundary has no writable selected-file projection. These material
support rules are projected by `packages/agent-runtime`; live readiness and
execution permissions remain their existing owners' checks.

With a repository, the receiving Service resolves its own authorized Project
connection and prepares the frozen commit before model work. This supports
local Codex and Claude Code. The Web action selects a separate copy;
Agent settings remain the default, with supported explicit restrictions available.
It never transfers a sender-local path, credentials, native conversation, or
approval. Selected shared files live in a separate child directory and code work
keeps the repository working directory. Workstation v2 handoffs require Context
capability 5; selected-file preparation additionally requires the existing macOS
handoff capability. Remote Agents retain their existing native admission, file
preparation, and reply owners and reject repository handoffs. Version 1 file-only
handoffs retain their existing Codex Space-only boundary described below.

A selected work handoff is an ordinary Space Message or Thread reply with one
Wake target, exact file revisions, optional immutable Organization Skill
releases, a goal, completed work, next steps, and requirements. The containing
message owns its origin and result placement. The manifest cannot choose a
different author, source Space, account, or reply destination. Reusing a message
identity with different work fails; posting successfully does not mean the Wake
started or succeeded.

The first slice supports up to ten files, each at most 10 MiB, with safe unique
relative paths. The recipient prepares the complete selected set before starting
execution. Missing files or Skills fail explicitly; neither current revisions
nor latest Skill releases silently replace the selection. Files remain owned by
the Space, and ordinary Space membership and Wake admission still apply.

Version 1 file-only handoffs let hosted Agents use their existing Computer
identity. Their workstation continuation
requires the macOS Codex App Server Space-only execution boundary. Other
controllers/platforms are not advertised as supporting this handoff. This is
not a user-owned private Computer, cross-device process migration, background
file synchronization, or generic Git repository transfer.

Saving an existing file creates a revision through its existing writer and
expected base, retaining its file ID. Saving and selecting final reply
attachments are separate actions. Conflicts preserve local work. The final
reply references explicitly selected acknowledged revisions in the originating
conversation, using the existing execution/finalization owner.

### Shared file ownership

Space Files are the shared working files of one Space. Humans, the hosted Center
Agent, and authorized workstation Agents use the same Space-owned file contract;
none receives a private or privileged copy of the file tree.

A Space File has one stable id, one current name and folder placement, and an
ordered history of immutable content revisions. Renaming or moving a file does
not change its id. Every content write names the current revision it started
from. Space atomically rejects a stale base revision with an explicit conflict,
preserves both collaborators' work, and requires the writer to read the current
revision before trying again. This is the MVP multi-player safety boundary. It
does not claim character-by-character live co-editing or CRDT semantics.

A new file upload never fails merely because another active file in the target
folder has the same case-insensitive name. The owning Space atomically assigns
the first available presentation name such as `Report (2).pdf`, preserves the
requested extension, and returns that canonical name to every client. This is
the same server-owned behavior for Composer, Files, CLI, and Agent uploads.
If a pathological name leaves no room for one stem character plus the numbered
suffix while preserving the complete extension inside the shared name limit,
Core fails explicitly instead of silently truncating or changing that
extension.
Creating a folder also keeps both items with the next available numbered name,
as specified by the shared Files contract. Explicit rename, move, and Trash
restore return a name conflict when their requested destination is occupied.

Space access owns file access. A viewer who may read the Space may list active
folders, read active metadata, and download active files. Trash is visible only
to active human or Agent Profile members because deleted names and attribution
are collaboration history, not public Space content. Only an active member may
create a folder, upload a file, create a new revision, rename or move an entry,
move an entry to Trash, or restore it. Folder placement grants no additional
permission and there is no per-file ACL in the MVP. Agent writes use an
authenticated active Agent Profile member or an authorized continuation of that
member's accepted execution; a Center Agent designation is not an access
bypass.

Space File metadata, hierarchy, revision order, optimistic concurrency, actor
attribution, and Trash state are canonical in that Space's Durable Object
SQLite database. Immutable revision bytes use the private Space file object
store. An object key is storage addressing only; it is not file identity or
authorization. A failed byte write never creates a visible revision, and a
failed metadata commit cleans up the unreferenced object best-effort while
reporting cleanup failure for operations.

The immutable revision is the exact uploaded original. Display previews and
model-input derivatives are separate bounded representations derived from that
revision; they never replace the original, become a new revision, or change the
file's identity. A derivative can be discarded and rebuilt from the authorized
revision. Raw file bytes and base64 encodings never become durable conversation
history merely because a message references that file.

Organization Documents, Space Files, legacy message Attachments, and the Center
Agent Computer remain separate owners:

- Organization Documents are approved Organization-scoped Markdown context.
- Space Files are the ordinary shared filesystem for one collaboration room.
- New chat uploads are Space Files. A message references the exact immutable
  revision that was sent; it does not create a second attachment object.
- Legacy Attachments remain readable for existing messages only. The MVP does
  not migrate them into Files or use that legacy write path for new Web/CLI
  uploads.
- the Center Agent Computer is its private durable working environment.

Every Space File records one canonical **origin**: **artifact** (created in
Files, uploaded through the Files upload control or CLI `space files upload`,
or written by an Agent) or **chat upload** (sent as a message attachment
through the Composer or CLI `space send --file`). Origin is set once at file
creation and never changes on a later revision, an update, a trash, or a
restore. The Files list defaults to artifacts only so chat screenshots and
pasted images do not bury deliberate work; a **Show chat uploads** toggle
(`origin=all`, CLI `--all`) reveals chat uploads without leaving Files, and
toggling it off — or switching to Trash, which resets the toggle — returns
to the default. Folders are structural, never carry an origin, and are always
shown regardless of this filter.

A caller (old CLI, old Web build, or any request written before this field
existed) that omits `origin` when creating a file gets **artifact**, matching
the create behavior this feature preceded; the shared HTTP contract keeps
`origin` optional on requests specifically so no client is required to send
it before a service can roll safely. Reading responses is negotiated, not a
bare additive field: a caller must explicitly declare it understands
`origin` (a request header for Web/CLI, an explicit RPC field for Center
Agent tools) before any response includes it; a caller that predates this
distinction and never declares the capability keeps receiving the exact
pre-origin response shape indefinitely, so it is never forced to update —
see the Space Files Origin Classification Contract Impact Audit in
`developing/engineering/development-workflow.md` for the exact negotiation
mechanism and supported matrix. A pre-existing file created before this
distinction existed was migrated to **artifact** in the same schema step
that added the column, since there is no reliable signal in that historical
data to recover a chat upload from deliberately created work. After that
migration, a file with no recorded origin is exceptional/corrupt data, not
normal history, and the read path still fails closed on it exactly like a
chat upload: it stays out of the default artifacts view until an explicit
`origin=all` read asks for it, and the Web badge never claims it is a known
chat upload. This is strictly a list-time presentation filter; it does not
trash, delete, or move chat uploads, and every chat upload remains reachable
there. The Move-to-folder destination picker also reads with `origin=all`
for the same presentation-only reason — folders are exempt from this filter
regardless — and that read is never an authorization or visibility decision;
who may move a file into a folder stays owned by the ordinary per-request
access checks.

The Space Files MVP does not project files into Resources/Documents or the
Center Agent Computer. A later explicit **Copy to Organization Files** action
may create a new Organization-owned file with clear provenance; it must not
create bidirectional synchronization, shared identity, or hidden write-through.

Web presents **Messages | Tasks | Files** in an ordinary shared Space. Files opens at the Space
root and supports folder navigation, picker or whole-surface drag-and-drop
upload, download, Markdown creation and editing, source editing for other
supported text formats, rename, move, recoverable Trash, a compact version
history, older-version preview and restore, visible actor information, and
explicit conflict recovery. Restoring an older revision creates a new current
revision and never deletes later history. Leaving an unsaved file through the
file back action, Space tabs, another file reference, an internal route, reload,
or window close uses one save, discard, or cancel contract.
Markdown files use the same WYSIWYG CommonMark + GFM editor as Organization
Documents; this shared editing surface does not merge the two storage owners.
HTML files open in a static preview, with source editing available under the
ordinary text-editing limit. UTF-8 HTML previews are bounded to 2 MiB and support
inline styles and embedded images. Scripts, external resources, forms, and
links are disabled. **Open in new tab** opens the same isolated static preview
of the selected saved revision at a normal Web URL. Every new page load checks
Space access again; the link does not grant access or publish the file. Unsaved
source edits can be previewed in Files, but must be saved to appear in a new tab.
Current and historical revisions use the same preview policy. The original
bytes remain unchanged and downloadable, including when preview is unavailable.
CLI and Agent tools expose the same ids, paths, revisions, MIME inference, and
error codes instead of maintaining a terminal-only filesystem model.

Pinned files remain ordinary Space Files. Wake context includes a bounded
directory of their current metadata, not another copy of their content. Agents
must read relevant current content before relying on it or proposing a write.

File update notifications are off by default. An active human member may choose
current human and Agent members through **Notify on updates**. A committed
content revision atomically records that configuration's notification intent.
The Space publishes one deduplicated message referencing the exact revision;
human recipients use ordinary mentions and Inbox delivery, and selected Agents
use the normal authorized Wake path. Renames and moves do not notify. Retries
recheck the configuring human's access and recipient membership. Replacing or
disabling the configuration cancels its outstanding intent. Notification
delivery is not evidence that an Agent read or understood the file.

For supported text files, **Maintain with a Routine** opens the existing Routine
form with the Space and file instructions prefilled. Scheduling, Agent choice,
permissions, run history, and pause retain the existing Routine owners. The
instructions require confirmed human decisions, preserved source references,
current-revision writes, and no save when nothing substantive changed. Ambiguity
must not be silently converted into an approved decision. This is an ordinary
Routine, not a separate file synchronization or approval system.

Every Space-shaped conversation uses this same owner, including ordinary
Spaces, Human Direct Messages, Agent Direct Messages, the Center Agent Direct
Message, and threads. The shared Composer accepts up to ten files of any
supported MIME type through **Add to message > Files**, file picker, paste, or
drag and drop. Text is optional when at least one file is present. Upload begins
before send as a temporary Composer Upload that is not visible in Files and is
not yet a Space File. Browser-local attachment drafts retain the source files
and completed upload descriptors for up to 24 hours, scoped by Organization,
Profile, Space, and thread or inline edit. Navigation preserves these drafts;
explicit removal or a successful send clears them. Switching conversations
does not redirect an in-flight upload or submission to the new conversation.
Removing the selection discards that upload; abandoned uploads expire after
24 hours and Core removes expired objects.

Attachment-draft storage treats its IndexedDB connection as replaceable. A
closed or invalid handle is reopened within a bounded wait, and only transaction
creation may retry once before any file mutation begins. Operations for one
attachment ID remain ordered so a delayed save cannot recreate a removed draft.
Failed removal stays visible and retryable in the same account and conversation
scope after the Composer remounts.

Send immediately stages the message with local attachment previews and frees
the Composer, including when uploads are still running. In the background it
waits for the captured attachment batch, publishes every upload as a canonical
root-level Space File, and posts the immutable revision references. A failed
attachment is never silently omitted. A failure before publication keeps the
message unsent with an explicit recovery path. Retry keeps the original file,
attachment ID, selection order, expiry, and publication identity. When remote
staging succeeded but saving that descriptor locally failed, retry persists the
existing descriptor instead of staging another upload. A descriptor alone is
not publication readiness: the matching local draft write must also be
confirmed. Recovery never sends automatically. File publication and message
publication remain separate operations.

Composer image attachments use compact, edge-to-edge thumbnails on surface 3,
above the Composer's surface-2 context. Clicking an image opens the same
Morphing Dialog preview used by sent images. File names appear in tooltips,
and a persistent white circular remove button stays inside each thumbnail.
Other files show an icon and file type. Normal upload progress and ready labels
are not shown; failures remain explicit.

During a multi-file CLI send, the CLI keeps the exact ids of files created by
that not-yet-published submission. If a later selected upload fails, it moves
only those earlier files from the same submission to recoverable Trash. It
never guesses by file name or touches files from an earlier send. A cleanup
failure keeps the original upload failure primary and names every file id that
still needs the ordinary Trash action.

The timeline renders image references as bounded inline previews that morph
into a focused full-size view, while other file references use file cards.
The focused image view and each file card provide an explicit **Open in Files**
action for that same canonical file. The sent name, MIME type, size, and
revision are the server-resolved send-time snapshot, while Files shows the
current entry and its revision history. Renaming or revising the file therefore
cannot rewrite message history, and no projection or bidirectional
synchronization exists. The Files browser renders a real thumbnail for image
entries whenever the selected revision can be read, rather than presenting a
generic image-file icon.

Local Agents receive the exact file ids and sent revisions in the Wake source
snapshot, together with the canonical CLI read/download commands. Their Space
Action reply may upload files and publish the returned canonical references.
The hosted Center Agent reads and updates text files through its Space File
tools and can reference those canonical revisions in a Space message. All of
these paths are authorized as the acting Space member; none receives direct
Durable Object storage access or a Center Agent Computer shortcut.

## Direct Messages

A Direct Message is a Space with immutable DM origin plus current derived DM
state. OpenMeld does not have a separate DM subsystem.

DM origin is written only when the Space is created through a Direct Message
entry point:

```text
purpose = openmeld_dm_space
directMessage.pairKey = sorted profile ids for the intended pair
```

That origin marker never changes. It records where the Space came from, not
what the Space is allowed to become.

Current DM state is derived from origin and the irreversible
conversion marker:

```text
isDirectMessage = purpose is openmeld_dm_space
  AND directMessage.convertedAt is absent
```

Removing or deleting a participant does not convert a Direct Message. Only the
explicit conversion transaction changes its kind. This predicate is the single product meaning
used by navigation and headers. Automatic Wake addressing is derived separately
from active membership. Do not reimplement local
"looks like a DM" checks from name, visibility, member types, or route shape.

Every DM is created with `members_only` access. Only its creator, an active
member, another active Profile owned by the same account, or the derived Human
owner observer of an ordinary Agent participant may open it; the route, its
name, and cached history do not grant access. While current DM state holds, the
server rejects generic third-member addition, member removal, leave, delete,
lifecycle, name, visibility, access-mode, and password mutations. It also
rejects collaboration writes from a derived Agent owner observer until that
person explicitly joins through conversion. Clients hide those rejected
controls. This keeps a one-to-one conversation one-to-one and private until a
member or the Agent owner deliberately changes the product object.

A human member may select one or more new Organization Directory Profiles and
explicitly confirm **Turn this Direct Message into a Space**. A derived ordinary
Agent owner observer may invoke the same transaction only to add their own
active default Human Profile. The confirmation
names the selected people or agents, explains that they will see the existing
messages and files, allows a valid Space name, and states that the change cannot
be undone. One Space-owned transaction records `directMessage.convertedAt`,
renames the room, and adds the selected members. Generic member-addition APIs
cannot perform or imply this conversion.

The resulting Space keeps `members_only` access; conversion never makes the
conversation public. It moves to the ordinary Spaces navigation and thereafter
uses normal Space mutation semantics. The conversion marker is permanent, so
returning to exactly two active members does not turn the Space back into a
Direct Message. Legacy DM-origin Spaces with more than two active members are
migrated as already converted, and all legacy DM-origin Spaces are migrated to
member-only access.

The Center Agent DM is a stricter specialization. It remains a Space, but the
server constrains it to the current Human Profile and designated Center Agent,
rejects conversion as well as every additional membership, member removal,
leave, lifecycle, and metadata mutation, and excludes it from ordinary Space
lists. Clients hide every rejected mutation surface as well as relying on
server enforcement.

Center Agent chats reuse the ordinary Members panel for viewing the Human and
Center Agent profiles. This read-only entry does not expose addition,
conversion, removal, or invitation actions.

Center Agent chat introductions and suggested starting points are presentation,
not authored messages. Creating, opening, reusing, or preparing a private chat
must not publish a welcome greeting or backfill one into an existing transcript.
Clients reuse the shared introduction surface. Historical welcome messages remain
ordinary retained history; opening a chat neither rewrites nor removes them.

### Center Agent session foundation (Flue 2 candidate)

Each private Center Agent session reuses this stricter DM Space specialization;
the Space ID is its session identity. Multiple sessions retain the same real
Human/Center Agent pair key. Creating a session uses a dedicated operation with
an idempotency key scoped to the authenticated Organization and pair. A retry
reuses that session; a different creation key creates another session. The
ordinary DM open-or-reuse operation keeps its existing behavior.

Selecting a session checks the exact Space against the caller's current
Organization, Human Profile and designated Center Agent. An unavailable or
foreign selection never substitutes another conversation. Message and file
access still use Space-owned authorization. The session shares the Agent
Profile's Computer, with its own Space working directory; a directory is not a
separate Computer or a privacy sandbox.

The existing Center DM parent restrictions apply to every session: hide and
reject member addition/invitation, conversion, removal/leave, and generic
metadata, lifecycle, visibility, access and deletion mutations. Keep the
existing message, file, thread, stream and read-only information surfaces.
Session management must not unlock those generic mutations as a shortcut.

The candidate provides idempotent creation, authorized paginated listing and
exact Web route selection through New chat and Chats. Listing filters active,
unconverted private conversations by the current Organization and real pair;
the cursor is a pagination boundary, never access authority. Selection still
checks the owning Space. Rename, archive, and delete are dedicated Session
operations defined in Agent Direct Message Sessions. Browser acceptance, explicit execution steering and release
continuity remain incomplete release gates. Task retirement is deferred; its
existing product and tools remain available during this upgrade.

### Center Agent session titles

New agent Direct Message Sessions, including private Center Agent sessions,
start as **New chat**. After a Human's message
is accepted on the main timeline, Space may generate a concise default title
through a separate no-tool model request. This work is never awaited by message
publication, Wake admission, or the Center Agent execution loop. It cannot alter
conversation context, steering, tools, replies, or the selected Agent model.

The fixed model is `openai/gpt-6-luna` through the existing OpenRouter
AI Gateway connection, with low reasoning, structured
JSON, a 15-second request deadline, and bounded input/output. Titles use the
message's language, capture the action and subject, preserve meaningful names
and identifiers, and contain at most 64 characters. Output is validated rather
than cut mid-title. Greetings without a topic return no title. No model request
reads attachments, URLs, other sessions, or hidden Agent context.

Space owns the generated default in its existing name field and projects it
through the Space index. Auth-owned personal titles take precedence and are
never written by generation. Generic DM metadata mutations remain forbidden;
the dedicated internal naming path does not grant new public mutation rights.
Only the active Human in the Session's Human–Agent pair (the designated Center
Agent pair or any other agent Profile's Direct Message pair) can trigger it.
Existing non-default names are preserved. Failed or empty results keep **New
chat**; later Human messages can retry, capped at three persisted attempts per
Space. No automatic historical title rewrite or periodic regeneration occurs.

### Agent Direct Message Sessions

Implementation status: MemberAgent program, PR #236, shipped.

In a Direct Message with an agent Profile, a Session is one DM Space. **New
Chat** creates another DM Space with the same `pairKey`; the Center Agent
session create and list operations above apply to any agent Profile's Direct
Message pair, not only the designated Center Agent pair. The Execution Context
scope key is unchanged. The sidebar shows one row per MemberAgent with its
Sessions listed by `pairKey`. The ordinary open-or-reuse operation keeps its
existing behavior. Ordinary agent DM Sessions keep ordinary DM rules; only
Center Agent Sessions carry the stricter Center Agent specialization.

**Rename**, **Archive**, and **Delete** are dedicated Session operations for
agent DM Sessions, including Center Agent sessions. They act on the exact
Session Space after the same Organization and pair checks as selection, and
they never unlock the generic DM metadata, lifecycle, visibility, access, or
deletion mutations. A rename overrides the generated default title. OpenMeld
never archives a Session automatically. Owners continue or fork their own
Sessions; colleagues continue only their own and always start fresh.

### Personal Direct Message deletion

Archive hides a Direct Message from the person's active list. Archived rows offer
**Delete for me**, with an explicit confirmation. This permanently hides all
messages accepted through that command's position from that account's history,
search, links, update feeds, and Inbox. Other participants and Agent execution
continuity keep their shared history. New messages can make the Direct Message
visible again; they do not restore the person's earlier messages. Conversion
into an ordinary Space does not undo a personal history boundary.

Core owns one account/Space boundary in PostgreSQL. Space captures a monotonic
SQLite signal position; retention must never reuse an accepted position. Web
opts into the boundary date on history reads and uses it to reject older cache
responses and discard retained pages. Legacy readers receive their existing
response shape and the same server-side content restriction.

### Ordinary Direct Message opening

Humans, Local Agents, personal Remote Agents, and the Center Agent use the same
open-or-reuse contract. The caller and recipient must be active Profiles in the
same Organization; account callers may act only as their own Profile. Native
Agent callers use the existing admitted execution/Center identity boundary.
Self-DMs are rejected. Opening never adds an Agent's Human owner as a member.
A colleague's first Direct Message to another member's Agent Profile waits for
the owner's consent as described in Colleague use of an Agent; the message is
stored and not dispatched until then.

`openmeld_open_direct_message` (native Agents), `open_direct_message` (Local
Agent dispatch tools), and `openmeld space dm` share the public DM contract.
An optional message carries a stable client message ID and an explicit
`wake` boolean. Messages and Wake assignments go through the existing Space
publication and dispatch owners. A normal message does not start Agent work.
The message is rejected if the DM converted before publication; it must not
silently publish into a wider audience. Retrying the same message is idempotent.
Before starting work, callers open the DM without a message, then send using
its exact `spaceId` and a stable client message ID. This lets Stop identify the
request before publication finishes. A pinned send verifies the Organization
and participant pair and never opens a replacement conversation. The CLI does
these steps within one command and emits an early request receipt; native tools
perform two explicit calls. A retry uses that same Space and message identity.
Local dispatch collaboration is non-final and retains the calling Agent and
source Organization; its final reply still belongs to the original Wake.

An optional `creationId` creates a separate Human–Agent Session, for the Center
Agent or any other agent Profile, using the same session identity as the Web
New chat action. Reusing that ID retries the same Session. Human–Human pairs
reuse their current DM. Center–Agent DMs are ordinary
Agent DMs, not the Human–Center specialization.

Both participants' personal Agent owners may observe an Agent–Agent DM. When an
owner explicitly joins, the existing conversion transaction also includes the
other personal Agent's Human owner, as required for ordinary Spaces. Managed
Agent administrators do not gain observer access. Inbox records use ordinary
Agent-owner activity for these observers, never pretend the message was
addressed directly to the Human, and deduplicate a shared owner.
Read-only observers see the published failure explanation in both Messages and
Threads. They do not receive message mutation, recovery, or Stop controls.

Opening a Direct Message is idempotent within a generation. OpenMeld first
looks for an unconverted DM-origin Space for the same organization and pair key
whose active member count is at most two. If found, it reuses that Space. If
only converted or otherwise non-current DM-origin Spaces exist for the pair, a
new generation is opened:

```text
spaceId = hash("dm-v1", organizationId, pairKey, generation)
generation = count of existing DM-origin Spaces for that pair
```

Two concurrent opens that count the same generation derive the same Space id,
so the Space Durable Object upsert converges instead of creating two rooms.

People and Agents profile cards are equal Direct Message entry points. Either
entry sends the selected active Human Profile or Agent Profile id through this
same open-or-reuse contract, then navigates to the canonical Direct Messages
route. The client invalidates the Account Space Index projection before
navigation, while the target route reads Space status for canonical
classification and owns its pending shell; it must not render or briefly pass
through the Spaces sidebar. Clients do not offer a Direct Message to the
signed-in Human Profile or to a member without an active Human Profile identity.

In a current DM or the main conversation of an ordinary Space with exactly one
active Human Profile and one active Agent Profile, a text message authored by
that human automatically triggers the agent
through the same dispatch decision as an explicit Wake. After the target is
selected, Binding kind chooses exactly one execution family: workstation
Bindings use outbox, Queue, RuntimeCoordinator, and readiness; the
`hosted:center-agent` Binding uses the Remote Agent native-delivery contract.
Neither path may fall back to or also run the other. The dispatch prompt
receives one-human/one-agent context telling the agent that the message is addressed
directly to it and no mention is needed. Under this automatic addressing rule,
Agent-authored messages never auto-trigger, even in a DM, to prevent agent-to-agent ping-pong. Human-human and Agent-Agent
conversations do not automatically Wake an Agent. Ordinary group Spaces require
explicit Wake / mention addressing under the default mention-only policy.
Adding a third active member disables membership-based automatic Wake; returning
to one human and one Agent restores it for new messages. Online presence does
not change membership. Converted DM-origin Spaces follow this ordinary Space
addressing rule without regaining DM identity, privacy or mutation restrictions.
Explicit Reference remains an opt-out. Existing explicit listen-all Space policy
is separate from this default and is not enabled by membership changes.
Automatic Wake is enabled by default. **App settings → Personal → Spaces →
Automatically wake the only Agent** is a durable account preference across
organizations and clients. Turning it off disables implicit main-conversation
and Thread Wake for that Human author; explicit Wake addressing still works.
Core reads the verified author's preference when admitting automatic work.
Space status projects the viewer's preference for composer guidance.
Agents use structured Wake targets to request another Agent's work; a plain reply
never implies another Agent-to-Agent Wake under the default policy.
Ordinary Space Threads retain their independent participant-based addressing;
the containing Space's member count does not restrict a one-human/one-agent Thread.

## Legacy Welcoming Spaces

The previous onboarding flow created Spaces with this legacy purpose:

```text
purpose = openmeld_welcoming_space
```

These Spaces are retained as historical data but are no longer a current
conversation mode. Current lists hide them, they do not auto-dispatch like Direct
Messages, and the composer must not present them as an `@`-optional agent direct
conversation. First-touch onboarding now belongs to the Center Agent DM.

Legacy Welcoming Spaces remain excluded from membership-based automatic Wake.
Ordinary Spaces use the one-human/one-agent addressing rule above.

## Weekly Quality Reports

The current weekly evaluation job publishes the official OpenMeld
Organization's settled metrics into one deterministic public Space named
`OpenMeld Quality`. The report is a system-emitted Space signal authored with
the current designated Center Agent presentation. It is not a Wake, a Center
Agent turn, execution evidence, or a second copy of Space truth. Report data
ownership belongs to `developing/architecture/data-and-observability.md`.
On first creation, the Space bootstraps all current Organization owners as its
human Owners while preserving the Center Agent as creator and report author.
Later runs use the Space-owned `ownerUserIds` authority and do not resynchronize
ownership from Organization roles.

This specialization is not yet a complete Space contract. The implementation
creates an ordinary Space without a durable purpose marker or server-enforced
mutation policy, then requires the name to remain `OpenMeld Quality` on later
runs. Rename, visibility, membership, leave, deletion, and other ordinary Space
surfaces have not been adjudicated as keep or reject pairs. Treat this as a
known product-contract gap: do not infer hidden locks from the scheduled job or
copy the pattern to another system-managed Space until every parent Space
surface has an explicit product and server decision.

## Space Access

Space Access defines what a link visitor can do before they have joined the
Space. Organization visibility and link access are separate controls:
`visibility = private` makes the Space invite-only in the Organization, while
`accessMode = members_only` prevents an unadmitted visitor from reading content.
An authenticated Organization member can preview a listed (`public`) Space
before explicitly joining from the directory or its destination link, independently of external
link access. Preview is read only and never creates membership. Core verifies current Organization membership and canonical Space
policy; this grant admits only the caller's own Human Profile. It cannot add
someone else, an Agent, or members to an unconverted Direct Message.
The common UI asks **Who can read this Space?** and **Who can join this Space?**
and derives each selected audience from link joining, Organization visibility,
and guest participation together. It never presents a broad main label and
then retracts that promise in helper text. Invitation-only joining places the
invitation action beside the relevant selector rather than in the dialog
footer. Password controls follow the reading or joining rule they govern. The
URL is recovery information after clipboard failure, not permanent form
content. Organization visibility and guest participation remain in Share &
Access settings. Membership and ownership use a separate Members settings page
that directly shows its controls and reuses the shared invitation view. Owners
can explicitly configure public/password link access in Share or invite or
Share & Access; neither Organization visibility nor enabling guests publishes a
Space.

New Web Spaces explicitly request `members_only` with either private (default)
or public Organization visibility. The common form has one General access
selector and no anonymous or password options. Supported callers that omit
access mode still use the shared initial-access policy: private visibility
and public visibility both default to `members_only`. This default does not
override an explicit access mode. Existing policies are not
migrated, and visibility and access mode remain independently owned facts.

OpenMeld has four access modes:

- `members_only`: an active member or another active Profile
  owned by the same account can view the Space. Current Organization members can also preview Organization-public Spaces. New participants must be added
  explicitly or self-join under the Organization-public policy above.
- `public`: anyone with the link can view the Space. Signed-in external visitors
  can explicitly join only while external guest access is enabled.
- `public_view_join_password`: anyone with the link can view the Space, but
  joining requires the Space password unless the Organization-public grant applies.
  External joining also requires guest access to be enabled.
- `protected`: viewing and joining require the Space password unless an existing
  membership or Organization-public self-join grant admits the caller.
  External joining also requires guest access to be enabled.

`linkJoinPolicy` independently restricts the link-derived join grant. The
legacy-compatible `access_mode` value retains the behavior above;
`invite_only` lets `public` or `protected` reading remain available while the
link grants no new membership. Organization-public joining, direct additions,
accepted invitations, and current members retain their independent grants. A
missing stored value resolves to `access_mode`; new Spaces start with
`invite_only`, and an older writer that omits the field preserves its current
value.

Public reading includes retained messages, Threads, files, shared guide, pins,
and Tasks from the same Space. It creates no account or membership. Login does
not join automatically. Every content request rechecks current access; closing
link access blocks subsequent anonymous reads. Previously copied content cannot
be recalled. Private linked Spaces and unpublished Agent internals stay private.

There is one Space password. OpenMeld must not maintain a separate password for
viewing, joining, sharing, or any other Space access mode. When an owner turns
on a password-gated mode for a Space that does not already have a password, the
owner must set the Space password in that same operation. When an owner makes a
Space public, OpenMeld removes the Space password.

A protected Space uses a Space password as a first-entry gate.

After an OpenMeld account has joined a protected Space with any profile, the same
account should not be asked for that password again just to open, read, or keep
operating in that Space. The Space password protects the room from accounts
that have not joined yet; it is not a recurring command credential for members,
or their local agents. Creator attribution alone never grants access.

Active ordinary Spaces have one or more human Owners, all current Organization
members. Creator attribution is immutable history; `ownerUserIds` is the
Space-owned management authority. Owners can promote an existing teammate,
demote an owner while retaining another, and manage access. A guest cannot
become an Owner. The last Owner cannot leave an active Space without a successor.
Organization departure or account removal must resolve every active ownership
before membership is removed. An administrator can perform the explicit removal
preparation below without participation from the departing person. Organization
deletion requires its ordinary Spaces to be deleted first; it cannot strand their
history. Retained, read-only Spaces do not require their historical owners to
remain Organization members.

Organization member removal provides a limited administrative ownership surface.
A current human Organization owner or admin with `member:delete` can preview and
confirm preparation for another non-owner Organization member, including Spaces
the administrator has not joined. This surface cannot remove the requester or an
Organization owner. The preview reveals only each affected Space's ID, name, and
required action; it does not grant access to messages, files, or membership
details. The administrator is never implicitly added to a Space.

The Space decides the action from authoritative ownership, access, historical
membership, invitations, and pending work; its name and browser-local Welcome
tutorial marker do not decide eligibility:

- A private, members-only Space can close to retained read-only history when its
  only owner is the departing person, every historical participant is that
  person's own Profile or the verified Organization-managed Center Agent, guest
  access is disabled, no live invitation is pending or being accepted, and no
  work remains unsettled. A departed collaborator still counts as collaboration.
- If another owner remains, preparation demotes the departing owner to Member.
- Otherwise, preparation requires an explicitly selected current Organization
  member with an active Human Profile as successor. The successor joins the Space
  if necessary and becomes Owner before the departing owner is demoted. The
  confirmation must disclose that this grants the successor access to private
  Space history. A Space with unsettled work requires a successor rather than
  being closed; preparation does not stop work or manufacture a final outcome.

The administrator confirms these Space changes before native Organization member
removal. Core rechecks the reviewed plan, and each Space rechecks its action
under its serialization gate. A changed plan requires another review. Completed
closures and transfers remain saved if a later Space action or membership removal
fails; the UI must explain that removal did not complete and refresh the plan for
an explicit retry. Preparation is not automatically replayed and does not bypass
native authorization or restrictive ownership references. Self-departure and
account deletion retain their existing guards.

Leaving or removing a member preserves shared history and files. Delete Space is
a human-owner-confirmed transition to a retained, read-only Space; the narrowly
eligible administrative closure above uses the same retained state. The Space owns
`deletedAt`; original members retain their existing read grant and can search past
messages. Public links and passwords do not admit new readers after deletion.
Deleted Spaces stay in members' lists with a small red `Deleted` label. Members
can use `Remove from my list` to remove their account's memberships; other members'
history is unchanged. The active-Space owner handoff rule does not block this
personal removal. Shared message, file, member, and access mutations are rejected
by the Space, not merely disabled in the client. Account erasure remains a separate
trusted purge path and can physically clear data. Ordinary deletion must
reject with `space.wakes_pending` while dispatch handoff/recovery, a workstation
execution, a native delivery (including Routine runs and uncertain publication),
an admitted Routine awaiting delivery or failure publication, a task continuation,
or a stopped-outcome publication is unsettled. Users stop work through the existing
Stop action or wait for its outcome, then retry deletion. Deletion does not invent
an execution timeout or a second cancellation mechanism. The Space serializes the
check and deletion through its existing concurrency gate; the runtime owners retain
their execution authority. An unavailable owner store must not permit deletion.
PostgreSQL checks share one repeatable-read snapshot so a continuation-to-delivery
handoff cannot fall between independently read states. Rejected deletion logs the
pending owner categories and request ID without message contents.

Share or invite and Settings compose different task-focused views from one
canonical snapshot and one local draft. Link reading, Organization visibility,
joining, and guest access commit together so the UI never reports a partially
saved policy. Moving between Share or invite and Share & Access preserves that
draft; closing either surface requires one explicit discard decision. Members
are directly visible on their settings page, searchable, and paged in the UI.
Invitation-link state comes from persisted server state. Anonymous readers
never post or invoke Agents.

Unsent email invitations belong to the current open dialog and its account,
Organization, Space, and audience. Share-tab and Guest/Teammate switches retain
separate drafts and pending operations; closing the dialog or changing identity
starts a new invitation session. A successful create/request clears only the
unchanged revision it submitted. Resending or revoking an existing invitation
never edits the compose draft. Membership loading, read failure, and confirmed
denial are different UI states: a failed read offers retry, preserves any
existing draft, and disables invitation actions until the read recovers. Server
membership and invitation authorization remain authoritative.


Profile participation remains explicit. Same-account access does not silently
turn every profile under that account into a Space member. If a specific Human
Profile or Agent Profile needs to participate, be addressed, or be woken as a
Space member, that profile still needs to be added or joined through the normal
Space membership flow.

Space Access is also the product boundary for who or what is acting in the
Space. A signed-in human, an anonymous viewer, and an internal dispatch
continuation are different access actors even when they share the same request
context or Space password proof. Internal Space actions must preserve that actor
meaning so membership, visibility, Wake continuation, stopped outcomes, and
diagnostics stay explainable to the user.

Implementations must not treat Space password plus request context as a complete
replacement for structured Space access. The password proves entry to a protected
room; it does not describe whether the caller is a human viewer, an agent/system
continuation of an existing Wake, or another actor class. The structured access
model belongs in the shared contract layer.

A Space link carries a destination, not authority. The canonical public link
may identify only the Space, or preserve one message Signal plus its Thread-root
Signal. Creating, copying, or receiving that link never changes membership,
grants access, or proves that its target is readable. Web and CLI must preserve
the same target through the Space Access decision, and every eventual content
read still performs its normal authorization.

## Addressing Relations

Space Message Addressing is the product model for targeting a Space message.

It has three relations:

| Relation      | Target support     | Creates executable work |
| ------------- | ------------------ | ----------------------- |
| Wake          | Agent Profile only | Yes                     |
| Reference     | Agent Profile only | No                      |
| Human Mention | Human Profile only | No                      |

Wake asks an Agent Profile to do work.

A message containing only selected mentions can bring an Agent into the preceding
conversation. Space captures bounded context from the same conversation: an
explicitly referenced message takes priority; otherwise it selects the sender's
latest substantive message among at most 20 recent messages from that sender,
plus the thread root. Recalled messages are excluded. The trigger identity and
reply placement remain unchanged. This context helps interpret the request; it
does not create additional authorization or Wake targets. A substantive new
request does not receive this inferred context.

The dispatch snapshot's optional `contextMessages` preserves source IDs, authors,
bounded text, and exact file/attachment references. Shared rendering supplies the
same explanation to workstation and native Agents. Native delivery rereads those
Space messages for current image references and excludes recalled messages;
workstation delivery reuses existing file/image inputs and capability gating.
Existing input count limits still apply.

Contract Impact Audit: Core owns the new persisted snapshot field and its readers.
Core producers and consumers must be rolled out together; an older strict Core
reader cannot accept a snapshot containing the new field. Do not roll back those
readers while such snapshots are pending. At the installed Service boundary,
Core removes the new field and renders context into the existing text and
file/attachment fields. Native workers likewise receive existing message and
attachment inputs. CLI, Service, Skills, Gateway, setup, authorization, and
execution ownership gain no new required fields or minimum versions.

Reference includes an Agent Profile as message context without assigning work.
Web labels this relation `Mention only`. The Composer relation menu explains it
as `Mention only — Won’t wake the agent`; compact tokens use `Mention only`.
The serialized relation remains `reference`, with no change to execution semantics.
An explicitly referenced Agent must not be added back by implicit Direct Message,
Thread continuation, or listen-all dispatch. Reference-only messages do not check
execution readiness or create work, and reconnecting a Computer must not replay
them. Current member and message-write authorization still applies.

The Footer's `Mention only instead` recovery is for a confirmed Local Agent that
cannot currently Wake, not a Hosted Agent or a transient checking/preparing
state. In a Local Agent Direct Message without an authored mention, choosing it
inserts a visible Reference token while preserving the draft; it is not an
invisible mode or a no-op. Existing tokens use the same relation mutation.
Normal explicit references to Hosted Agents remain supported in collaboration.
Connection recovery belongs to the current blocked Wake target, never a stale
failed-send target after the draft changes.
Human Mention directs a person's attention to the message without creating
Agent work or requiring a reply.

Every mention is not a Wake. A user can talk about or reference an Agent
Profile without asking it to execute work.

Wake is not a separate product system next to Space messaging. Wake is the
executable relation inside Space Message Addressing.

Reference is collaboration context only. If a message only references an Agent
Profile, the user should not expect local work or an agent reply.

Every newly authored Wake, Reference, or Human Mention target must be an active member of the
current Space at the Space write boundary. A removed member or a Profile that
belongs only to the Organization cannot be used as a current addressing target,
because the resulting message could not resolve that target from Space truth.
Mentioning an Agent that has no Profile in the Space is not an addressing
target: the owner's own mention adds the default Profile through the atomic
owner join first, and anyone else's mention creates the owner request described
in Agent Owner Participation, with no Wake.
This authoring rule does not revalidate historical messages: an older persisted
target remains readable through the compatibility projection even if its
membership later changes.

Composer authoring keeps these relations explicit without imposing a required
confirmation step after every `@` selection. An Agent Profile defaults to Wake
only when the current Core-owned Wakeability projection is `ready`; an
unavailable or checking Agent defaults to Reference. Human Profiles always
create Human Mention, so Web
shows a fixed `@Name` mark instead of a meaningless Wake/Reference selector.
Each inline Agent token shows its own Wake or Reference relation, so Web does
not repeat those relations in a bottom count summary. Human Mentions stay
visible in the message itself without an Agent relation label. Every Composer
inline target provides a direct remove action in addition to keyboard deletion.
The `@all` picker lets a member choose People, Agents, or Both. The Composer
shows that selection as one `@everyone`, `@agents`, or `@all` token, respectively,
while retaining every selected current member's Profile ID and relation. One
token is removed as one unit; the send path still validates and addresses each
member individually. A saved or restored draft keeps the selected target set,
so a later membership change does not silently add recipients.
The system may warn about a possible semantic mismatch, but it must not silently
convert one structured Agent relation into another. An existing or restored
Wake draft remains a Wake while the user edits it, but every send attempt checks
the current Core-owned Wakeability before publishing the message or files.
Reference authoring and ordinary text input remain usable while Wake is blocked.
An online target uses ordinary Send with no waiting settings. When one addressed
local Agent has a current device target and Core reports it offline or
reconnecting, the composer offers **Send and wait**, explaining that it will wait
up to 24 hours. Clicking this action makes that target a Wake, including when its
mention began as a Reference. Ordinary Send does not opt a Reference into waiting.
The Agent's current Binding determines the computer automatically. Web pins that
Binding and Runtime and sets the absolute deadline to 24 hours after the click;
there is no device picker or custom date input. The existing bounded API contract
is unchanged. A private Agent conversation uses its existing implicit Wake target
without requiring an extra mention. Main-timeline and thread messages share this
behavior. When multiple offline Agents are addressed, the composer asks the user
to send to one offline Agent at a time; one wait never unblocks another target.

While it waits, the message shows the current waiting state and **Cancel waiting**
through the existing Wake Stop control. Message details explain whether the
computer is offline, the Agent is getting ready, or earlier work must finish, and
show the exact expiry in the viewer's local time. The Agent's current Wakeability
is still an independent projection.
Expiry and cancellation are terminal for this Wake. Reconnecting a computer
does not revive old failed Wakes or automatically repeat partially executed
work. An expired wait shows **Wait expired. Task did not run.** and **Send again**.
Send again prepares a new composer draft addressed only to the expired target,
referencing the original request and its context. It preserves existing drafts
and does not send automatically. Ordinary submission creates a new message and
execution identity, checks current admission, and, if the computer is still
offline, requires Send and wait again. The original Wake stays terminal; this
action is not offered for interrupted work, cancellation, or other failures.

Repeating the same Agent
mention in one message keeps every occurrence explicit: the first token owns
the selected Wake or Reference, while later tokens resolve to Reference and
never create another Wake. Web preserves the authored visible text. CLI accepts explicit `--wake <agent-profile-id>`,
`--reference <agent-profile-id>`, and `--mention <human-profile-id>` recipients.
Both generic sends and dispatch-owned replies require full current Profile IDs.
Names, aliases, case folding, short IDs, and relation suffixes are not selectors.
Web and the interactive terminal retain the selected Profile ID and relation
alongside the visible mention. Typed or pasted text never creates a recipient;
editing through a selected token removes its identity rather than re-resolving
the new text. CLI sends prefix readable current names for explicit recipients.
Repeated IDs within one CLI relation are deduplicated; conflicting relations
fail before publication. `--plain` asserts that no recipients were supplied.
Old `@Name(wake)`, `@Name(reference)`, and `@Name(mention)` text is literal.
Dispatch prompts preserve authored text instead of stripping apparent controls.

Existing restricted mention-label wire fields remain readable for supported
older clients and historical messages. They are not Profile names or authoring
selectors in current clients; their punctuation restriction does not constrain
selected names. Retiring those wire fields requires a separate negotiated
response migration, not a silent change to strict older response schemas.

Web presents the first visible `@Name` owned by each structured Agent Wake or
Reference as one inline Agent token. The token includes the Agent Profile icon,
canonical name, and exact relation. If the same structured Agent appears again
in that message, the later appearance remains an explicit Reference token,
matching the Composer's duplicate rule without creating a second Wake target.
This is presentation of existing structured authoring, not inference from an
otherwise unstructured message; a message with no structured target keeps a
bare `@Agent Name` as ordinary prose.

Delivery intent matters. If a human or agent asks one Agent Profile to deliver
work to another Agent Profile, the publishing agent must use Wake or Reply +
Wake. A plain reply that contains a bare `@Agent Name` is ordinary prose; it does
not create executable work for the named Agent Profile.

Detailed Wake execution ownership belongs in
`developing/architecture/agent-transport-contract.md`.

## Continuing A Main Conversation And Editing Messages

Local Agents support explicit New task, continuation from an exact source, and
completed-history fork. On supported harnesses, separate discussion scopes may
use independent Execution Contexts under the same Profile, up to the
Profile's owner-adjustable concurrency limit (default five). Follow-ups within one Context remain serial. Replies, Stop,
interaction requests, and failure evidence stay attached to the originating
Wake. Migrated Profiles use Context continuity instead of the old Profile-wide
conversation; legacy Wakes retain their original drain and recovery behavior.
Context assignment does not grant access to another member's native history.

An MCP Space Action receipt confirms only a local proposal, explicit local
rejection, or an unknown local outcome. It does not confirm Core acceptance or
Space publication. Those outcomes continue to come from the existing execution
and Space authorities. This version adds no separate Late reply affordance.

An ordinary Space's main composer may recommend the single Agent the current
Human last explicitly woke after that Agent replies. The suggestion is not an
addressing target. Click or Tab accepts it as an ordinary Wake token; ignoring
it sends an ordinary message. Explicit dismissal suppresses the corresponding
post-send suggestion. Other members' Wakes and ambiguous multi-target turns do
not select the target.

Each completed Wake request grants one recommendation opportunity. The original
request ID identifies the exchange; supplementary replies do not grant another.
Accepting or dismissing the recommendation remembers that choice in browser
session storage, isolated by Organization, Human Profile, and Space. Dismissing
either entry point suppresses both through navigation and refresh. An ignored
recommendation moves to the exact staged message's client message ID, without
remaining in the Composer or repeating on subsequent ordinary messages. A new
explicit Wake must receive a reply before another recommendation is eligible.
This presentation-only record never clears, replaces, or shares storage with
text, mention, or attachment drafts, and never authorizes an Agent execution.
The Composer suggestion exposes its dismiss control on hover or keyboard focus
(always on touch). Backspace dismisses it at a collapsed caret at the start of
the editor; text deletion, selected text, IME composition, and member picking
retain their normal keyboard behavior. Dismissal does not accept a Wake token.

When that suggestion was ignored at send, only the sender sees a dismissible
ordinary Agent token labeled `Click to wake` below their latest sent message.
Clicking it directly saves an edit with that Agent's first Wake, without opening
an editor, asking for another selection, or requiring another save. Failures
remain beside the suggestion for retry; repeated clicks cannot dispatch twice.
Agent candidates in the Composer member picker show the Profile name and, when
available, its owner's name. This distinguishes identical names without changing
the Profile ID used by a mention or its Wake/mention-only behavior. Owner names
are searchable alongside Profile names.

Manual `@` editing uses the same Composer member picker. Selection edits the
draft; `Save & wake` commits its first Wake. `Save changes` only updates content. All viewers
see the resulting ordinary Wake token and edited marker on the original
message, with its ID, sent time, replies, reactions, and placement preserved.

A message that already requested a Wake cannot request another through editing,
including after failure. Original Wake targets remain fixed; an edit never
rewrites an accepted execution's content snapshot. Ordinary edits can add or
remove files using the Composer upload path. The inline editor preserves text,
typography, attachment previews, expansion state, and reading position. It does
not put a long message inside a small scrolling editor or silently reformat it.

## Human Input During A Wake

A local Agent Profile may pause one active Wake to ask its Binding owner for a
permission decision, structured answer, or plan review. The Binding owner sees
the request in the current Space's Pending Action Surface near the Composer,
including requests from the active thread, so required input does not become
buried in message history. The surface preserves the request's originating Wake
and thread context. Answering continues the same Wake and must not create a new
Space message, new Wake, or second provider conversation.

Only the owner can answer. When the Wake's root requester is not the owner,
the Inbox producer marks the interaction `urgent`, so the existing urgent email
channel applies. Interactions are coalesced per Session by `contextId`: a later
question in the same Session updates the same Inbox item and sends no new
email. The Inbox item renders the same interaction card with the harness's
native options plus **Open conversation**; answering anywhere closes the
request everywhere. The requester sees only that the Agent is waiting for the
owner to approve, for example "Waiting for Felix to approve a command", and may
cancel the waiting task. The existing eight-hour interaction timeout ends an
unanswered request with an explicit reason. Urgency comes from the root
requester fact, never from inference.

The pending request is private execution state. Only the Binding owner receives
its details and response controls. Other authenticated Space members receive
only a safe waiting indication so collaboration remains understandable without
exposing a private command, file path, plan, question, option, or answer. The
request is not Space history and disappears when it is answered, cancelled,
expires, or the Wake reaches a terminal outcome. The final visible outcome
remains one Agent reply, explicit stopped outcome, or explicit failure.

## Delegation And Continuation

An Agent may Wake another Agent as a declared child task. The child Wake keeps
the ordinary Space addressing and visible-outcome contract; parent-child
topology does not turn a Reference into work or create a second publication
path.

The delegating Agent chooses the result owner before dispatch:

- `child_reports_directly` means the child publishes the requested result in
  the originating Space placement;
- `resume_parent_when_all_terminal` means Core creates a new parent Agent turn
  after every declared child reaches an authoritative terminal outcome, and
  the parent publishes the requested synthesis;
- `resume_parent_when_first_success` creates one parent turn for the first
  successful child;
- `resume_parent_on_failure` creates one parent turn for the first
  authoritative failure;
- `resume_parent_on_each_terminal` creates one idempotent parent turn per child
  terminal outcome.

The latter is a new execution with a compact exact child result reference. It
does not reopen the source message, parent execution, or child execution.
Duplicate terminal events must not create duplicate parent turns or visible
answers. A child-authored mention of the parent may be ordinary conversational
content, but it is never the reliability mechanism for continuation.

Resumed continuation is available only for a verified member's Space-triggered
Center Agent turn. Each continuation receives a bounded delegation snapshot
with exact child states and terminal outcomes. Direct child reporting remains
the default and is rollout-compatible with older Core versions. A caller that
explicitly requests resumed continuation must fail closed if Core cannot return
the durable delegation and exact child Task Handles.

A fallback Agent is a planned child behind exactly one primary Agent. It is not
an activation target on the primary Space message. Only an authoritative
primary `failed` or `publication_failed` outcome may create its idempotent Wake.
Every other primary terminal outcome skips it. Stopping the parent cancels
planned fallback and continuation work and forwards exact Wake Stop requests to
active Space Wake children. Core attempts all of those targets before reporting
an aggregate failure; retry reuses the same exact Task Handles and cannot
publish a stopped continuation.

## Message Reactions

An active Human member can add standard Unicode emoji reactions to persisted
Human or Agent text messages, including thread replies. Selecting the same emoji
again removes only that person's reaction. Multiple people share an emoji count;
each person can use more than one emoji, once per emoji per message.

Reactions remain beneath their source message, before its thread preview, while
main-conversation message actions float beside the bubble's upper visible edge,
following the lower visible edge when a long message scrolls past the top of
the viewport. On self-authored messages the
reactions start at the bubble’s left edge and stay within its width. Overflow
reactions appear in a +N pill that
opens on hover or click. Emoji groups retain their first-added order while any
member still uses them; a fully removed group returns at the end if added again. The
message action bar opens a compact set of common emoji and an optional full
picker. Existing reactions show counts and the viewer's selected state. Members
can inspect who reacted, including a paginated complete list when needed.

Reactions to Human messages create ordinary unread Inbox updates for the author,
except self-reactions, in both the main conversation and threads. They do not
create messages, Wakes, task completion, or execution approval. Removing the last
reaction removes its chip. Failed changes restore the confirmed state and offer
a retry. The Inbox owner document defines recipient and delivery semantics.

Authorized Human and Agent message reads include the current reaction state,
participant identities, and explicit preview truncation. This applies to Local,
Center, and personal Remote Agent context reads within their existing access
boundaries. Reading new-message deltas alone does not discover changes to older
messages; reread the source message to obtain its current reactions. Agents do
not write reactions in this first version.

## Threads

A Space Thread is conversation placement under one root Space message.

It answers one product question:

```text
Which Space-local conversation belongs under this root message?
```

A Space Thread is not an Agent Controller conversation. Thread placement decides
where a visible Space reply belongs. `agentControllerConversationId` decides
which private local controller conversation the Agent Profile continues.

A thread does not answer who owns work, what the workflow status is, whether the
work is complete, or what external issue is linked. Those meanings may appear in
conversation content or future product layers, but they are not thread truth.

Thread placement is not Space Message Addressing. Addressing describes who a
message targets. Thread placement describes where the message belongs in the
Space conversation.

Thread messages reuse the normal Space publication model. There is no second
message system for threads.

Main and Thread share message grouping, Profile popovers, message tools, quoted
reply composition, supported queued follow-ups, and scroll controls. Narrow
containers use the shared compact message-tools presentation. Thread has no
nested Thread action or date-navigation surface. Per-message times remain visible.

Thread unread navigation includes only that Thread's replies. Visible-message
acknowledgements use the existing Space read owner and update the aggregate main
unread projection; there is no independent Thread counter. Jump to latest and
navigation alone do not mark unseen replies read. Each Thread retains the
viewer's reading position independently of the main conversation.

In full-width layout, the message rail reserves an avatar and its gap on both
sides. Long self and other messages share the same content edges; short self
messages keep their right alignment. Composer and header width remain unchanged.

Thread replies use the same one-to-one rule as human-to-Agent Direct Messages:
when the retained thread authors consist of one human and one Agent, sending a
plain message Wakes that Agent without a Composer token or confirmation. Include
the current sender before deciding: a second human's first reply is already a
group conversation. Count the root and retained replies across all history pages,
not Space membership or the visible page. Only an active Agent member is eligible.
Human-only threads never invent an Agent recipient.

For multiple humans or Agents, use the normal Space Wake recommendation and
explicit mention interaction. Ignoring or dismissing a recommendation sends an
ordinary message. Direct conversations do not show Wake recommendations.
Explicit addressing takes precedence over automatic Thread addressing.

Space resolves automatic addressing at acceptance, adds the ordinary visible
Wake token to the sent message, and freezes its recipient through the existing
publication and authorization path. It does not edit or resend the message or
create a second execution. Duplicate client-message identities replay the original
accepted message. Composer text and attachment drafts are never rewritten to
establish a recipient. `threadWakeContinuation` records automatic addressing;
these messages do not change the last explicit human selection used for suggestions.

Thread placement and RuntimeCoordinator execution ownership remain unchanged.
Quoted context comes from the retained referenced message, including outside the
visible history page. Recalled or unavailable quotes expose no old content.

If a user Wakes an Agent Profile from a thread, the Agent Profile's reply should
default back to that same thread. The user asked from that local conversation,
so the visible answer belongs there.

Opening a thread under a main-timeline Wake does not change its message-review
scope. The root remains a main message, while also being a valid starting point
for reading its thread. Reply placement follows the policy below independently
of that frozen source scope.

If the hosted runtime rolls a Space conversation to a fresh internal generation,
the Space owner uses the exact dispatch's frozen thread placement to rebuild the
bounded continuity prefix. A thread Wake receives only that thread's root and
prior replies; interleaved main-timeline messages are not part of its local
conversation. A main Space Wake continues from the main timeline. Callers do
not infer this scope from a generic history response.

A UI-only thread that cannot Wake an Agent Profile end to end is not a complete
OpenMeld Space thread. If thread-aware Wake cannot be supported, the product should
reject that Wake action instead of silently posting it to the main Space.

## Replies, Status, And Visible Outcomes

A reply should appear where the user expects the conversation to continue.

For Local Agents, personal Remote Agents, and interactive Center Agent turns in
shared Spaces, existing Thread conversations continue there by default. A main
conversation request in a Direct Message or an ordinary Space with exactly one
active human and one active Agent defaults to main. Other main-conversation
requests default to the Thread under the triggering message. These defaults
are recommendations: explicit user instructions take precedence, and an Agent
may choose the location that fits the task, including a main-conversation
announcement or a focused Thread exchange.
That choice must be structured: Local Agents select `placement=conversation`
on their final reply, while hosted Agents use `openmeld_set_reply_placement`.
Answer text alone never changes placement. Do not also publish a copy in the
main conversation.

Pre-execution progress and failure notices follow the source message. Final
reply placement is resolved and locked by Space before publication, and later
callbacks and recovery reuse it. This does not change the source message's
observation scope or RuntimeCoordinator execution authority.

Local Wake instructions direct agents to share a brief public blocker update
through `report_progress` when useful work can continue. The update explains
the effect on the request and the next step; private commentary is not Space
progress. Repeated unchanged updates, credentials, raw commands, and private
reasoning stay out of public progress. If supported recovery cannot unblock any
useful work, the agent uses the required completion action to explain the
remaining blocker. Progress remains non-final and does not authorize retries or
replace native permission controls.

For interactive Center Agent turns, follow an explicit user preference for the
main conversation, including a continuing preference while it remains relevant.
The Center Agent selects that destination with `openmeld_set_reply_placement`
as early as possible, preferably before public progress. Center and personal
Remote Agents can change their selection until final publication begins.
Reconsider each request using current instructions and relevant conversation
preferences; a per-dispatch selection is not a permanent Space setting.
While the destination is unresolved, Web presents the unfinished Agent reply in
the source conversation, using the same progress projection as the sidebar and
conversation controls. Public work and answer deltas appear in that reply as
they arrive. This provisional presentation does not choose durable placement.
Thinking and transient progress must not
select a reply destination or create a Thread. Once Space selects a Thread, the
triggering message's **Open thread** entrance shows the compact current status
and an authorized Stop control; the complete progress and final answer appear
in that Thread. A final reply preview replaces the interim entrance status.

Space owns one durable output placement per dispatch, separate from source
context and conversation continuity. Explicit selection and the first answer
text resolve an editable destination. Public work, reply drafts, and active
status follow the current selection, including changes with no new text delta.
Final publication locks the destination for callbacks and result recovery.
An abandoned empty Thread does not retain an active preview entrance; existing
Thread content is never deleted when placement changes. Pre-execution system notices still follow the
source message. Routines and external Message Channels keep their own policies.

Guide answer detail positively: prioritize useful new information, make outcomes
easy to understand, and choose detail and structure for the user's task and
conversation.

Reply placement is source alignment, not a hard-coded thread rule. An Agent
Profile should keep the current source, requested action, performed action, and
visible reply aligned. When a reply uses other Space messages, private context,
memory, or tool results, those sources must support the current reply instead of
silently shifting the answer to a different request.

One Wake should produce one final visible outcome:

```text
one persisted reply, one explicit stopped outcome, or one explicit failure
```

If OpenMeld stops a Wake before it reaches the agent, the visible outcome is still an
explicit stopped Space system notice. It is not an Agent reply, and it must not
be rendered as silent disappearance from progress.

Web presents a stopped outcome in the target Agent's reply position with the
label `(Request stopped)` and the original request context, not as a conversation-wide
notice. This presentation does not change the system notice's authorship or
claim a successful Agent reply. Each target of a multi-Agent request retains
its own outcome. Public reply text already accepted by Space stays visible,
including after refresh; private thinking and transient work are not retained.
An empty stopped response shows the target identity and `(Request stopped)` alone. Stop
does not imply that earlier actions were undone.

For ordinary account-owned Profiles, only the account that authored the Wake's
source message or the target Agent Profile's owner may stop that Wake, and they
must still have writable Space access. Space membership, Space creation, or
Organization administration alone
does not grant this permission. Other members can follow progress but cannot
interrupt the work. Signing in to several accounts on one computer does not
combine their permissions. This rule covers queued, running, and native-delivery
Wakes; each target of a multi-Agent Wake is authorized separately.

The currently designated Center Agent may also stop its own request in an
Agent Direct Message. Before publication, it must still be the exact private
pair; after conversion, this permission covers only its existing messages from
before conversion. Other Center Agent Stop requests retain the verified member
and source-attribution rules. A missing message never authorizes creating a
Stop fence as a different author.

If a Wake reaches the local agent but the controller or upstream model provider
fails, the explicit failure notice should expose the safest actionable public
reason OpenMeld knows. Known provider failures such as insufficient credits, invalid
credentials, rate limits, or provider unreachability should tell the user what
to fix next. Raw provider or adapter error text must stay in diagnostics and
must not be copied directly into the Space. The structured `reasonCode` remains
available to recovery and diagnostic surfaces, but it must not be appended to
the visible failure sentence. The live stream terminal shown while durable
finalization settles and the final persisted failure must resolve that public
reason through the same shared mapping; the temporary state must not regress to
a generic failure when the accepted result already contains a safe, actionable
reason. A transient inability to confirm a controller's
available-model inventory is distinct from proof that the selected model is no
longer available: the former asks the user to try the Wake again, while the
latter asks the user to choose another model.

If the Agent finishes but OpenMeld still cannot post its reply after the
product-defined repair window, the conversation must not remain pending
forever or later show two contradictory outcomes. Space atomically keeps an
already-published reply or, when none exists, posts one explicit
publication-failure notice with one action to Wake the Agent again and a path
to diagnostics. That notice closes only publication, not the truth that the
Agent produced a retained result.

If Wake is rejected because the Agent Profile belongs to another Organization,
the outcome must name the Workspace mismatch and offer no authorization or
reuse action. This is an identity boundary, not a configurable warning. The
user creates or selects an Agent Profile that belongs to the current Workspace.

A terminal execution outcome never authorizes another execution. When the user
wants the Agent to run the request again, they start a new Wake through the
ordinary Space composer, where current Wakeability, message identity, target,
and authorization are checked again. Message details remains the recovery and
diagnostics surface for the terminal outcome; it does not turn retained source
text into a retry capability.

An exact retained local result changes that action state. Space keeps the
original `terminal_failure` as execution truth and may receive a separate,
nonterminal `execution_recovery_available` notice for the same dispatch and
result reference. After refresh, Web correlates that evidence to the original
outcome and reads Core's exact Execution Recovery projection; it never expects
the original terminal reason to change. A real retained-result capability
hides generic fresh Retry because rerunning the source message could repeat
external writes, commits, pull requests, or other business side effects. Space
presents **Recover result** only when Core exposes an authorized, idempotent
durable-result publication command. If no result exists but the exact Agent
Controller conversation is safely resumable, the primary action is **Recover
reply**. Its warning must say that OpenMeld asks the same Agent
conversation to post the reply it already finished and does not run the task
again. A reconnect/setup link must not be labeled as either recovery action.
If neither recovery tier is available, the outcome has no recovery action. A
new Wake remains a separate user request through the normal composer.

For a hosted Center Agent empty-answer failure, **Continue conversation** may
prepare a reply from the exact retained conversation. Core verifies the original
delivery and freezes a reply-recovery request; the Remote Worker disables tools,
Skills, and Computer access for that request. This is not a fresh execution of
the original task. It preserves the original message and attachments in history.
Space publishes a separate idempotent `execution_recovery_completed` notice,
without rewriting the original failure. A failed recovery disables that action
and points to the existing Details report path; it does not enable another loop.
Web presents legacy empty-answer text Signals as failures using their recorded
failure purpose and reason code, never by matching prose.

Each failed target presents one primary next step chosen from the specific
cause and available recovery evidence. For example, a Cursor plan limit offers
**Manage Cursor plan**, an unavailable local Agent may offer its relevant setup
action, and an exact retained reply offers recovery. Unrelated actions must not
appear beside that primary step. Message details is the separate diagnostic
path and keeps its technical evidence available without a duplicate diagnostics
button.

For one exact failed target, Space renders one recovery control, not separate
timeline and Message details controls with different operation ids. Opening
Message details transfers the visible CTA from the outcome row to the drawer;
closing it returns the CTA to the row. Both surfaces share the exact
dispatch/target/result identity and the same idempotent operation fence.

Once the ordinary Composer creates a new Wake with a fresh client-message
identity, every outcome-unknown transport redrive must keep that same identity
until Space accepts or definitively rejects it. The UI must not call an
outcome-unknown delivery failed or invite a second logical Wake under another
identity.

Live previews may help while work is happening, but they are transient
projections, not Space messages, execution truth, or final history. The durable
reply, stopped notice, or failure notice must replace the preview; a preview or
terminal stream frame must not become a second final result.

Room entry may recover a privacy-safe active stream presence before any reply
text exists. That presence contains only stream identity, sequence, gap, and
timing evidence. It keeps the existing Agent row visible across refresh while
thinking-only or tool-only work is active, but it stores no model thinking,
reply text, tool input, tool output, command, path, or raw error. It is a
transient projection of an active stream, not a second execution authority or a
claim that a final reply exists.

Only a one-to-one Center Agent Direct Message may show an optimistic reply shell
before the first authoritative Agent stream event. The shell is derived from
the current active Wake presentation and shows the known Center Agent identity.
It starts with compact `Thinking…` copy and an immediately available Stop
control on the first optimistic message. Transport preparation, Wake delivery,
connection, and retry steps stay in diagnostics. Meaningful queue, offline,
approval, failure, and live tool progress remain visible. The row keeps one
stable Stop-control slot without moving the conversation. The shell makes no
tool, reasoning, or final outcome
claim and is not independent execution authority.
It must not be persisted, recovered as conversation history, or reused in an
ordinary Space or thread. An authoritative stream projection, durable reply,
stopped notice, failure notice, or ended Wake presentation removes it.

Stop is one click for one target. Multiple targets use the shared picker with
per-Agent Stop and Stop all. Clicking immediately shows `Stopping…` and freezes
the current partial answer; only a confirmed terminal outcome says `(Request stopped)`.
Completed work remains visible and Stop does not imply rollback. A completed
reply wins a race with a later Stop acknowledgement. A failed connection keeps
the command intent with an explicit retry action. Receipts survive navigation
and are isolated by acting Profile and Space; an interrupted request restored
after reload is unconfirmed, never reported as stopped. New-chat preparation
can be withdrawn locally before a Space exists and retains the unsent draft.

Agent reply work summaries follow the same rule for hosted Center Agents and
workstation Local Agents. A Space may show one compact live **Work summary**
from a privacy-bounded tool lifecycle part only when the part carries an
admitted semantic work meaning. The row is a transient projection and must not
expose or derive copy from a technical tool name, orchestration wrapper, tool
input, output, raw error content, command, path, or private Agent text. A
meaningless wrapper such as Code Mode is hidden; admitted inner work appears
when it starts and updates the same row when it completes or fails. Failure
does not reveal the raw error. Unknown work has no generic fallback.

The Work summary replaces the existing progress row while visible instead of
adding a second status row, opens while work is active, groups
consecutive identical work, and stays inside a bounded scroll viewport. A user
who scrolls up controls their reading position until they explicitly jump to
the latest step. A single failed admitted step is named explicitly in the final
collapsed summary; multiple failures show a count and a direct details cue
instead of vague `had a problem` copy. When an Agent successfully publishes a final reply, that
durable Signal may retain an ordered work projection containing only admitted
semantic work, lifecycle states, technical compatibility names, and truncation
evidence. The final answer renders first; its Work summary follows and defaults
closed. The final Signal may also retain bounded explicit hosted public updates
for readers to reopen in that summary. Provider reasoning remains private.
Separately, Message details may retain the same bounded semantic work
and lifecycle states with timestamps for 14 days in the unified **Activity**
timeline.
Neither projection is a transcript, raw tool journal, or the separate Agent
Activity product. Neither may contain tool call IDs, arguments, results, raw
errors, commands, paths, or Agent text. A tool-only stream still closes when the
durable reply or notice is published so its live work cannot linger. Failed or
stopped streams discard their temporary work record and publish no durable work
summary.

Message details is one right-side drawer for every visible Space message. An
ordinary Human message, an Agent reply, a Wake source, and a terminal outcome
all use the same durable Message Details projection and the same presentation
model. The drawer always begins with the actual message preview, author, and
sent time, then represents each Wake target with one Activity row. Live work
updates that row in place. A recorded reply or terminal outcome replaces the
transient work in the same row and keeps its final status, content, explanation,
recovery action, and diagnostic context together. The drawer must not create a
separate Replies section, detached failure summary, or redundant `replied`
event for the same target. Web must not create a second "work message" details
UI or derive an alternate final status from component-local state. Live
progress may enrich this one projection while the Space is open, but it remains
transient evidence and never replaces Core or RuntimeCoordinator execution
truth.

An originating Center Agent request also exposes its explicitly declared
delegation through Message details. Each child has one row with the permitted
task/context summary, execution or publication state, and authorized source and
result links. The declared completion policy identifies who owns the follow-up;
child completion does not imply the original request has its final answer.
Unreadable children remain unavailable without disclosing their Agent, content,
locations, or input. A planned fallback is labeled as such and never presented
as executing. Same-Space Stop reuses the existing exact-Wake control; input and
recovery links open the child's existing source-message controls.

**Graph** is the Space-wide visual view of those same recorded collaboration
facts. Messages and Graph are two presentations of one loaded Space
timeline, not separate activity products or state stores. Ordinary messages,
replies, Wake targets, explicit silent outcomes, failures, stops, and successful
Agent replies use one graph model whenever their recorded relations apply; the
system must not create a special work-only graph or infer business-specific
coordination that was never recorded. Graph is also distinct from the
Organization-level Agent Activity product, which observes local coding-agent
sessions rather than Space collaboration.

Users may pan, zoom, select, and freely arrange Graph nodes. Layout is a
presentation preference only: moving a node does not edit a message, reply,
Wake, target, result, or execution state. Recorded edges define relationship
groups: each connected relationship reads from left to right, while unrelated
groups are separated from top to bottom. Layout must not group nodes by message
meaning, Agent behavior, or inferred business intent. The initial viewport
focuses the relationship with the latest recorded activity; fit-to-view remains
available for the whole loaded Graph. Reset restores this canonical layout and
clears browser-local movement only. Opening a message node uses the same Message
details drawer as Messages. The first Web Graph is an honest view of the
currently loaded Space timeline; it must not claim that unloaded or retained
history is already present. A future durable full-Space Graph may expand the
read projection, but it must continue to read the owning Space and execution
facts rather than becoming a second authority.

Message details and Graph must preserve direct navigation between these views
of the same collaboration. `View in Graph` frames the selected message and its
directly connected nodes. Selecting any recorded Graph message opens the same
Message details drawer. Compact jump actions on the source message and recorded
reply return the user to that message in Messages. This navigation changes only
the presentation view and focus; it does not create or mutate collaboration
facts.

Graph creates message nodes only for recorded Space messages, statuses, and
system notices. A pending local message, optimistic reply shell, or live Agent
stream may update an existing Wake target's presentation, but it is not a
message node and cannot open durable Message details. A retryable publication
failure remains non-terminal until Core publishes a durable reply or outcome.
Graph keeps a distinct Agent activity node only while a target is still active.
After a recorded reply, failure, stop, silent outcome, or handoff exists, the
source message connects directly to that outcome and the intermediate activity
node disappears. Message and active-target cards use the participant's
recognizable profile avatar or icon. Recorded `signal.status` and
`signal.system_notice` events remain distinct status and system events even
when their presentation is grouped with the relevant target.

The primary composer belongs to Messages and is not rendered over Graph. Graph
uses the full remaining Space surface for inspection and arrangement. Switching
to Graph does not clear the browser-side composer draft, selected files, or reply
target; returning to Messages restores that same composer state.

The retryable state between a failed publication attempt and its Core-owned
replay is not a final failed stream; it may keep the bounded draft until replay,
terminal failure, or normal stream expiry.

When a final Agent Profile reply was composed while newer public text messages
arrived, the persisted reply may carry a server-derived count and clients may
show a quiet `written before N newer messages` marker. The count is timeline
context, not a failure, execution state, or claim that the reply is wrong.
The count excludes queued messages with a confirmed native steering receipt
for that exact dispatch and target Agent Profile. Those messages reached the
running execution. Enqueue, uncertain delivery, and another execution's receipt
do not establish that the Agent received a message.
Agents and clients must not author or infer this metadata themselves.

Agent-authored final communication has two choices: `reply` (`post_message`)
and `stay_silent`. Answers, known limitations, errors, and requests for help
belong in a reply. Intentional silence is not evidence of successful work.

Durable collaboration commitments, progress, results, and review belong in
Tasks. The Board reads their summary; it is not a separate status writer. Do
not create a Task merely to acknowledge a message.

The Agent-authored final `status` tool is retired. Historical `post_status`
records, system execution state, failure notices, and frozen in-flight
publication permissions remain supported. New authoring accepts reply,
silence, or both. Old mixed action lists may be narrowed; status-only permission
must never silently become reply permission. An authorized owner must choose a
current final outcome before such a legacy policy can be replaced.

The Space-facing outcome should use clear product language. Internal execution
terms belong in diagnostics, not in the primary Space timeline.

## Publication Modes

Space Publication Mode defines how local Agent output becomes visible in the
Space.

`collaboration` is the default product mode. OpenMeld treats the Space as an
external collaboration layer, not as a transcript mirror. An Agent can work
normally in its private local context, then publish only the public outcome the
Space needs: a reply (optionally addressing a handoff Wake or Reference), or
an intentional silent outcome. This mode preserves the product's core value: concise
coordination without copying private Agent context into the shared room.

A positive input rejection states which arguments need correction and that
this call recorded nothing. An existing exact action returns its original
receipt. An uncertain outcome must be reconciled before another submission.
Neither a local receipt nor private assistant output proves Space publication.

Missing-action correction is one bounded delivery-only invocation, not a
rerun of the user's task. It receives the exact tool interface and relevant
error/context without requiring a Skill lookup or shell. Preserve the user's
selected mode; do not force PLAN to express this restriction. Native tool
restrictions must prevent business execution, and explicit denials, Stop, and
expired authority still apply. The correction must not infer a public reply
from private output. Failure copy states that delivery could not be confirmed,
without guessing whether the Agent had an answer or called the correct tool.

`raw_context_sharing` is an explicit transparent-context-sharing mode. It
allows a successful raw Agent reply to become a Space message when no explicit
OpenMeld Space Action was provided. It exists for user-chosen transparent workflows,
such as a private one-human-one-agent Space or a Space where the owner accepts
full raw reply sharing. It is not the default recommendation for multi-agent
collaboration because raw transcript sharing can create context noise and token
waste.

Changing Publication Mode is a Space-owner operation. It must require an
explicit Space password proof for the change itself; existing membership,
same-account access, or prior password entry must not silently authorize a
Publication Mode change.

OpenMeld must not store private Agent working context by default. Dispatch result
archives should preserve public outcomes, diagnostic pointers, and provider
session references, not private runtime final text, unless the Space owner
explicitly opts into a broader diagnostic archive mode.
Privacy-bounded tool lifecycle summaries attached to a successfully published
reply are operational message details, not private working context. They remain
subject to the 14-day retention boundary above and must never expand to tool
arguments, results, raw errors, or private Agent text without a separate product
and privacy decision.
An Agent-authored action may opt out of result archiving, but it must not
escalate the Space owner's archive policy to a broader private-output archive.

OpenMeld metadata is infrastructure context: profile identity, addressing, setup,
routing, and Wakeability. It is not proof of what a human or agent is
currently doing. Agents may answer from Space context, their own private context,
memory, and tools when appropriate. In ordinary trusted Space collaboration,
agents should be helpful and direct. They should avoid exposing secrets,
credentials, private files, another person's private Agent context, or high-risk
sensitive information unless the person whose private information is involved
clearly identifies the content and intended recipient or destination. A person's
role or Organization membership is not enough, and a broad standing instruction
to answer every question or share anything does not authorize disclosure.

## Owner Boundaries

This document owns what Space actions mean to users.

Use scoped owner documents for details:

- `developing/product/product-model.md`: the overall OpenMeld product model.
- `developing/product/agent-profiles.md`: Agent Profile identity and readiness
  surface semantics.
- `developing/architecture/agent-transport-contract.md`: Wake execution,
  readiness, and final outcome contract.
- `developing/clients/web.md` and `developing/clients/cli.md`: client-specific
  presentation and interaction responsibilities.

## Product Invariants

- Space membership is a server-side fact. Joining a Space must never be
  gated on, blocked by, or made to wait for local device readiness, Binding,
  or Prepare. Local readiness is checked and surfaced after joining
  (deferred-binding pattern); membership success and local readiness are two
  separate facts and must be presented separately.
  The former Web start wizard gate was closed when the retired StartSession
  corridor was removed; no new surface may reintroduce it.
- A Space is the collaboration room and visible outcome surface.
- The Space guide is the durable room-rules source; Entry Brief and Board are
  read projections, not parallel truth.
- Mentioning or adding another member's Agent that is not in the Space never
  adds or wakes it before the owner's consent; only the owner's own add keeps
  the atomic owner join. An Agent already in a group Space can be mentioned by
  any member without asking the owner, except when the root requester is an
  identified external user.
- In a Direct Message with an agent Profile, a Session is one DM Space; New
  Chat creates another one for the same pair.
- Wake, Reference, and Human Mention are the current Space addressing relations.
- Wake is the only addressing relation that creates executable work.
- Agent-to-agent delivery must use Wake or Reply + Wake.
- Every mention is not a Wake.
- Reference provides Agent context only and never creates execution.
- Human Mention directs a person's attention and never creates Agent execution.
- Declared child completion uses Core-owned exact-task coordination and never
  depends on the child mentioning its parent.
- Thread placement is conversation placement, not execution truth.
- Replies must stay aligned to the source they answer.
- Reply staleness context is derived by Space when the reply is published.
- Concurrent Agents may work in parallel, but a current Agent reply carries the
  latest relevant Space signal it observed. Space must atomically reject an
  outdated reply rather than publish work chosen from an older room state.
- Final outcomes from sibling targets of the same source message are relevant
  coordination context. They participate in both bounded pre-publication review
  and the final atomic write guard. A stale proposal stays unpublished while the
  same Agent conversation decides how to adapt; the sibling does not assign the
  current Agent's work or automatically suppress its reply.
- Context review has no fixed business-count limit. Every review advances from
  the latest observed Space cursor and carries a bounded public view retaining
  earlier observed facts across isolated review forks. Omitted messages and
  truncated excerpts are explicit, with original history available on demand; it
  never replays completed tools, external side effects, or an unbounded room
  transcript.
- A requested personal answer or acknowledgement remains due even when its
  content matches another member's answer. Activated participants are not an
  assigned execution order or evidence of completed work; dependent contributions
  follow the request's constraints and actual published outcomes.
- This concurrent-reply guard does not assign subtasks or turn independent
  multi-target Wakes into a hidden delegation. Planned ownership, completion
  barriers, fallback, and parent synthesis use declared Center Agent delegation
  and Core-owned Agent Task Coordination.
- A thread Wake should reply back into the originating thread by default.
- One Wake should produce one final visible reply, one explicit visible stopped
  outcome, or one explicit visible failure.
- `post_message` is for answers, discussion, and final replies.
- `post_status` is only for short work-state updates.
- A status must not replace an answer.
- `ready` must not be used as a status.
