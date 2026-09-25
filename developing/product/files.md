# Files

> Target contract for the Files work in Draft PR #1318. Only existing Space Files and the first shared browser slice are implemented. The Team, member-private, Agent, Skill, and Documents cutover paths below are acceptance requirements, not current capabilities.

## Agent Context

- Purpose: Define the shared Files product across Team, member-private, and Space locations.
- Read this when: Changing file ownership, audience, human or Agent access, file versions, copy, or managed content presentation.
- Source of truth: This document owns Files product semantics. Space collaboration owns Space membership; Organization Skills owns Skill identity and release rules.

## Product model

Files is one familiar product with several clear locations, not a single list that mixes audiences. Every file has exactly one canonical root and one immutable sequence of content revisions. The navigation name is **Files** in Team and Space. A personal Organization has its own Files entry. A member of a collaborative Organization can also open **My files** in that Organization.

| Location | Canonical tenant and root | Default audience |
| --- | --- | --- |
| Team files | Organization, Team root | Current Organization members |
| My files | Organization, one member root | That member only |
| Space files | Organization and Space, existing Space root | Authorized Space participants |
| Personal Files | Existing permanently solo personal Organization | Its sole member |

The organization remains the only tenant type. My files in a Team are private **within that Team**; they do not follow an account across Organizations. Team administrators do not gain ordinary read access to another member's private root. Exceptional recovery, retention, and offboarding need a separate explicit and audited policy. A personal Organization never silently authorizes a Team Agent to read its files.

The user must always see the current location and audience before adding content or copying it elsewhere. An Agent acting for a person has the same effective file permissions as that person, constrained by the current conversation audience and runtime isolation. Agent identity does not create an additional owner or a bypass around the human's authorization.

## Ordinary file contract

- A file or folder has a stable identity and one root. Folder placement does not grant access to another root.
- Content revisions are immutable. Writes state the expected current revision; a conflicting write fails visibly. An exact revision can be read again if current authorization still permits access.
- Upload sessions, chunks, checksums, resumability, and retry handling use the shared file transport. A completed upload is not reported before its metadata revision is committed.
- Folders, file names, metadata, history, Trash, restore, and audit use the same behavior where Team, My, and Space semantics match. Deletion is recoverable until a separate retention policy says otherwise.
- Ordinary Team members may contribute ordinary files to Team files. My files require the owning member. Space writes continue to use Space policy. Server-side authorization owns every operation; hiding a UI control does not grant or revoke authority.
- File content and metadata are read through an authenticated, bounded endpoint. A stored object key is never an access token.

Copying an exact revision to another root requires an authorized source read and destination write. The result gets a new identity, destination audience, revision history, and provenance; it does not follow later source edits. The UI calls the action **Copy to Space** or **Copy to Team** and shows the destination audience. A Team file may be read directly by an authorized member or Agent working in any Space of that Team; it needs a copy only when the file itself should become visible to that Space's participants, including guests. A personal or private Skill shared with a Team follows the same explicit publication boundary.

Live references, automatic cross-root synchronization, cross-Organization browsing, public links, desktop sync, and per-file ACL inheritance are outside the first complete Files path. They must not be simulated by a copy that looks linked.

## Managed content

Files can show managed objects, but ordinary file mutations never bypass their owning workflows.

- A published Skill release remains a complete, portable, immutable bundle. Skills owns install, validation, enablement, version selection, and maintainers. Files may browse its instructions and resources, then open the Skills workflow for management.
- A Team Brief, approved context item, or Profile Report retains its explicit role, approval, and context-admission rules. A Markdown file does not become approved knowledge by being moved to a special folder.
- There is no enduring Organization Documents product. Its useful Brief, knowledge, draft/review, and report behavior moves into managed Files roles. Existing internal documents may be copied or recreated pragmatically; there must be no parallel body writer after cutover.

## Human and Agent experience

Team and Space use the same Finder-style file browser and shared viewer components, with OpenMeld's Fluid controls, tokens, and radius. A file browser fills its owning page rather than adding a second framed application inside it. The initial viewer set is read-only; editors are added only after version, conflict, and save behavior is correct. Viewer availability is separate from Agent read capability.

Center, Hosted Remote, and Local Agents use the same logical file operations and exact revision references as people. The root service enforces the represented human's authorization at the time of each read or write. A private file may enter a Hosted Agent turn only when the audience and execution path keep it private. A one-to-one conversation alone does not prove that a shared Computer, cache, history, or published output is isolated.

Skill instructions load on activation and individual resources load on demand from an immutable release. Neither a model-side lazy API nor a UI preview proves backend lazy retrieval; storage fetches and decoding must also be deferred. Storage, upload, package validation, enabled catalog, and task working-set budgets remain separate.

## Implementation boundary

Share the file repository, upload transport, revision and conflict rules, authorization vocabulary, file picker, browser, and Agent access contract only where their semantics match. Existing Space files remain owned by their Space Durable Object. New Team and member roots each have one metadata writer and private R2 revision objects. The UI and Agent interface may span roots; an ordinary write always goes to the one owning root.

An explicit root identity contains its Organization and kind (`team`, `member`, or `space`), with a member or Space ID when required. All public and Agent operations resolve and authorize this identity before reaching storage. A file path is a display and navigation property, not an authority token.

The first production claim requires an authenticated user to upload, locate, read an exact revision, create a new revision with conflict handling, recover a trashed item, and copy between authorized roots. A current member and an Agent acting for that member must see consistent permission results. A revoked member must lose read access even to a previously selected revision.
