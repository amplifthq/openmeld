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

Files have a separate pin action in the Files browser. Pinned files appear at
the top of the Messages conversation, above pinned messages. Each kind has its
own compact preview and navigation; file and message pins never share a carousel.
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
button means shared unpin, not personal dismissal, and requires no confirmation.
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
visibly. An invitation is not a guest role or a computer connection request.

Better Auth remains the Organization invitation and membership writer. Core
owns the Space invitation intent and policy; the Space owns the membership
grant and an atomic accepted-or-revoked receipt. D1 status projects that receipt.
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
selecting an ordinary Agent also checks its owner. The count and checkmarks
agree before submission. Deselecting the last Agent removes an implicitly
selected owner; an explicitly selected owner remains selected. Deselecting an
owner also clears their selected Agents. Search filtering must not erase the
effective selection. Core still resolves the authoritative owner at mutation
time; these checkmarks are not permission facts.

An ordinary human-owned Agent Profile participates in an ordinary Space with
its owner. When a caller adds such an Agent, Core resolves the Agent's current
authoritative `ownerUserId` and that Organization member's active default Human
Profile, then submits the Agent and Human through one atomic Space membership
mutation. A cached owner name or caller-supplied Human Profile is never enough.
If the owner is already an active member, the Human addition is an idempotent
no-op. If Core cannot resolve the current owner and Human Profile, the whole add
fails instead of admitting an ownerless ordinary Agent.

Managed Agents, including the designated Center Agent, do not inherit this
rule. Their Organization-managed identity and existing specialized membership
contracts remain authoritative.

In an ordinary Space, the resolved owner is an ordinary active Human member
with the same collaboration rights as other members. The owner cannot leave or
be removed while one of their ordinary Agent Profiles remains active in that
Space; remove the Agent first. Removing the Agent never silently removes its
owner. This order keeps both actions explicit and prevents a membership cleanup
from unexpectedly removing a person.

Existing ordinary Spaces reconcile this invariant once inside the owning Space
when a current member/status snapshot is first read after the policy ships. The
Space checks each unmatched Agent against canonical Organization identity,
adds only missing ordinary-Agent owners, then records a local completion
marker. An unavailable owner identity leaves the marker unset so a later read
can retry. This bounded compatibility step updates the Space member projection
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

The observer may explicitly choose **Join conversation**. Core accepts only the
owner's exact active default Human Profile and uses the existing irreversible
Direct Message conversion transaction to add that Profile, set
`directMessage.convertedAt`, and turn the conversation into an ordinary Space.
After conversion, the owner is a normal member and may participate. This
observer and join behavior must not appear or succeed for Human-to-Human DMs,
Center Agent DMs, managed Agents, a different Agent owner, anonymous viewers,
or ordinary Spaces where the owner is already represented by an active Human
member.

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
projection does not expose or retain private agent context. Future opt-in
private streaming requires its own transient transport and privacy contract and
is not part of this read model.

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
Explicit folder creation, rename, move, and Trash restore remain organization
actions: when their requested destination name is occupied, they return the
explicit name conflict instead of silently changing the user's request.

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

The Space Files MVP does not project files into Resources/Documents or the
Center Agent Computer. A later explicit **Copy to Organization Files** action
may create a new Organization-owned file with clear provenance; it must not
create bidirectional synchronization, shared identity, or hidden write-through.

Web presents **Messages | Graph | Files** in one Space. Files opens at the Space
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

Send immediately stages the message with local attachment previews and frees
the Composer, including when uploads are still running. In the background it
waits for the captured attachment batch, publishes every upload as a canonical
root-level Space File, and posts the immutable revision references. A failed
attachment is never silently omitted. A failure before publication keeps the
message unsent with an explicit recovery path. File publication and message
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

Current DM state is derived from origin, membership, and the irreversible
conversion marker:

```text
isDirectMessage = purpose is openmeld_dm_space
  AND active member count is 2
  AND directMessage.convertedAt is absent
```

Active member count uses the same active membership semantics as the normal
Space member directory. This derived predicate is the single product meaning
used by navigation, headers, and dispatch planning. Do not reimplement local
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
checks the owning Space. Dedicated rename, archive and deletion remain future
session operations. Browser acceptance, explicit execution steering and release
continuity remain incomplete release gates. Task retirement is deferred; its
existing product and tools remain available during this upgrade.

### Ordinary Direct Message opening

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

In current DM state with exactly one active Human Profile and one active Agent
Profile, a text message authored by the human automatically triggers the agent
through the same dispatch decision as an explicit Wake. After the target is
selected, Binding kind chooses exactly one execution family: workstation
Bindings use outbox, Queue, RuntimeCoordinator, and readiness; the
`hosted:center-agent` Binding uses the Remote Agent native-delivery contract.
Neither path may fall back to or also run the other. The dispatch prompt
receives dynamic DM context telling the agent that the message is addressed
directly to it and no mention is needed. Agent-authored messages never
auto-trigger, even in a DM, to prevent agent-to-agent ping-pong. Human-human
DMs, converted DM-origin Spaces, ordinary two-member Spaces without DM origin,
and group Spaces keep the normal explicit Wake / mention behavior.

## Legacy Welcoming Spaces

The previous onboarding flow created Spaces with this legacy purpose:

```text
purpose = openmeld_welcoming_space
```

These Spaces are retained as historical data but are no longer a current
conversation mode. Current lists hide them, they do not auto-dispatch like Direct
Messages, and the composer must not present them as an `@`-optional agent direct
conversation. First-touch onboarding now belongs to the Center Agent DM.

Do not generalize legacy welcoming behavior to ordinary Spaces. An ordinary
Space with exactly one Human Profile and one Agent Profile keeps normal explicit
Wake / mention behavior unless it has DM origin.

## Weekly Quality Reports

The current weekly evaluation job publishes the official OpenMeld
Organization's settled metrics into one deterministic public Space named
`OpenMeld Quality`. The report is a system-emitted Space signal authored with
the current designated Center Agent presentation. It is not a Wake, a Center
Agent turn, execution evidence, or a second copy of Space truth. Report data
ownership belongs to `developing/architecture/data-and-observability.md`.

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
`accessMode = members_only` prevents a link visitor from viewing or joining.
Privacy-sensitive creation must set both values; neither one implies the other.
Any surface that presents both facts must label them as **Organization
visibility** and **link access**. A bare `private` or `public` label must not be
presented as the privacy state of the whole Space because it answers only one
of those two questions.

New Space creation deliberately initializes the two independent facts together
through the shared initial-access policy: Organization visibility `private`
starts with link access `members_only`, while Organization visibility `public`
starts with link access `public`. Core persists that canonical pair and clients
use the same policy to explain the pending creation before it is submitted.
This is creation policy, not a permanent derivation rule: after creation,
visibility and access mode remain independently owned facts.

OpenMeld has four access modes:

- `members_only`: only an active member, the creator, or another active Profile
  owned by the same account can view the Space. New participants must be added
  explicitly.
- `public`: anyone with the link can view the Space and join.
- `public_view_join_password`: anyone with the link can view the Space, but
  joining requires the Space password.
- `protected`: viewing and joining require the Space password.

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
creators, or their local agents.

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

Reference includes an Agent Profile as message context without assigning work.
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

An ordinary Space's main composer may recommend the single Agent the current
Human last explicitly woke after that Agent replies. The suggestion is not an
addressing target. Click or Tab accepts it as an ordinary Wake token; ignoring
it sends an ordinary message. Explicit dismissal suppresses the corresponding
post-send suggestion. Other members' Wakes and ambiguous multi-target turns do
not select the target.

When that suggestion was ignored at send, only the sender sees a dismissible
ordinary Agent token labeled `Click to wake` below their latest sent message.
Clicking it directly saves an edit with that Agent's first Wake, without opening
an editor, asking for another selection, or requiring another save. Failures
remain beside the suggestion for retry; repeated clicks cannot dispatch twice.
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

Reactions share one row with message actions beneath their source message, before
its thread preview. On self-authored messages the row starts at the bubble’s left
edge and stays within its width. Overflow reactions appear in a +N pill that
opens on hover or click. Emoji groups retain their first-added order while any
member still uses them; a fully removed group returns at the end if added again. The
message action bar opens a compact set of common emoji and an optional full
picker. Existing reactions show counts and the viewer's selected state. Members
can inspect who reacted, including a paginated complete list when needed.

Reactions are quiet feedback. They do not create messages, unread activity, Wakes,
task completion, or execution approval. Removing the last reaction removes its
chip. Failed changes restore the confirmed state and offer a retry.

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

If a user Wakes an Agent Profile from a thread, the Agent Profile's reply should
default back to that same thread. The user asked from that local conversation,
so the visible answer belongs there.

Opening a thread under a main-timeline Wake does not move the running Wake's
reply or its message-review scope into that thread. The root remains a main
message, while also being a valid starting point for reading its thread.

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

For a main Space Wake, the final reply, explicit stopped outcome, or explicit
failure belongs in the main Space conversation. For a thread Wake, it belongs in
that thread by default.

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

Only the account that authored the Wake's source message or the target Agent
Profile's owner may stop that Wake, and they must still have writable Space
access. Space membership, Space creation, or Organization administration alone
does not grant this permission. Other members can follow progress but cannot
interrupt the work. Signing in to several accounts on one computer does not
combine their permissions. This rule covers queued, running, and native-delivery
Wakes; each target of a multi-Agent Wake is authorized separately.

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
It starts with compact animated `Sending to Agent…` copy while the handoff is
pending, then updates that same status row in place to `Agent is working`. The
row reserves one stable Stop-control slot so Stop eligibility can change without
moving the conversation. The shell makes no tool, reasoning, or final outcome
claim and is not independent execution authority.
It must not be persisted, recovered as conversation history, or reused in an
ordinary Space or thread. An authoritative stream projection, durable reply,
stopped notice, failure notice, or ended Wake presentation removes it.

Agent reply work summaries follow the same rule for hosted Center Agents and
workstation Local Agents. A Space may show one compact live **Work summary**
from a privacy-bounded tool lifecycle part only when the part carries an
admitted semantic work meaning. The row is a transient projection and must not
expose or derive copy from a technical tool name, orchestration wrapper, tool
input, output, raw error content, command, path, or private Agent text. A
meaningless wrapper such as Code Mode is hidden; admitted inner work may still
appear after the inner tool succeeds. An inner error stays in the execution
outcome and must not become a Work summary row. Unknown work has no generic
fallback.

The Work summary replaces the existing progress row while visible instead of
adding a second status row, defaults closed while work is active, groups
consecutive identical work, and stays inside a bounded scroll viewport. A user
who scrolls up controls their reading position until they explicitly jump to
the latest step. A single failed admitted step is named explicitly in the final
collapsed summary; multiple failures show a count and a direct details cue
instead of vague `had a problem` copy. When an Agent successfully publishes a final reply, that
durable Signal may retain an ordered work projection containing only admitted
semantic work, lifecycle states, technical compatibility names, and truncation
evidence. The final answer renders first; its Work summary follows and defaults
closed. Separately, Message details may retain the same bounded semantic work
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
Agents and clients must not author or infer this metadata themselves.

Agent actions in a Space must preserve the difference between an answer and a
work-state update.

Use `post_message` for answers, discussion, final replies, and anything the user
should read as message content.

Use `post_status` only for short explicit work-state updates.

A status is not an answer. Do not put final replies, discussion, or long content
in `post_status`.

Never use `ready` as a status. Readiness is a product readiness claim, not a
Space work-state update.

The Space-facing outcome should use clear product language. Internal execution
terms belong in diagnostics, not in the primary Space timeline.

## Publication Modes

Space Publication Mode defines how local Agent output becomes visible in the
Space.

`collaboration` is the default product mode. OpenMeld treats the Space as an
external collaboration layer, not as a transcript mirror. An Agent can work
normally in its private local context, then publish only the public outcome the
Space needs: a reply, status, handoff Wake, Reference, or an intentional
silent outcome. This mode preserves the product's core value: concise
coordination without copying private Agent context into the shared room.

If a Local Agent completes its work but forgets to record that public outcome,
OpenMeld quietly reminds the same private Agent conversation once. The reminder
asks only for the missing Space Action; it does not rerun the work, replace the
Agent's answer, copy the private answer into the Space, or ask the member to
approve a shell command. The Wake still produces exactly one recorded reply,
status, silent outcome, or explicit failure through the normal publication
path.

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
