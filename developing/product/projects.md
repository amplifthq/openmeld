# Projects

## Agent Context

- Purpose: Own the Projects product contract for Organization-scoped Project
  identity, local Project connections, permissions, discovery, Project-aware
  Agent work, privacy, and compatibility boundaries.
- Read this when: Changing Project creation, editing, removal, repository
  identity, local folder discovery or connection, Default Project behavior,
  Project API ownership, Project-aware Wake behavior, or Project navigation.
- Update this when: Project authority, lifecycle, local connection invariants,
  discovery semantics, privacy, compatibility, or cross-product consumption
  changes.
- Do not use this for: Agent Activity evidence semantics, Agent Profile identity,
  RuntimeCoordinator execution authority, Route Registry lane selection, or
  low-level schema implementation.
- Source of truth: Product meaning and non-negotiable boundaries for OpenMeld
  Projects.

## Product Promise

Projects is a first-class OpenMeld destination for managing the code Projects
shared by the current workspace and the local connections to those Projects on
the current user's computer.

It answers four user questions:

1. Which Projects exist in this workspace?
2. Which Projects have been found or connected on this computer?
3. Which clones or worktrees on this computer belong to each Project?
4. Can I choose a Project when starting an Agent instead of repeatedly entering
   a local path?

The user's intent is “work in this OpenMeld Project,” not “configure this path.”
OpenMeld resolves that intent to the correct working folder on the current
computer.

Projects promotes the existing Agent Activity Project foundation. It preserves
existing Project IDs and Activity history while moving Project ownership into
its own product. It must not create a second Project model, duplicate Project
CRUD, or reinterpret existing Activity evidence.

## Domain Model

### Project

A Project is the Organization-scoped cloud identity for one code project. It
may carry a safe canonical Repository URL and its stable repository
fingerprint, but it never contains an absolute local path.

### Repository Identity

Repository identity is a fingerprint used to decide whether local Git
repositories belong to the same Project. OpenMeld also stores the normalized
HTTPS Repository URL so people can see which repository they configured and
edit it without re-entering it. The original pasted value is never stored:
credentials, query, fragment, protocol-specific syntax, surrounding slashes,
and the `.git` suffix are removed before upload. Core recomputes the fingerprint
from that safe URL and rejects a mismatched pair atomically.

### Local Project Connection

A Local Project Connection is one local directory connected to one Project in
the current OpenMeld lane on the current computer. It is an owner-self,
device-local, lane-local execution fact. One Project may have many Local
Project Connections, including a normal clone and multiple worktrees.

One canonical local folder may belong to only one Project scope at a time,
even across Organizations. Route Registry remains a separate global map from a
repository path to one OpenMeld lane root; it resolves lane ambiguity and must
never become a second Project-connection truth. A user may explicitly move a
folder to another Project after OpenMeld identifies the existing connection,
explains the impact, and receives a second confirmation.

### Default Local Project Connection

The Default Local Project Connection is the folder used by default to start new
Agent sessions for that Project on this computer. A non-empty Project connection
group has exactly one default after every product mutation.

### Project Candidate

A Project Candidate is a local directory that OpenMeld discovered as a possible
match. It is not user-confirmed, is not a Local Project Connection, and cannot
report Agent Activity.

### Default Project

Default Project is an Organization-scoped cloud preference on a local Agent
Profile. It tells OpenMeld which Project future Wakes and new sessions should
use by default. It is not a local path, is not a permanent assignment, and does
not move an existing session.

### Working Folder

A Working Folder is the absolute directory used by one local execution. The
current computer resolves it from its own Local Project Connections. It is
owner-self local execution information, not Project or Agent Profile cloud
identity.

## Navigation And Product Home

Projects keeps its canonical product home but is temporarily absent from the
primary rail. Existing direct and contextual links remain available. This
interim change does not relocate Projects or decide its future placement; the
complete primary-rail grouping and order belong to
`developing/clients/web.md`.

Project content follows the selected Organization. Personal workspaces and
multi-member Organizations both have Projects, and switching workspaces keeps
the user in the corresponding Projects destination.

The Use vs. Configure placement rationale belongs to the Web navigation owner,
`developing/clients/web.md`.

The MVP uses a flat, full-width Projects card grid and Project detail page. It
has no inner sidebar. Cards may reuse the shared grid, card shell, and add-card
contract, but Project content remains Project-specific.

Canonical Web routes are:

```text
/o/{orgSlug}/projects
/o/{orgSlug}/projects/{projectId}
```

Detail identity uses immutable `projectId`, not an editable and reusable slug.
The slug remains a stable CLI reference and supporting display value.

## Projects Surface

The home uses one stable **Add a Project** card. It must not duplicate that
action in the page header, sidebar, empty state, and grid. Each Project card
shows only its name, disambiguating slug, repository-configured state,
current-computer connection state, default local folder, and **View details**
action. The action always opens the Project detail route; it never implies that
the browser will open a local folder or desktop app. Project names need not be
unique; matching names always show their different slugs.

The detail route is one continuous page with no tabs:

- **Project**: name, slug, saved safe Repository URL or an explicit legacy
  URL-unavailable state, creator, and Edit;
- **This Computer**: computer name, Service state, discovery state, default
  folder, additional folders or worktrees, Connect folder, Add another folder,
  Make default, and Remove connection;
- **Related**: a filtered link to Agent Activity; and
- **Danger Zone**: Remove Project only when the server projection allows the
  owner or qualifying creator to act.

Projects links to filtered Activity and related Agent Profile surfaces instead
of duplicating Activity lists, Agent Profile lists, Organization members,
session history, or statistics dashboards.

Current-computer presentation distinguishes these states:

- **Checking this computer**: one bounded discovery is running; **Connect
  folder** remains available.
- **Matching folders found**: one or more candidates need confirmation and do
  not yet enable Activity. The user may select one or more matching folders.
- **Folder connected**: the default connection exists and its folder
  is available.
- **Default folder unavailable**: the saved default folder is unavailable.
- **No matching folders found**: discovery completed normally with no match.
- **Couldn’t verify folders**: Git, Command Line Tools, permissions, or a
  timeout prevented reliable verification. This is not “Not found.”
- **Couldn’t check this computer**: OpenMeld Service is connected, but this
  discovery request failed. The page keeps Service state truthful and offers
  **Check again**.
- **OpenMeld Service unavailable**: the current Service cannot be reached. This
  is neither “Not found” nor a Git failure.

Service connectivity and Project discovery are two separate facts. Projects
reads the current `localRuntimes` target and `localProjectControl` capabilities;
it does not gate filesystem discovery on Space reply readiness. A failure from
Project discovery is classified by its Project-control error code and must not
be rewritten as Service unavailable unless the authoritative operation reports
`service_offline`.

Web names the Project mutation **Connect folder**. When the current Service
advertises Local Folder Picker, the connection dialog's primary input action is
**Choose a folder on this computer**. The Service opens the operating system's
folder chooser on the named current computer and returns only the person's
selection. Selecting a folder does not connect it: Web places the exact path in
the draft, then **Check and connect** uses the existing Project-control writer.

The same dialog may offer matching discovered folders as a secondary shortcut.
**Enter path manually** is the final fallback and stays available when native
selection is unsupported or the computer has no interactive desktop session.
Cancellation closes only the operating-system chooser and leaves the Project
unchanged.

```text
Connect OpenMeld on this computer

[ Choose a folder on this computer ]

Selected folder
openmeld
/Users/felix/Desktop/work/openmeld

[ Add a matching folder ]
[ Enter path manually ]

OpenMeld will validate it on that computer.

[Cancel] [Check and connect]
```

Connection failures use these stable messages:

- Empty or relative path: `Enter the full folder path on this computer.`
- Missing path: `OpenMeld couldn’t find that folder on this computer. Check the
path and try again.`
- Not a directory: `That path is not a folder. Enter the Project’s folder
path.`
- Unreadable directory: `OpenMeld can’t read that folder. Check its permissions
and try again.`
- Project has a fingerprint but the folder is not Git: `This Project has a
saved repository identity, but this folder is not a Git repository.`
- Repository fingerprint mismatch: `This folder belongs to a different Git
repository. Choose the folder that matches this Project.`
- Required Git tools unavailable: `OpenMeld can’t verify this repository
because Git tools aren’t available on this computer. Install Git tools, then
try again.`
- Service offline: `OpenMeld Service is not connected on this computer.
Reconnect it, then try again.`
- Service update required: `Update OpenMeld Service on this computer before
connecting Project folders from the Web.`
- Timeout: `This computer didn’t finish checking the folder. Try again.`

When a folder is already connected to another Project, Web opens a second
confirmation instead of presenting a dead end. It names the conflicting
Project slug, distinguishes the current Organization from another
Organization, and states the effect on the old Project before offering the
move:

```text
Move this folder to Project name?

This folder is currently connected to the “project-slug” Project in another Organization. Moving it here disconnects it there.

Agents using that Project on this computer won’t be able to start until another folder is connected.

[Keep current connection] [Move folder]
```

If the moved folder is the old Project's default and other connections remain,
OpenMeld states that another connected folder will become the default. If the
moved folder is an additional connection, OpenMeld states that the old default
will not change.

When a Project has no fingerprint and the selected folder is not a Git
repository, Web may offer **Connect anyway** only after a second confirmation
that automatic matching and worktree discovery will be unavailable. When a
Project does have a fingerprint, a non-Git folder or mismatched origin is
rejected.

```text
OpenMeld couldn’t verify this folder with Git. You can still connect it, but automatic matching and worktree discovery won’t be available.

[Go back] [Connect anyway]
```

Missing connections remain user-controlled. One missing folder shows its path
with **Locate folder** and **Remove connection** under:

```text
This folder is no longer available on this computer.
```

If the missing folder is the default while another healthy connection exists,
the product says:

```text
Choose another connected folder as the default before removing this one.
```

When at least two connections are missing, **Remove missing connections**
requires confirmation. OpenMeld never auto-cleans them because a worktree,
external drive, or network volume may return.

At the 500-active-Project limit, creation fails with:

```text
This workspace already has 500 active Projects. Remove an unused Project before adding another.
```

## Cloud Authority, Permissions, And Lifecycle

The Organization-scoped D1 Project record is canonical durable Project truth,
and Core is its only product writer and final mutation authority. Every
mutation is authenticated, scoped to the current Organization, and carries an
`expectedOrganizationId` fail-closed check. A client-supplied Organization ID
never grants authority.

All active Organization members may:

- view and create Projects;
- connect their own local folders and worktrees; and
- edit Projects they created.

The current Organization owner may edit and remove any Project. An admin may
create Projects and edit Projects they created, but may not remove Projects.
“Organization creator” means the current owner; Projects does not add a
permanent `organizationCreatorUserId` authority.

When removal is owner-only, the product says:

```text
Only the organization owner can remove this Project.
```

A member who created a Project may remove it only while no Agent Activity
evidence is associated with it. Once any event, session, digest, daily
aggregate, daily session key, or execution-link association exists, only the
Organization owner may remove it. The authority check and Activity ingest use
two server-side atomic fences:

- archive first: the later event is rejected and not stored;
- event first: the member creator's later removal returns `has_activity`.

Tests prove those deterministic archive-first and event-first D1/miniflare
interleavings. They must not claim to be a concurrent stress test.

When the creator grace rule is no longer available, the product says:

```text
This Project already has Activity. Only the organization owner can remove it.
```

User-facing removal is always **Remove Project** and writes a terminal soft
archive. There is no hard delete or unarchive in the MVP. A removed Project no
longer appears in active lists, accepts connections or Activity, or starts new
sessions. Existing Activity remains traceable under its normal retention.

Active slugs are unique within one Organization. Archived Projects retain their
historical slug but release it for reuse through an active-row partial unique
index. At most 500 Projects may be active in one Organization.

## Names, Slugs, And Repository Fingerprints

The primary creation form contains **Project name** and optional **Repository
URL**. A collapsed Advanced section exposes the generated **CLI slug** for
users who need to edit it.

The shared slug algorithm trims the name, applies Unicode NFKD, removes
combining marks, lowercases it, replaces consecutive non-ASCII-alphanumeric
characters with one hyphen, trims surrounding hyphens, limits the result to 80
characters, and falls back to `project` when empty. Core is final authority.
Web may preview the same shared algorithm; CLI may supply an explicit slug.

Core allocates ordinary conflicts atomically with `-2` through `-99` suffixes,
counted within the 80-character limit. If all candidates through `-99` conflict,
Core returns 409 and asks for a different CLI slug. An explicitly edited slug
returns the normal 409 conflict directly. Renaming a Project does not change its
slug unless the user edits the slug explicitly.

Shared Project algorithms belong in `packages/projects`; strict shapes remain
in `packages/schemas`. The safe Repository URL and repository fingerprint use
the same normalization algorithm, which:

- accepts Git, HTTP, HTTPS, SSH, and SCP-like remotes;
- strips credentials, query, fragment, surrounding slashes, and a `.git`
  suffix;
- lowercases the host and preserves an explicit non-default port;
- normalizes path Unicode to NFC;
- lowercases paths only for `github.com`, `gitlab.com`, and `bitbucket.org`;
- preserves path case for other hosts; and
- rejects `file:` URLs, local paths, Windows drive paths, and UNC paths.

The stored display value is `https://{normalized repository identity}`. Existing
fingerprint-only Projects remain valid and show **Configured · URL unavailable**
until a manager enters the Repository URL once. A fingerprint is irreversible,
so OpenMeld must not invent or guess that missing URL.

Changing the canonical normalization to preserve ports and lowercase paths on
the three public hosts is a breaking fingerprint cutover. M0 installs the new
rule once without dual-version matching. Every dogfood Project carrying an old
fingerprint must be edited once through Repository URL to recompute it, then
discovery must be smoked. The Contract Impact Audit records both the break and
the remediation; a mismatched old fingerprint must never be silently described
as “Not found.”

## Local Connection Store

`project-bindings.json` v3 represents one Project to many connections. Each row
keeps `bindingGeneration`, `boundAtMs`, `organizationId`, `projectId`,
`projectSlug`, nullable `repositoryFingerprint`, absolute `repositoryPath`, and
`isDefault`.

Product writes preserve these invariants:

- one canonical path appears in only one Project scope;
- one Project has at most one default;
- the first connection becomes default automatically;
- removing the default atomically chooses a replacement or removes the empty
  group; and
- a replacement that changes connection identity updates
  `bindingGeneration`.

`bindingGeneration` is both connection identity and the optimistic lock for
local mutations. Updating a connection, making it default, or removing it must
present the current `expectedBindingGeneration`; a stale generation fails
instead of applying last-write-wins behavior.

The v1 reader remains. A v2 single binding parses in memory as v3 with
`isDefault = true`, retains its path and Activity attribution, and writes v3
atomically on the first real mutation. `setup` and `doctor` may migrate it
proactively and report that action. No sidecar store is introduced.

A reader that encounters a newer unknown version fails closed with
`project_bindings.update_required`. An old writer must never downgrade,
collapse, or overwrite a newer store. The same-machine CLI/Service
update-required version gate must be active before any v3 producer, and
v1/v2/v3 consumers ship before v3 mutations are exposed. Daemon capability
gating alone cannot protect an old CLI writer.

When a Project is archived, local cleanup removes every Local Project
Connection for that Project, including all clones and worktrees, and clears
their unsent Activity. It must not leave a stale binding to a terminal Project
or collapse the group to one surviving path.

Stale connections are never removed automatically because worktrees, external
drives, and network volumes may return. Projects discovery warns that a folder
is missing; dispatch preflight revalidates the default connection before every
unattended Wake and is the final authority.

## Current-Computer Discovery And Connection

Web never reads the local filesystem. Project operations use a sibling
`localProjectControl` capability over RuntimeTransportHub's authenticated
current-device request-response path:

```text
discoverProjects
connectCandidate
connectDeclaredPath
```

One discovery request checks the canonical Projects for the current
Organization. Core reads those Projects and sends only Project IDs and saved
fingerprints to the current daemon; Web does not submit fingerprint authority.
The result distinguishes connected, connected-folder-missing, found,
not-found, and verification-unavailable states. Candidate count is derived from
the candidates array rather than stored as duplicate state. Web reuses this
Organization-wide current-computer result across Projects home, Project detail,
and Agent Profile Project controls for 30 seconds. Absolute paths remain only
in that in-memory current-device cache and are never written to cloud state.

Discovery never scans the entire disk. It gathers known paths from existing
connections, supported provider session working directories, Agent Profile
workspaces, user-declared paths, and `git worktree list` for already confirmed
repositories. Git verifies and canonicalizes those candidates; it is not a disk
crawler. On macOS, the daemon checks Command Line Tools without triggering the
system installation dialog.

Each Git subcommand has a 10-second timeout, Git work is limited to four
concurrent operations, the daemon has a 25-second total discovery budget, and
the RuntimeTransport waiter returns 504 after 30 seconds. Every Web surface
uses one request for all active Projects. Navigation reuses a fresh in-memory
result; **Check again**, a changed Project catalog, or a changed current target
starts a new request. A background recheck keeps the
last result visible and reports a refresh failure without replacing it with a
false empty state. There is no persistent high-frequency scan or independent
process pool per card.

`connectCandidate` accepts only a candidate from the current discovery epoch.
`connectDeclaredPath` accepts an explicit absolute path for the current device.
Both canonicalize the directory, enforce cross-scope path uniqueness, verify
Git identity when a Project has a fingerprint, and write through the local
connection single writer. A Project without a fingerprint may connect a
non-Git folder only after a second confirmation.

A path conflict returns the conflicting Project slug, whether it belongs to
this or another Organization, the move impact, and an opaque confirmation
token. Web must not send that token until the user chooses **Move folder**.
The local single writer accepts the move only while the conflicting connection
snapshot still matches the token and the request still names the confirmed
Organization, Project, and canonical path. It then atomically removes the old
connection and creates the new one. If the old default is moved while other
connections remain, the writer deterministically promotes another connection
so every non-empty group still has exactly one default. A stale or
destination-mismatched token fails closed and requires a fresh explanation and
confirmation.

When discovery finds multiple repositories or worktrees for one Project, Web
uses the shared Fluid candidate picker and allows one or more selections. It
connects selected candidates sequentially within the same discovery epoch,
stops on the first failure with partial-progress copy, and performs one fresh
discovery after the batch. Candidate actions remain disabled while a background
recheck is establishing a new epoch.

Web assigns a generation to each discovery round and ignores late results after
a manual path submission or confirmed connection. It does not need a
cross-process cancellation protocol.

The current Project-control target comes from the current local-runtime
projection. A single live, unbound ServiceRuntime may be used when no Binding
yet names the current computer; multiple ambiguous live targets fail closed.
Space reply-readiness is not a prerequisite for Project discovery or folder
connection.

Conflict copy must not promise an Organization display name that the daemon
does not own. The safe form names the conflicting Project slug and says
“another Organization” or “this Organization” from the compared Organization
IDs. A richer Organization name is allowed only when an existing local context
cache explicitly supplies a fresh, verified name for the same Organization ID;
otherwise the generic form remains mandatory.

Absolute paths may be forwarded immediately through Core and Gateway to the
requesting owner-self Web session. They must never enter D1, Agent Activity
events or projections, cloud snapshots, Organization-shared Project data, or
Center Agent context. Immediate forwarding is not cloud storage.

## Agent Profile And Wake Semantics

Only local Agent Profiles use `defaultProjectId`. Remote Agent and Center Agent
Profiles do not use it for their own execution. A verified member may ask the
Center Agent to set or clear Default Project on one of that member's local
Agent Profiles through the represented-member Project tool contract. Choosing
or changing a Default Project affects future Wakes and new sessions only; the
current session is never moved.

On the current computer, execution resolves:

```text
defaultProjectId
-> default Local Project Connection
-> validate folder
-> working folder
```

If no usable connection exists, dispatch fails with
`project.local_connection.missing`. If the default connection exists but its
folder is gone, it fails with `project.local_connection.folder_missing`.
OpenMeld must not choose another worktree, another Project, or the
OpenMeld-managed workspace. Core supplies the public system-notice text; Web,
CLI, and Desktop render it verbatim:

```text
{Agent name} couldn’t start because its Project isn’t connected on the computer that runs it. Connect that Project on the Agent’s computer, then try again.
```

```text
{Agent name} couldn’t start because its Project folder is no longer available on the computer that runs it. Reconnect the folder in Projects, then try again.
```

Core writes that text to `signal.system_notice`. The two reason codes map to
the existing readiness impact `workspace.missing` until a separate Project
readiness taxonomy is needed. Trace may retain Project ID, device ID, and
`bindingGeneration`, but never a local path.

Project is execution-context input only. RuntimeCoordinator remains workstation
Wake in-flight truth, the Space durable dispatch outbox remains its reliable
conveyor, Local OpenMeld Service remains the local carrier, Space remains the
visible result surface, and Agent Activity remains evidence rather than
execution or readiness authority.

## Agent Activity Consumption

Agent Activity references canonical Project IDs and may filter or group its
evidence by Project. Local observers collect only sessions whose working
directory resolves inside an explicitly connected Local Project Connection.
A candidate alone never enables collection.

Project removal preserves historical Activity under retention. The Agent
Activity page keeps Project filtering and a **Manage Projects** link, but all
Project creation, editing, removal, connection, and default-folder management
belongs to Projects.

The Center Agent may read Project-referenced Activity through the reviewed
read-only Activity contract. Its dedicated Project tools may also list, create,
and edit cloud Projects, set Default Project for the represented member's local
Agent Profiles, and remove a Project only through the explicit two-turn
confirmation contract below. Local paths never enter Center Agent context.

Configured Agent Profile creation selects one existing Project by its cloud
Project ID and reuses the same represented-member Default Project mutation.
The selected computer then resolves that Project through its own Local Project
Connection. Center Agent creation does not introduce a second Project object,
folder preference, path lookup, or local connection writer; when no Project is
selected, the existing OpenMeld-managed working-folder behavior remains the
explicit choice.

## Center Agent Project Management

The hosted Center Agent exposes one bounded cloud Project tool family:

```text
openmeld_list_projects
openmeld_create_project
openmeld_update_project
openmeld_set_agent_profile_default_project
openmeld_prepare_remove_project
openmeld_remove_project
```

Every call derives the Organization from the Core-originated turn. Mutations
carry the verified current human member. The read-only Project list also admits
a connected Message Channel member through the exact Core-authored native
delivery and returns ordinary-member capabilities with no creator-specific
management authority. Tool input never accepts Organization ID, member role,
user identity, repository fingerprint, local connection state, or an absolute
path. Core revalidates the designated Center Agent and member, then reuses the
same `ProjectService` and `ProjectAuthority` as human clients. The tool neither
invents a second Project model nor owns another permission rule.

Project creation is useful after GitHub repository discovery or connection, but
the Center Agent does not treat every visible repository as user intent to
create tenant data. It may create immediately when the member explicitly asks,
or offer the concrete Project it can create and ask for confirmation when the
request is only implied by a broader GitHub or Project-dependent workflow. It
asks for a Project name and Repository URL when they are not already known from
trusted tool output. It never asks the member to supply a fingerprint.

Every mutating request carries a stable operation ID. Core stores the operation
request identity and result so retries replay the same outcome instead of
creating a second Project or repeating a terminal action. Reusing one operation
ID with different input fails closed.

Remove Project remains a terminal soft archive. The Center Agent first returns
the exact Project, permanent-effect warning, and short-lived opaque
confirmation token. Only a later verified interactive member turn may consume
that token during an interactive conversation. The token is bound to
Organization, represented member, Center Agent, Project, and current Project
version; expiry, reuse with different input, or a changed Project fails closed.

Routine turns inherit Project listing, creation, update, and Default Project
selection under the reauthorized delegated member and the same Core authority,
operation-id, audit, and idempotency contracts. These ordinary mutations do not
require executor confirmation or carry free-text permission evidence. Project
removal is unsupported during a Routine and returns
`routine_destructive_action_unsupported` with zero side effects before Core's
prepare or remove method. A deterministic product-owned onboarding workflow may
call the same Core Project service after a verified member explicitly opts in;
it must not simulate a model turn or create a parallel permission path.

Current-computer discovery and Local Project Connection mutations are not
Center Agent tools. Slack and hosted Remote Agent turns have no trustworthy
"current computer," and absolute paths are private owner-self device facts.
After cloud configuration, the Center Agent returns the trusted Project detail
Navigation Action. Core rebuilds the canonical Organization URL from the
code-owned target, and the result surface renders **Open this Project** as a
button rather than relying on model-authored Markdown. The Center Agent explains
that the member must open it on the intended computer to connect the local
folder. A completed removal clears any Project target recorded by an earlier
tool call in the same turn and does not offer an action for the archived
Project.
A future device-explicit design may use an explicit computer and opaque
candidate IDs, but it still must not expose an absolute path to the model.

The model-visible descriptions and system prompt use the same product
contract. The Center Agent lists first, asks only for a missing Project name or
exact Repository URL, explains the prerequisite when another feature requires
a Project, and does not create tenant data merely because a repository appeared
in unrelated GitHub results. An explicit request such as "create a Project for
this connected repository" is sufficient authority to create after duplicate
checking; an implied request requires one confirmation before writing.

## API Ownership And Compatibility

Project CRUD moves directly from:

```text
/v1/organizations/current/agent-activity/projects
```

to:

```text
/v1/organizations/current/projects
```

There is no alias, redirect, or dual route. The product is unreleased, the old
path encodes false ownership, and an old CLI receives an explicit 404 rather
than corrupting data. Agent Activity endpoints remain under
`/agent-activity/*` and may reference canonical Projects without owning CRUD.

The HTTP hard cut and local-file rollout intentionally differ. An old HTTP
caller fails visibly; an old bindings writer could silently collapse multiple
directories. Therefore the file requires consumer-before-producer while the
route cuts directly. The controlled release window and Contract Impact Audit
must record both behaviors, and release notes must state that old
`openmeld projects` commands receive 404 until the CLI is updated. The same
release notes must state that admins can no longer remove Projects.

The safe bindings and route order is:

1. ship CLI/Service v1/v2/v3 readers, explicit unknown-version rejection,
   `project_bindings.update_required`, and the same-machine version gate;
2. expose the new daemon capability;
3. apply the latest partial-index migration;
4. ship Core, Gateway, API, and Web consumers with the direct route cutover;
5. expose multiple-connection mutations only when the current Service proves
   v3 support;
6. allow the first v3 write; and
7. complete release-ready and packaged CLI/Service smoke before tightening
   local-component policy.

The additive safe Repository URL field uses its own mixed-version order:

1. deploy Gateway with schemas that accept the optional response field and
   optional create/update input;
2. apply the D1 migration that adds nullable `repository_url`;
3. deploy Core, omitting the response field for legacy fingerprint-only rows;
4. deploy Web, which starts sending the safe URL and displaying it; and
5. verify create, edit, list, and Project discovery before considering the
   rollout complete.

Old CLI and Service builds remain compatible because they continue sending and
consuming repository fingerprints. No local-component contract changes in this
addition.

## Owner Boundaries

This document owns Project product meaning and the cross-boundary outcomes that
must remain true. Scoped owners still control their implementations:

- `developing/clients/web.md` owns navigation, route placement, and browser
  presentation.
- `developing/architecture/local-openmeld-service.md` owns current-device
  transport and the local trust boundary.
- `developing/engineering/development-workflow.md` owns rollout, Contract Impact
  Audit, release-ready, and smoke discipline.
- `developing/product/agent-profiles.md` owns Agent Profile identity and its
  working-folder and Default Project preferences.
- `developing/product/agent-activity.md` owns Activity observation, evidence,
  privacy, retention, and read surfaces.

The schemas and protocol details must implement the product requirements here;
this document is not their source-code catalog.

## Delivery Order

Projects follows M-1 documentation, M0 shared contracts and authority, parallel
M1 cloud/Web and M2 local Service/CLI work, M3 Agent Profile/Wake integration,
then M4 provider and delivery closeout. M1 and M2 may run in parallel only after
M0 freezes shared schemas, API paths, Project authority, and local operation
shapes. M3 waits for both.

## Product Invariants

- Project is Organization-scoped cloud identity, never a local path.
- Local Project Connection is owner-self, device-local, and lane-local truth.
- One Project may have many local connections; one canonical folder belongs to
  only one Project scope.
- A non-empty Project connection group has exactly one default after product
  mutations.
- Project is not an Agent Profile's permanent assignment.
- Default Project is cloud preference; the current computer resolves the
  working folder.
- Missing or stale local connection evidence fails closed without fallback.
- Local paths are forwarded only to the requesting owner and never stored in
  cloud or shared contexts.
- Route Registry remains lane-disambiguation truth, not Project-binding truth.
- Existing Project IDs, Activity history, and bindings are preserved.
- Project context never replaces RuntimeCoordinator, Queue, Local Service,
  Space reply, Agent Activity, or readiness authority.
