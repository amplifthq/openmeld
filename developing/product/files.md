# Files

## Agent Context

- Purpose: Define the shared Files product across Team, member-private, and Space locations.
- Read this when: Changing file ownership, audience, human or Agent access, file versions, copy, or managed content presentation.
- Update this when: Files ownership, authorization, managed content, or Agent access rules change.
- Do not use this for: Space membership, Skill release validation, or private Computer isolation rules.
- Source of truth: This document owns Files product semantics. Space collaboration owns Space membership; Organization Skills owns Skill identity and release rules.

> Current Files contract. Existing Space Files, the shared browser and Office viewers, Team/member metadata and content routes, resumable Team/member uploads, the Team Files page, Local Agent CLI access and exact-revision copy between Team, My, and Space locations, and Hosted Agent Team file list/read/text-save tools are implemented. New Skill releases store resources as separate immutable R2 objects, while legacy inline releases remain readable. Hosted Agents fetch individual Skill resources on demand; authenticated members can read a release catalog without loading resource bodies. Existing approved knowledge appears as a protected Team Knowledge folder inside Team files and uses the shared browser, while its original writer and review rules remain in force. The knowledge content has not moved onto the shared file root. Team → Skills remains the single Skills product entry point. A member can read one exact release resource through an authenticated, integrity-checked content route. Hosted Agent private-file access depends on private Computer isolation.

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
- Team and My files accept files dropped anywhere in the active browser. An empty folder offers the same upload through an accessible browse control; both entries use the ordinary upload transport and show its progress and errors.
- Folders, file names, metadata, history, Trash, restore, and audit use the same behavior where Team, My, and Space semantics match. Deletion is recoverable until a separate retention policy says otherwise.
- Team Files presents Trash as a Files tab. The Trash location selector keeps Team and My audiences separate; restoring an item returns it to its owning root.
- Creating a file or folder with an occupied sibling name keeps both items by assigning the new item the next available numbered name in the owning root. The committed response shows that name. Explicit rename and move still report a collision rather than silently renaming an existing item.
- Ordinary Team members may contribute ordinary files to Team files. My files require the owning member. Space writes continue to use Space policy. Server-side authorization owns every operation; hiding a UI control does not grant or revoke authority.
- File content and metadata are read through an authenticated, bounded endpoint. A stored object key is never an access token.
- The small-content route accepts at most 10 MiB per upload or revision. Larger files use the shared resumable multipart transport, with per-part checksums, recovery, and a final metadata commit after the stored object is complete.

Copying an exact revision to another root requires an authorized source read and destination write. The result gets a new identity, destination audience, revision history, and provenance; it does not follow later source edits. The UI calls the action **Copy to Space** or **Copy to Team** and shows the destination audience. A Team file may be read directly by an authorized member or Agent working in any Space of that Team; it needs a copy only when the file itself should become visible to that Space's participants, including guests. A personal or private Skill shared with a Team follows the same explicit publication boundary.

Live references, automatic cross-root synchronization, cross-Organization browsing, public links, desktop sync, and per-file ACL inheritance are outside the first complete Files path. They must not be simulated by a copy that looks linked.

An explicit human selection can copy an excerpt of the author's own Space
message through `POST /v1/spaces/:spaceId/files/excerpts` or
`openmeld files copy-excerpt`. The request names the exact source message,
content version, author, Unicode character range (end exclusive), and every
destination member. The current human must be that author. Only the selected
plain text is copied; adjacent messages, reply context, attachments, and other
authors' text are not fetched into the copy. Selections are limited to 16,000
characters. Source access and version are checked again after object storage.
The destination must be private, members-only, invite-only, and have exactly
the named members; the Files owner rechecks that audience at metadata commit.
An Agent-authored request cannot grant itself this sharing authority. A lawful
copy has its own Files identity and lifecycle: subsequent source recall does
not delete it. Revocation before copying refuses the operation. This entry
does not add anyone to the source conversation or create cross-root revocation.

## Managed content

Files can show managed objects, but ordinary file mutations never bypass their owning workflows.

- A published Skill release remains a complete, portable, immutable bundle. Team → Skills owns its catalog, instructions, resources, installation, enablement, versions, and maintainers. Skill storage may use Files infrastructure without creating another Skills tab in Team → Files.
- A Team Brief, approved context item, or Profile Report retains its explicit role, approval, and context-admission rules. A Markdown file does not become approved knowledge by being moved to a special folder.
- Team Knowledge is a protected folder in Team files. It presents the existing approved knowledge and managed report folders in the same file browser; users cannot rename, move, or trash the Team Knowledge folder. Its contents retain their original writer and approval rules until their storage cutover is complete.
- There is no enduring Organization Documents product. Its useful Brief, knowledge, draft/review, and report behavior moves into managed Files roles. Existing internal documents may be copied or recreated pragmatically; there must be no parallel body writer after cutover.

## Human and Agent experience

Team and Space use the same Finder-style file browser and shared viewer components, with OpenMeld's Fluid controls, tokens, and radius. A file browser fills its owning page rather than adding a second framed application inside it. The initial viewer set is read-only; editors are added only after version, conflict, and save behavior is correct. Viewer availability is separate from Agent read capability.

Center, Hosted Remote, and Local Agents use the same logical file operations and exact revision references as people. The root service enforces the represented human's authorization at the time of each read or write. A private file may enter a Hosted Agent turn only when the audience and execution path keep it private. A one-to-one conversation alone does not prove that a shared Computer, cache, history, or published output is isolated.

Skill instructions load on activation and individual resources load on demand from an immutable release. Neither a model-side lazy API nor a UI preview proves backend lazy retrieval; storage fetches and decoding must also be deferred. Storage, upload, package validation, enabled catalog, and task working-set budgets remain separate.

## Implementation boundary

Share the file repository, upload transport, revision and conflict rules, authorization vocabulary, file picker, browser, and Agent access contract only where their semantics match. Existing Space files remain owned by their Space Durable Object. New Team and member roots each have one metadata writer and private R2 revision objects. The UI and Agent interface may span roots; an ordinary write always goes to the one owning root.

An explicit root identity contains its Organization and kind (`team`, `member`, or `space`), with a member or Space ID when required. All public and Agent operations resolve and authorize this identity before reaching storage. A file path is a display and navigation property, not an authority token.

The first production claim requires an authenticated user to upload, locate, read an exact revision, create a new revision with conflict handling, recover a trashed item, and copy between authorized roots. A current member and an Agent acting for that member must see consistent permission results. A revoked member must lose read access even to a previously selected revision.
