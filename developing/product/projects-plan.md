# Projects First-Class Product Plan v2

## Agent Context

- Purpose: Preserve the approved product, architecture, rollout, and acceptance plan for promoting Projects into a first-class OpenMeld App destination.
- Read this when: Preparing, implementing, reviewing, or releasing any part of the Projects product line.
- Update this when: An approved decision changes before implementation, current-head discovery invalidates a cited implementation fact, or a completed milestone changes the remaining work.
- Do not use this for: Current production behavior before the plan ships, temporary investigation evidence, or permission to start implementation before the gates below are open.
- Source of truth: The approved Projects implementation handoff until the feature ships and its durable contracts are absorbed into the routed owner documents.

Status: APPROVED — W-NAV1 through W-NAV5 are complete, but implementation remains blocked until Felix issues an explicit Projects implementation order.
Removal condition: Delete this plan when Projects ships and every durable contract in it has been absorbed into its owner document; git history is the archive.

## Provenance And Re-Baselining

This document is a faithful English translation of the complete Projects v2 response emitted in the source Codex task at `2026-07-13T08:04:06.111Z`, followed by the six amendments from the final Fable 5 review. The exact extracted Chinese source was 59,474 bytes with SHA-256:

```text
0d384013c9d2209fece2a8bd709b8db3ae2d33bb82f2de52e43d5d4eb56f65c5
```

Navigation terminology in this handoff is aligned with the later canonical
**Agent Activity** label and `/o/{orgSlug}/agent-activity` route. That alignment
does not change any Projects product or architecture decision from the source.

The source design was verified on 2026-07-13 against `main` at `90f8d9bed`. Navigation was changing concurrently at that time, so every cited file, symbol, route, migration, and rail integration point must be re-verified against the final W-NAV1 through W-NAV5 HEAD before implementation. The handoff was written on current `main` at `a58c654d41c72a76263bf80b17eaed9e3ff3a633`; that SHA is a recording baseline, not an implementation baseline.

This file does not activate the future Projects product contract. M-1 owns the required changes to the current owner documents after the Navigation gate opens.

---

# 1. Product Goal

## One-Sentence Definition

**Projects is a first-class destination in the OpenMeld App for managing the code projects shared by the current workspace and the local connections to those projects on the current user's computer.**

When users enter Projects, they should be able to answer four direct questions:

1. Which Projects exist in this workspace?
2. Which Projects have been found or connected on this computer?
3. Which clones or worktrees on this computer belong to each Project?
4. Can I choose a Project when starting an Agent instead of repeatedly entering a local path?

The user's actual intent is not “configure a path.” It is:

> I want this Agent to work in the OpenMeld Project.

OpenMeld resolves that intent to the correct working folder on the current computer.

---

# 2. Domain Model

## Project

The code-project identity recognized by the current Organization.

A Project is a cloud, Organization-scoped business object. It never contains a user's absolute local path.

## Repository Identity

A stable fingerprint used to decide whether two local Git repositories belong to the same Project.

The raw Repository URL is used only on the client to normalize and generate the fingerprint. It is neither uploaded nor stored.

## Local Project Connection

One local directory connection for a Project in the current OpenMeld lane on the current computer.

One Project may have multiple Local Project Connections, such as a normal clone and multiple worktrees.

## Default Local Project Connection

The local connection used by default to start new Agent sessions for a Project on the current computer.

## Project Candidate

A directory OpenMeld discovered that may belong to a Project. It is not yet user-confirmed, so it is not a Local Project Connection and cannot report Activity.

## Default Project

The Organization-scoped cloud preference on an Agent Profile that indicates the Project in which future Wakes and new sessions should work by default.

It is not a local path and does not permanently assign the Agent Profile to the Project.

## Working Folder

The absolute directory used by one local execution. The current computer resolves it from a Local Project Connection. It is owner-self local execution information.

---

# 3. Settled Decisions

Every item in this chapter is a decision already made by Felix or confirmed by Fable review. No alternative remains open.

## 1. Projects Enters The Main Sidebar

Projects is a first-class App destination. It is not a child page of Agent Activity, Organization Settings, or another feature.

The target Main Sidebar has seven destinations:

```text
Center Agent
Spaces
Directory
Projects
Routines
Agent Activity
Settings
```

Project data still follows the current workspace / Organization:

- Switching workspaces switches the Projects content.
- Personal workspaces have Projects.
- Multi-member Organizations have Projects.
- The Main Sidebar is App-level navigation.
- The Organization is the Project data scope.

This is Felix's product decision.

---

## 2. Complete NAV Closure Is A Hard Start Gate

Projects implementation must not compete with W-NAV1 through W-NAV5 for Navigation files.

The current Navigation target, six-slot definition, and migration sequence are documented in:

- `developing/clients/web.md:86-111`
- `developing/clients/web.md:170-194`
- `developing/decisions.md:66`

The mandatory order is:

```text
W-NAV1
→ W-NAV2
→ W-NAV3
→ W-NAV4
→ W-NAV5
→ Projects prerequisite documentation card
→ Projects M0-M4
```

All Projects work, including owner-document implementation, comes after complete NAV closure.

Before implementation starts, reread the final W-NAV implementation. Do not implement against the Navigation code that was still changing when the source design was verified.

---

## 3. The Seventh Slot Must First Be Recorded Under Repository Discipline

The first Projects card after the gate opens is a prerequisite documentation card, not a code card:

1. Change the target topology in `developing/clients/web.md` from six destinations to seven.
2. Append a new decision to `developing/decisions.md`.
3. Supersede only the “six-slot count and Projects placement” portion of the 2026-07-13 decision.
4. Keep Single home, Structural constancy, and Use vs. Configure in force.
5. Record why Projects passes Use vs. Configure.
6. Update the local driver boundary in `developing/architecture/local-openmeld-service.md`.
7. Create `developing/product/projects.md`.
8. Move Project ownership content from `developing/product/agent-activity.md:30-59` into the new owner document.
9. Update `developing/product/agent-profiles.md` with the workspace and Default Project contracts.
10. Update the `AGENTS.md` routing table and Navigation owner pointer.

This follows the first-class capability promotion discipline in `developing/engineering/anti-patterns.md:236-266`.

---

## 4. The MVP Has No Inner Sidebar

The Projects MVP uses a flat, full-width presentation:

```text
Projects cards
→ Project detail
```

Follow the promoted Agent Activity and Routines `AppFullWidthLayout` precedents:

- `clients/web/src/routes/o/$orgSlug/agent-activity.tsx:1-16`
- `clients/web/src/routes/o/$orgSlug/_center-agent/center-agent.routines.tsx`

Add an Inner Sidebar only when Projects has several stable, long-lived sub-products such as Overview, Agents, Activity, and Settings.

The MVP must not invent empty categories for visual completeness.

---

## 5. Cards Reuse Only The Contract Layer

Reuse:

- grid layout
- card shell
- add card

The current contract is in:

- `packages/ui/src/lib/settings-computers-contract.ts:3-16`

Organizations already reuses it:

- `clients/web/src/components/organizations/organization-entry-page.tsx:272-308`

Projects becomes the third consumer. Generalize the `SETTINGS_COMPUTERS_*` names during implementation.

Do not create a giant generic “entity card content” component. Implement Project card content independently.

---

## 6. Project Permissions

### All Active Organization Members

May:

- view Projects
- add a Project
- connect their own local folders
- add multiple worktrees
- edit Projects they created

### Organization Owner

May:

- edit any Project
- remove any Project, whether or not it has Activity

### Admin

May:

- create Projects
- edit Projects they created
- not remove Projects

This deliberately narrows current authority. Current code still allows both owner and admin to archive:

- `services/core/src/agent-activity/project-authority.ts:21-25`

Release notes must explicitly say that admins can no longer remove Projects.

---

## 7. Organization Creator Means The Current Owner

Do not add permanent `organizationCreatorUserId` authority.

The Organization identity model already uses `owner / admin / member`, and Project already has `createdByUserId`:

- `packages/db/src/core/project.schema.ts:12-25`

For the MVP, “Organization creator” means the current Organization owner.

Use this product copy consistently:

```text
Only the organization owner can remove this Project.
```

A personal workspace naturally reduces to one member who is also the owner. It needs no special authorization branch.

---

## 8. Project Creator Grace Rule

A member who created a Project may remove it only when it has no associated Agent Activity.

Real user scenario:

> A regular member accidentally creates the wrong Project and immediately notices that the name or repository is wrong. With no Activity yet, they should not have to find the owner to clean it up.

After any Activity evidence exists:

- the member creator cannot remove the Project
- only the Organization owner can remove it

Core must enforce this atomically on the server.

---

## 9. Remove Always Uses Soft Archive

The MVP does not implement per-Project hard delete or unarchive.

Users see:

```text
Remove Project
```

The implementation writes `archived_at_ms`.

After removal, a Project:

- does not appear in active Projects
- cannot receive new Local Project Connections
- cannot receive new Activity
- cannot be selected for a new session
- keeps historical Activity traceable for the applicable retention period

The current implementation supports only soft archive:

- `services/core/src/agent-activity/project-repository.ts:190-216`

The v1 statement that an empty Project is physically deleted is retired.

---

## 10. Archived Slugs Must Be Released

The current unique index covers all Projects:

- `packages/db/src/core/project.schema.ts:28-31`

Because archive is terminal, a slug is currently consumed forever after first use.

In the next available migration, Projects implementation must replace that index with:

```text
UNIQUE (organization_id, slug)
WHERE archived_at_ms IS NULL
```

Result:

- active Projects still cannot share a slug
- an archived Project no longer blocks a new active Project from using the slug
- historical Projects keep their original slug; history is not rewritten

---

## 11. Repository URL Must Become A Fingerprint

This is not a deferrable engineering optimization. It is part of the existing Disclosure Contract:

- `developing/product/agent-activity.md:76-82`

The contract forbids uploading:

- raw Repository URLs
- absolute local paths
- credential material

The Repository URL in the creation form exists only in Web memory for:

```text
normalize
→ fingerprint
→ discard raw URL
```

The cloud continues to receive only `repositoryFingerprint`.

The only current normalization implementation is in:

- `clients/openmeld-cli/src/agent-activity/project-bindings.ts:298-337`

Move it into a shared primitive. Web, CLI, and Local Service must not each implement their own version.

---

## 12. One Project Must Support Multiple Local Folders

Upgrade the local binding store from v2 to v3:

```text
one Project
→ multiple Local Project Connections
→ at most one default
```

Keep `bindingGeneration` as the connection identity and optimistic lock.

When the current single binding migrates from v2 to v3, it:

- automatically becomes the default
- requires no user action
- keeps the same path
- keeps the same Activity attribution

This invariant remains in force:

> One canonical local folder can belong to only one Project scope, even across Organizations.

The existing contract is in:

- `developing/product/agent-activity.md:55-59`

Remove the current one-folder-per-Project restriction in:

- `clients/openmeld-cli/src/agent-activity/project-bindings.ts:96-109`

---

## 13. Route Registry And Multiple Folders Are Different Concepts

Route Registry has this granularity:

```text
repository path
→ OpenMeld lane rootDir
```

It resolves global-hook ambiguity between production, dev, canary, and custom homes.

Local Project Connection has this granularity:

```text
Project
→ one or more repository roots inside one lane
```

Do not merge the two into one state model.

Route Registry keeps these properties:

- global registry
- lane-local bindings
- fail closed on multiple matching lanes
- never upload `rootDir`
- never create a second Project binding truth

Evidence:

- `developing/product/agent-activity.md:125-138`
- `clients/openmeld-cli/src/agent-activity/route-registry.ts:96-120`
- `clients/openmeld-cli/tests/agent-activity-route-registry.test.ts:68-93`
- commit `b411983179132b0adafbb24c25a4fa9cb4848dd2`

---

## 14. Automatic Discovery Uses The Current-Device RuntimeTransport Path

Web never accesses the local filesystem directly.

Local Service performs discovery through the existing current-device synchronous request-response path in RuntimeTransportHub.

The current operations are:

- `set_enabled`
- `set_profile_workspace`
- `refresh_catalog`

References:

- `services/core/src/rpc/methods.ts:1812-1855`
- `services/core/src/rpc/methods.ts:1923-2067`
- `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:10800-11065`

Project discovery uses the same current-device, `requestId`, Promise, timeout, and 504 path.

One request verifies every Project in the current Organization. Do not start a separate discovery for every card.

---

## 15. Local Paths May Be Forwarded Immediately But Never Stored In The Cloud

A discovery response may include absolute local paths and be forwarded through Core/Gateway to the requesting owner-self Web session.

Paths must never enter:

- D1
- Agent Activity events, sessions, or digests
- cloud snapshots
- Organization-shared Project data
- Center Agent context

This is “owner-self immediate forwarding,” not “Organization data storage.”

Existing `set_profile_workspace` already forwards a path through the same channel in the other direction:

- `services/core/src/rpc/methods.ts:1923-1995`
- `packages/schemas/src/schemas/http/local-runtimes.ts:157-198`

`developing/architecture/local-openmeld-service.md:226-266` must explicitly authorize:

- discovery
- connect-candidate
- user-declared-path

Do not bypass the owner document.

---

## 16. Manual Paths Override Late Discovery Results

Web uses a generation/epoch state machine:

1. Assign a new positive integer generation to every discovery round.
2. Echo the generation in both request and response.
3. Accept only the current generation in the UI.
4. Increment the generation immediately after the user submits a manual path or confirms a connection.
5. Discard older discovery responses even when they arrive later.
6. Let daemon Git commands end naturally under their 10-second timeout.
7. Do not build a complex cross-process cancellation protocol.

Connection writes reuse `bindingGeneration` for later idempotency and concurrency safety.

---

## 17. Remove The Old Project Management Entry Point In One Cutover

When the Projects page ships, remove the old management UI from Agent Activity in the same card. Do not keep a transition period.

Move:

- `AgentActivityProjectDialog`
- create/edit state
- `ArchiveProjectDialog`
- EmptyProjects create CTA
- `ProjectConnectionGuidance`
- Project card edit/archive buttons

Current locations:

- `clients/web/src/components/organizations/agent-activity-page.tsx:74-318`
- `clients/web/src/components/organizations/agent-activity-page.tsx:572-608`
- `clients/web/src/components/organizations/agent-activity-page.tsx:803-870`
- `clients/web/src/components/organizations/agent-activity-project-dialog.tsx:25-129`

Agent Activity keeps:

- Project filtering
- Activity data
- a `Manage Projects` link

Move and reuse the existing query keys and mutation implementations. Do not build a second logic path.

---

## 18. A Default Project Without A Local Connection Fails Explicitly

When an unattended Wake reaches a computer where the Agent Profile's Default Project has no usable Local Project Connection:

- do not fall back to the OpenMeld-managed workspace
- do not choose another Project
- do not start the provider
- fail explicitly
- publish a visible failure receipt in the Space
- preserve the reason code and Project ID in trace without recording the local path

This continues the current fail-closed behavior for a missing custom workspace:

- `clients/openmeld-cli/src/local-service/execution/dispatch-runtime-preparation.ts:18-38`

---

## 19. Default Project And Working Folder Are Separate Layers

### Cloud Agent Profile

Stores:

```text
defaultProjectId
```

This is an Organization-scoped preference that applies only to local Agent Profiles.

Remote Agent and Center Agent Profiles do not show this field in the MVP.

### Current Computer

The computer resolves through its own Local Project Connections:

```text
defaultProjectId
→ default Local Project Connection
→ working folder
```

Absolute local paths never enter the Agent Profile cloud identity.

The current Agent Profile owner document does not yet own the workspace contract, so documentation must be completed before M3:

- `developing/product/agent-profiles.md:224-229` currently defines the workspace directory only as owner-self diagnostics.
- The actual managed/custom contract mainly exists in `developing/clients/cli.md:337-345` and code.
- Web currently has only a free-text Project folder when creating a Profile: `clients/web/src/components/profiles/create-profile-form.tsx:223-247`.
- Web currently has no workspace-editing surface for an existing Agent Profile.

Agent Profile integration is therefore a new feature, not a simple dropdown replacement.

---

# 4. Information Architecture And UI

## Projects Routes

After NAV closure:

```text
/o/{orgSlug}/projects
/o/{orgSlug}/projects/{projectId}
```

Use immutable `projectId` for the detail route. Do not use an editable, reusable slug as identity.

Continue using slug in the CLI and as supporting display information.

---

## Projects Home

Use a Computers / Organizations-style card grid:

```text
Projects

Projects shared in this workspace.

┌─────────────────────────┐
│ OpenMeld                │
│ Connected               │
│ ~/Desktop/work/openmeld │
│                    Open │
└─────────────────────────┘

┌─────────────────────────┐
│ Agents Router           │
│ Found on this computer  │
│                   Review│
└─────────────────────────┘

┌─────────────────────────┐
│            +            │
│ Add a Project           │
└─────────────────────────┘
```

Do not simultaneously add:

- a Header Add button
- a Sidebar Add button
- an Empty-state Add button
- a Grid Add card

The MVP uses one stable `Add a Project` card.

---

## Project Card Content

Show only:

- Project name
- slug, to distinguish duplicate names
- Repository configured / not configured
- Local Project Connection state on the current computer
- default local folder
- Open / Review

Do not duplicate:

- Agent Activity lists
- Agent Profile lists
- Organization members
- session history
- statistics dashboards

Provide filtered links to related products instead.

---

## Project Detail

The MVP is one continuous detail page with no tabs.

### Project

- name
- slug
- repository configured state
- created by
- Edit

### This Computer

- computer name
- OpenMeld Service state
- discovery state
- default folder
- additional folders/worktrees
- Connect folder
- Add another folder
- Make default
- Remove connection

### Related

- View Activity for this Project

Do not duplicate the Activity page.

### Danger Zone

- Remove Project
- visible only to the owner or a Project creator who qualifies for the zero-Activity grace rule

---

# 5. Project Creation And Removal

## Primary Creation Form

The primary form contains only:

```text
Project name
Repository URL (optional)
```

Slug is generated automatically; see Design A.

The Repository URL exists only in Web memory to create a fingerprint.

Without a Repository URL:

- the Project can still be created
- users can still connect a folder manually
- automatic cross-computer repository matching is not available yet
- users can add a Repository URL later by editing the Project

---

## Duplicate Project Names

Project names do not need to be unique inside an Organization.

Cards with the same name display the slug for disambiguation:

```text
Mobile App
/mobile-app

Mobile App
/mobile-app-2
```

---

## Limit Of 500 Active Projects

Keep the current limit:

- `packages/schemas/src/schemas/http/agent-activity.ts:5-8`
- `services/core/src/agent-activity/project-repository.ts:114-154`

Do not add a live quota panel near the limit. Creation failure copy must be clear:

```text
This workspace already has 500 active Projects. Remove an unused Project before adding another.
```

---

# 6. Current-Computer State Model

## Checking This Computer

Local Service is running one bounded discovery.

Show `Connect folder` at the same time; users do not have to wait.

## Found On This Computer

One or more candidates were found but not yet confirmed by the user.

Do not start Activity reporting.

## Connected On This Computer

A default connection exists and its folder is available.

## Connected Folder Missing

A Local Project Connection exists, but its default folder is no longer available.

Common causes:

- a Codex worktree was deleted
- an external drive is not mounted
- a repository was moved
- the user deleted the folder manually

## Not Found On This Computer

Discovery completed normally and found no candidate.

## Git Verification Unavailable

Git could not reliably verify candidates because:

- Git is missing
- macOS Command Line Tools are missing
- a Git command timed out
- Git returned a permission or other error

Do not present this as `Not found`.

## OpenMeld Service Unavailable

The current Local Service cannot be reached.

Do not present this as `Not found` or `Git unavailable`.

---

# 7. Automatic Discovery

## Candidate Sources

Never scan the entire disk.

One discovery collects paths from known sources:

- existing Local Project Connections
- Codex App / CLI session working directories
- Claude Code session working directories
- OpenCode session working directories
- Agent Profile workspaces
- paths explicitly entered by the user
- `git worktree list` for repositories already confirmed

## Git's Correct Responsibility

Git does not traverse the computer to find every repository.

Git verifies known candidates:

```text
git rev-parse --show-toplevel
git remote get-url origin
git worktree list --porcelain
```

During connect/discovery, normalize through `--show-toplevel` before storing the repository root.

This fixes the current subtree-only behavior caused by realpath prefix matching:

- `clients/openmeld-cli/src/agent-activity/project-bindings.ts:125-145`
- `clients/openmeld-cli/src/agent-activity/observer-adapters.ts:317-337`

If the user enters a monorepo subdirectory:

```text
/Users/felix/work/openmeld/clients/web
```

the final connection is:

```text
/Users/felix/work/openmeld
```

---

## macOS Command Line Tools

Daemon-side discovery must not invoke `/usr/bin/git` in a way that opens a system GUI.

On macOS, first run the non-GUI check:

```text
xcode-select -p
```

On failure, show:

```text
Git tools aren’t available on this Mac.
Install Apple Command Line Tools, then try again.
```

Only guide a user who explicitly chooses to install them to run:

```text
xcode-select --install
```

The daemon never triggers the installation dialog itself.

---

## Resource Boundaries

- Each Git subcommand has a 10-second timeout.
- The suggested global Git concurrency limit is 4.
- The suggested total daemon discovery budget is 25 seconds.
- The suggested RuntimeTransport waiter returns 504 after 30 seconds.
- One request covers all active Projects.
- Project detail may pass optional `projectIds` for a narrow refresh.
- Do not run a persistent high-frequency scan.
- Do not start an independent process pool per card.

---

# 8. Multiple Folders And Stale Connections

## Bindings v3

One Local Project Connection is one record:

```text
version
bindingGeneration
boundAtMs
organizationId
projectId
projectSlug
repositoryFingerprint
repositoryPath
isDefault
```

Do not add a second local Project truth.

## Default Rules

- One `(organizationId, projectId)` has at most one `isDefault = true`.
- The first connection automatically becomes default.
- A new worktree is not default automatically.
- When connections exist, product operations must leave exactly one default.
- Removing the default while another connection exists must select a replacement in the same operation.
- Never silently select a different folder to start an Agent.

## Stale Connections

Do not remove a missing folder automatically.

It may only be temporarily unavailable because:

- a worktree was moved
- a network volume is not mounted
- a removable drive is offline

The UI provides:

```text
Locate folder
Make another folder default
Remove connection
```

When one Project has at least two missing connections, it may also show:

```text
Remove missing connections
```

Require confirmation.

If the original path returns, the next discovery automatically restores `Connected`; rebinding is unnecessary.

---

# 9. How The Existing Agent Activity Foundation Is Promoted

Projects is not rebuilt from scratch. The Project foundation already delivered with Agent Activity is promoted into a first-class App product.

| Existing capability | v2 treatment |
|---|---|
| D1 `projects` table | Keep as the single cloud Project truth |
| Project IDs | Keep; do not rebuild or duplicate |
| name/slug/creator/fingerprint/archive | Keep and evolve |
| Core Project CRUD | Move into `services/core/src/projects/` |
| Project API | Move to an independent Projects route |
| Agent Activity `projectId` | Keep; Activity becomes a Projects consumer |
| Existing Web CRUD | Move into Projects; do not rewrite logic |
| Agent Activity management UI | Remove in the same cutover card |
| CLI `openmeld projects` | Keep and add multiple-folder support |
| `project-bindings.json` | Keep as the single Local Project Connection store |
| Existing bindings | Read compatibly and show automatically as Connected after v3 migration |
| Local observer | Keep; observe only explicitly connected folders |
| Route Registry | Keep for lane routing, not Project multiple-folder ownership |
| Existing Activity history | Keep its original Project attribution |
| Existing local archive cleanup | Keep and adapt for multiple connections |
| Agent Profile Project folder | Keep as the underlying workspace and manual fallback |

Local cleanup after archive already exists:

- `clients/openmeld-cli/src/agent-activity/local-sync.ts:177-255`
- `clients/openmeld-cli/src/agent-activity/local-sync.ts:257-307`

There is also an existing v1-to-v2 compatible-read precedent:

- `clients/openmeld-cli/src/agent-activity/project-bindings.ts:396-451`

After upgrading, users must automatically see:

1. Existing Projects on the Projects home.
2. The existing binding as the default Local Project Connection.
3. Existing Activity history under the same Project ID.
4. No requirement to recreate Projects.
5. No requirement to rebind folders.
6. No requirement to recreate Agent Profiles.

---

# 10. Matching Primitive Convergence

Two equivalent but physically separate path matchers currently exist:

- `clients/openmeld-cli/src/agent-activity/project-bindings.ts:284-296`
- `clients/openmeld-cli/src/agent-activity/observer-adapters.ts:317-337`

Converge them into one shared primitive before implementing multiple folders.

The primitive owns:

- canonical path
- repository root
- longest matching Local Project Connection
- exact connection identity
- same-lane Project resolution

Route Registry's multiple-lane fail-closed tests must continue to pass.

Observer, hook dispatcher, and CLI must never resolve the same path to different Projects after the multiple-folder change.

---

# 11. Agent Profile Creation And Maintenance

## Create Agent Profile

Target flow:

```text
Create Agent Profile
→ Choose local agent
→ Choose Project (optional)
→ Resolve local folder
→ Create
```

### Project Is Connected

Use the default Local Project Connection directly.

### A Candidate Was Found But Is Not Connected

Ask for confirmation:

```text
OpenMeld found this Project at:

/Users/felix/Desktop/work/openmeld

[Connect and continue]
```

### Multiple Candidates

Require the user to choose deterministically.

### No Candidate

Offer:

- Connect folder
- Use OpenMeld-managed workspace
- Advanced: Enter a custom path

## Existing Agent Profiles

Create a new maintenance surface from scratch:

```text
Default Project
Default working folder on this computer
```

Actions:

- Change Default Project
- Change local folder
- Use OpenMeld-managed workspace
- Clear Default Project

Always say:

```text
This applies to future Wakes and new sessions.
Your current session will not be moved.
```

Web currently has no workspace-editing surface for an existing Profile. M3 must therefore be estimated as a complete new feature.

---

# 12. Provider Session Behavior

## New Sessions

### Codex

Create the new task/session in the target Project's default folder.

### Claude Code

Start the new session with the target folder as process cwd. No `/cd` is needed.

### OpenCode

Research and test the current version during M4.

## Existing Sessions

The MVP does not move existing sessions by default.

If a user explicitly requests it later:

- Codex: follow verified provider capabilities, preferring a new task.
- Claude Code: after explicit advance authorization, an existing session may receive `/cd`.
- `--add-dir` is outside the MVP.
- Make no OpenCode promise before verification.

Changing Default Project affects only future Wakes and new sessions.

---

# 13. Wake Execution Semantics

When an unattended Wake arrives:

```text
Agent Profile.defaultProjectId
→ current device Local Project Connections
→ default connection
→ validate folder
→ provider launch
```

Every failure fails closed.

## No Connection

Fail explicitly. Do not fall back to the managed workspace.

## Default Folder Missing

Fail explicitly. Do not use an arbitrary additional worktree.

## Folder Available

Start the provider in that folder.

## Execution Authority

Project is execution-context input. It never owns execution authority.

These truths do not change:

- RuntimeCoordinator remains workstation Wake in-flight truth.
- Local Service remains the local execution carrier.
- Project does not decide dispatch ownership.
- Agent Activity does not decide readiness.
- The D1 Activity ledger does not decide execution outcome.

---

# 14. Cross-Product Reuse

## Activity

- view sessions by Project
- Project filter
- Agent Activity continues to use Project ID

Do not duplicate Project management UI.

## Agent Profiles

- Default Project
- current-computer working folder
- new-session launch location

## Wake

- use the Agent Profile Default Project by default
- allow a future one-time Wake to override Project explicitly

## Center Agent

In the future, Center Agent may read Organization Projects and privacy-safe Activity, but the MVP still forbids Center Agent from creating Projects:

- current writes require a verified human profile: `services/core/src/agent-activity/project-request-preparation.ts:28-30`

## Routines, Artifacts, Reviews, And Handoffs

They may reference Project in the future, but this work neither expands current authority nor requires every object to have a Project.

---

# 15. Explicit MVP Deferrals

Do not implement:

- Project-level ACLs
- private Projects
- other members' local connection state
- other members' local paths
- full-disk scanning
- high-frequency background discovery
- complex fork/upstream matching
- native Web folder picker
- Electron folder picker
- Center Agent Project creation
- hot-moving existing Codex/OpenCode sessions
- duplicate Directory or Activity pages inside Projects
- Project dashboards
- salted fingerprints
- mandatory Project links for all Spaces or Routines

An unsalted fingerprint can be enumerated by someone who already knows a Repository URL. Record this known MVP limitation; it does not block launch.

---

# 16. Approved Design Decisions

The source v2 labeled A through K as recommendations pending Fable review. Fable's final review approved all eleven. They are now binding, including amendments R1 through R6 integrated below.

## A. Name-To-Slug Generation

### User Experience

Keep only these fields in the primary creation form:

```text
Project name
Repository URL (optional)
```

Do not make slug a third required field.

Provide a collapsed Advanced section:

```text
CLI slug
openmeld
[Edit]
```

Regular users do not need to understand slug. CLI users can still inspect and edit it.

### Generation Rules

1. `trim`
2. Unicode NFKD
3. remove combining marks
4. lowercase
5. replace consecutive non-`[a-z0-9]` characters with one `-`
6. remove leading and trailing `-`
7. limit to 80 characters
8. use `project` when the result is empty

Examples:

```text
OpenMeld Web       → openmeld-web
Café Tools         → cafe-tools
Project !!!        → project
```

Do not add a general-language transliteration dependency. The product targets North American users, so Latin normalization is sufficient. Keep an unconvertible display name unchanged and use `project-N` for the slug.

### Authority

Core is the final slug generator.

Make slug optional in the create schema:

- Web omits it by default.
- CLI may pass `--slug` explicitly.
- Core generates it when missing.
- Web uses the same shared slugifier for preview, but preview is not authority.

### Conflicts

Core atomically tries:

```text
open-meld
open-meld-2
open-meld-3
```

The suffix counts toward the 80-character limit.

Ordinary conflicts do not interrupt the user. To prevent a pathological retry loop, automatic allocation has a hard cap at `-99`; if every candidate through `-99` conflicts, return 409 with a clear request to choose a different CLI slug.

Only an explicitly edited Advanced slug surfaces a normal 409 directly:

```text
That CLI slug is already in use in this workspace.
```

### Rename

Renaming a Project does not change its existing slug automatically.

Slug is a stable CLI and deep-integration reference. Change it only when a user edits it explicitly.

---

## B. Discovery Protocol Shape

### Capability Family

Reuse the RuntimeTransportHub current-device request-response mechanism, but do not disguise Project operations as Agent Controller operations.

Add a sibling capability:

```text
localProjectControl:
  discoverProjects
  connectCandidate
  connectDeclaredPath
```

The internal waiter may be generalized from `localAgentControlWaiters` into a current-device operation waiter, but do not rename existing external operations.

### Operation One: Discover

HTTP/Web request:

```text
expectedOrganizationId
clientGeneration
projectIds?       // optional narrow refresh
```

Core:

1. verifies the active Organization
2. reads canonical Projects
3. does not trust a fingerprint submitted by Web
4. sends `{projectId, repositoryFingerprint}` to the current daemon

Daemon response:

```text
requestId
clientGeneration
deviceId
checkedAtMs
gitStatus
projects[]
```

`gitStatus`:

```text
available
not_installed
command_line_tools_missing
timed_out
unavailable
```

Each Project uses a strict discriminated union:

```text
connected
connected_folder_missing
found
not_found
verification_unavailable
```

### Found Candidates

```text
candidateId
canonicalPath
candidateKind: repository | worktree
repositoryFingerprint
```

Do not persist a duplicate `matchCount` truth:

- `candidates.length === 1`: one match
- `candidates.length > 1`: multiple matches
- `candidateKind = worktree`: a worktree

### Connected Connections

```text
bindingGeneration
path
isDefault
status: available | missing
```

When the default is missing, the Project-level result remains:

```text
connected_folder_missing
```

even if an additional connection is available, because an unattended Wake cannot silently switch folders.

### Operation Two: Connect Candidate

Request:

```text
expectedOrganizationId
projectId
candidateId
candidatePath
clientGeneration
idempotencyKey
```

The daemon does not trust cached candidate data. It repeats:

- canonicalization
- Git toplevel resolution
- fingerprint verification
- cross-Organization path conflict check

On success:

```text
status: connected | unchanged
bindingGeneration
isDefault
canonicalPath
```

An existing same-Project, same-path connection returns `unchanged` and its current `bindingGeneration`.

Later update, set-default, and removal mutations require `expectedBindingGeneration`.

### Operation Three: Connect Declared Path

Use the same request shape without `candidateId`; the user supplies the path.

The daemon performs the same complete validation.

### Request Scope

- Projects home requests all active Projects once.
- Project detail may request one Project ID.
- Keep the 500 active Project limit.
- Put every strict Zod schema in `packages/schemas`.
- Forward response paths immediately; never store them.

---

## C. Bindings v3 Schema And Old CLI Behavior

### v3 Schema

```json
{
  "version": 3,
  "bindings": [
    {
      "bindingGeneration": "...",
      "boundAtMs": 0,
      "organizationId": "...",
      "projectId": "...",
      "projectSlug": "...",
      "repositoryFingerprint": "sha256:...",
      "repositoryPath": "/absolute/repository/root",
      "isDefault": true
    }
  ]
}
```

`repositoryFingerprint` may be `null`.

Use `isDefault`, not a role enum.

Reasons:

- The only authority fact is whether a folder is the default.
- `primary/additional/worktree` would mix folder source with launch preference.
- Worktree is a Git candidate type, not a connection authority role.

### Write Invariants

- One canonical path can appear in only one Project scope.
- One Project has at most one default.
- The first connection becomes default automatically.
- Removing the default must atomically select a replacement, or remove the group when no other connection exists.
- Any replacement that affects connection identity updates `bindingGeneration`.

For a non-empty Project connection group, product operations must leave exactly one default.

### v1/v2 Migration

- Keep the v1 reader.
- Convert a v2 single binding to v3 with `isDefault = true`.
- Parse into v3 in memory.
- Write v3 atomically on the first real mutation.
- `setup`/`doctor` may migrate proactively and report it.
- Do not create a sidecar store.

### Old CLI Forward Compatibility

Reject explicitly; do not add dangerous tolerance.

An old v2 writer does not understand multiple folders for one Project. If it were allowed to “read compatibly,” its next write could collapse several connections into one and silently lose data.

The current old reader already throws on an unknown version and only falls back to an empty store on `ENOENT`, so the failure is safe. Its existing message, `binding store is invalid`, is misleading because the file is not corrupt; the software is out of date.

Required behavior:

- A new reader that encounters `version > 3` returns explicit `project_bindings.update_required`.
- Before anything can produce v3, the existing same-machine CLI/Service update-required policy must prevent an old CLI from writing beside a newer Service; daemon capability gating alone cannot govern the CLI binary.
- Release CLI/Service support for reading v3 before enabling v3 writes.
- After capability/readiness proves that the current daemon supports multiple connections, Web may expose those mutations.
- Only then enable v3 writes.
- Old versions enter an explicit upgrade flow and never try to modify the file.

Record the general local-versioned-file discipline in `developing/engineering/`: consumer before producer, unknown version fails closed, and an old writer must never downgrade or overwrite a newer file.

---

## D. Stale Connection Detection And Cleanup

Use two detection layers.

### Projects Discovery

Warn users early with:

```text
Connected folder missing
```

### Dispatch Preflight

Before starting a provider for every unattended Wake, revalidate the default connection.

This is final authority. It must not depend on whether a user previously opened Projects.

Do not build another high-frequency background poll.

### UI

One missing connection:

```text
This folder is no longer available on this computer.

/Users/felix/.codex/worktrees/146d/openmeld

[Locate folder] [Remove connection]
```

Default missing with a healthy additional connection:

```text
Choose another connected folder as the default before removing this one.
```

At least two missing connections:

```text
Remove missing connections
```

Require confirmation.

Never auto-clean because worktrees, external drives, and network volumes may return.

---

## E. Fingerprint Shared Package And Final Rules

### Owner

Create:

```text
packages/projects
```

The final package name uses the plural product term. It owns shared Project domain primitives:

- `normalizeRepositoryRemote`
- `buildRepositoryFingerprint`
- `generateProjectSlug`

`packages/schemas` continues to own:

- fingerprint schema
- Project HTTP/RPC schemas
- RuntimeTransport schemas

Do not put cryptographic or business algorithms into the schema package, and do not leave them in CLI.

Use standard Web Crypto `crypto.subtle.digest` so Node 20, browser, and Workers share one async implementation without a new hashing dependency.

### Repository Normalization

1. Accept `git/http/https/ssh` and SCP-like remotes.
2. Lowercase the host.
3. Preserve an explicit non-default port.
4. Let the URL parser normalize default ports.
5. Ignore username/password, query, and fragment.
6. Remove leading and trailing `/` from the path.
7. Remove a `.git` suffix case-insensitively.
8. Normalize path with Unicode NFC.
9. Lowercase the path for `github.com`, `gitlab.com`, and `bitbucket.org`.
10. Preserve path case for every other host.

The public-host whitelist is deliberate:

- Repository identity on the three public hosts should not differ by path case.
- Self-hosted Git may have case-sensitive paths.
- Preserving case on unknown hosts can create a recoverable false negative.
- Incorrectly lowercasing an unknown host can create a more dangerous false positive by merging two repositories.
- Unknown hosts therefore fail safe and may require user confirmation.

### Port

The port is part of normalized identity.

The current use of `URL.hostname` loses the port and incorrectly merges:

```text
https://host:8443/org/repo
https://host/org/repo
```

Use normalized `URL.host` host-plus-port semantics. Do not repeat a default port after parsing.

### Existing Fingerprint Cutover

Preserving explicit ports and lowercasing paths on the three public hosts changes fingerprint output for some URLs. This is a breaking identity change for any existing Project fingerprint.

Because Projects is not yet released, make the new rule canonical once in M0. Do not implement dual-version matching. For current dogfood Projects, edit the Repository URL once after the change to recompute the canonical fingerprint. Record this break and remediation in the Contract Impact Audit and smoke it explicitly so automatic discovery cannot fail silently.

### Test Matrix

Cover:

- HTTPS / SSH / SCP forms of the same repository
- `.git`
- trailing slash
- credential stripping
- query/fragment
- explicit port
- GitHub path case
- GitLab path case
- Bitbucket path case
- unknown-host case sensitivity
- rejection of `file:`
- rejection of Windows, UNC, and local paths
- Unicode path NFC
- cross-runtime fingerprint consistency
- one pre-change dogfood fingerprint re-derived through Repository URL edit

---

## F. Connect Folder In Web

A Web browser cannot provide a real native folder picker, so do not label the primary action with the misleading `Choose Folder`.

Use:

```text
Connect folder
```

Open:

```text
Connect OpenMeld on this computer

Folder path
[ /Users/felix/Desktop/work/openmeld ]

Paste the full path to this Project on Felix’s Mac.
OpenMeld will validate it on that computer.

[Cancel] [Check and connect]
```

### Error Copy

#### Empty Or Relative Path

```text
Enter the full folder path on this computer.
```

#### Path Does Not Exist

```text
OpenMeld couldn’t find that folder on this computer. Check the path and try again.
```

#### Not A Directory

```text
That path is not a folder. Enter the Project’s folder path.
```

#### Unreadable

```text
OpenMeld can’t read that folder. Check its permissions and try again.
```

#### Already Connected To Another Project Scope

The local binding file contains `organizationId` but not an Organization display name, so the daemon must not promise a Workspace name that it cannot reliably provide. Use the conflicting Project slug and a generic workspace reference:

```text
This folder is already connected to “project-slug” in another workspace. Disconnect it there before using it for this Project.
```

If implementation deliberately sources a current display name from the existing local context cache and can prove that source is fresh for the same Organization ID, richer copy may use that name. Absence or staleness must still fall back to the copy above. This owner-self information is never disclosed to Organization members.

#### Project Has A Fingerprint But Folder Is Not A Git Repository

```text
This Project has a saved repository identity, but this folder is not a Git repository.
```

Reject the connection.

#### Project Has A Fingerprint But Origin Does Not Match

```text
This folder belongs to a different Git repository. Choose the folder that matches this Project.
```

Reject the connection.

#### Project Has No Fingerprint And Folder Is Not A Git Repository

Allow a second confirmation:

```text
OpenMeld couldn’t verify this folder with Git. You can still connect it, but automatic matching and worktree discovery won’t be available.

[Go back] [Connect anyway]
```

This preserves the existing ability to bind a normal folder to a Project without a fingerprint.

#### Git Or Command Line Tools Unavailable For A Project That Requires A Fingerprint

```text
OpenMeld can’t verify this repository because Git tools aren’t available on this computer. Install Git tools, then try again.
```

Reject the connection.

#### Service Offline

```text
OpenMeld Service is not connected on this computer. Reconnect it, then try again.
```

#### Service Update Required

```text
Update OpenMeld Service on this computer before connecting Project folders from the Web.
```

#### Timeout

```text
This computer didn’t finish checking the folder. Try again.
```

CLI `openmeld projects bind` remains the complete fallback. A future Electron native picker does not block the Web MVP.

---

## G. Owner-Document Wording Drafts

These are the approved English drafts for M-1. They are not active owner contracts until M-1 edits the owning documents after the NAV gate.

### `developing/clients/web.md`

```text
### Fixed primary rail

The rail has exactly seven destinations, in this order:

1. Center Agent — the default landing and chat page.
2. Spaces — the current workspace’s Space collaboration surface.
3. Directory — the single home for Agent Profiles and People.
4. Agent Activity — the first-level home for coding-agent activity awareness.
5. Routines — the first-level home for Organization-shared automation.
6. Projects — the first-level home for choosing, creating, and connecting the code Projects used by local Agents. Project records are scoped to the selected Organization; local folder connections remain owner-self, device-local execution facts.
7. Settings — the only settings surface.
```

### Use vs. Configure Rationale

```text
Projects passes Use vs. Configure because its primary user intent is daily work selection: users choose which Project an Agent should work in, start new local sessions in that Project, and see whether the current computer can run it. Creating, renaming, connecting, and removing Projects are supporting actions inside that product home. Projects would belong in Settings only if it were a low-frequency repository configuration table with no direct role in starting or directing Agent work.
```

### `developing/decisions.md`

```text
| Web navigation uses a seven-slot Center Agent / Spaces / Directory / Agent Activity / Routines / Projects / Settings rail. Projects is a first-level daily-use surface because users choose the code Project in which local Agents start and work; Project configuration remains supporting behavior inside that home. Projects starts only after W-NAV1..W-NAV5 are complete. This supersedes only the six-slot count and destination order portion of the 2026-07-13 navigation decision; Single home, Structural constancy, Use vs. Configure, and the other destination placements remain in force. | 2026-07-XX | `developing/clients/web.md`, `developing/product/projects.md`, `developing/product/agent-profiles.md`, `developing/product/agent-activity.md` |
```

### Seven-Slot Order

Keep:

```text
Directory
Projects
Routines
Agent Activity
```

Rationale:

- Directory: who participates in the work.
- Projects: which code project contains the work.
- Routines: which automations keep running.
- Agent Activity: what coding agents are doing.

Projects follows Directory and precedes Routines, matching the user's mental order of “participants → work context → automation → visibility.” Confirm the final visual order once in a real browser after the final NAV implementation; the semantic default remains this order.

---

## H. Wake Failure Receipt

### Reason Codes

Use:

```text
project.local_connection.missing
```

This does not bind the failure to the Agent Profile's “default” implementation detail and remains reusable for a future Wake that explicitly selects a Project.

Use a separate code when the default connection exists but the folder is gone:

```text
project.local_connection.folder_missing
```

This lets trace distinguish:

- never connected
- connection exists but its folder disappeared

### Server-Owned `notice.text`

No connection:

```text
{Agent name} couldn’t start because its Project isn’t connected on the computer that runs it. Connect that Project on the Agent’s computer, then try again.
```

Folder missing:

```text
{Agent name} couldn’t start because its Project folder is no longer available on the computer that runs it. Reconnect the folder in Projects, then try again.
```

### Contract

- Add the reason codes to the shared public failure schema.
- The server generates `notice.text` and writes it to `signal.system_notice`.
- Web, CLI, and Desktop render the text verbatim; they do not rebuild copy from the code.
- Trace may include `projectId`, `deviceId`, and `bindingGeneration`.
- Trace never contains a local path.
- Never fall back to the managed workspace.
- Map the new reason codes to existing readiness impact `workspace.missing` until a separate Project readiness taxonomy is needed.

Existing notice structure:

- `packages/schemas/src/schemas/space-mesh/signal-system-notice.ts:27-50`
- `services/core/src/dispatch/application/dispatch-publication-policy.ts:543-565`

Existing workspace-missing mapping:

- `packages/schemas/src/public-agent-failure-reason.ts:638-650`

---

## I. Atomic “No Activity Association” Decision

### Evidence Tables

The member-creator grace rule must check:

1. `agent_activity_events`
2. `agent_activity_sessions`
3. `agent_activity_digests`
4. `agent_activity_daily_aggregates`
5. `agent_activity_daily_session_keys`
6. `agent_activity_execution_links`, joined through its session

Definitions:

- `packages/db/src/core/agent-activity.schema.ts:12-247`
- `packages/db/src/core/dispatch.schema.ts:700-739`

Do not reuse current `listForSnapshot` by itself. It checks only events, sessions, and digests:

- `services/core/src/agent-activity/project-repository.ts:57-93`

Daily aggregates and daily session keys may remain after raw-event retention and therefore count as Activity association.

### Authority Branches

```text
owner
→ may archive any active Project

member + matching createdByUserId
→ may archive only a Project with no Activity evidence

admin
→ may not archive

other member
→ may not archive
```

### Atomic SQL

Do not implement:

```text
SELECT count
→ application decides empty
→ UPDATE projects
```

Use one conditional update:

```text
UPDATE projects
SET archived_at_ms = ?, updated_at_ms = ?
WHERE id = ?
  AND organization_id = ?
  AND created_by_user_id = ?
  AND archived_at_ms IS NULL
  AND NOT EXISTS (...)
  AND NOT EXISTS (...)
  ...
```

The repository returns an explicit outcome:

```text
archived
has_activity
conflict
not_found
```

### Ingest Write Fence

The current event service reads an active Project before a later batch writes the event:

- `services/core/src/agent-activity/activity-event-service.ts:105-133`
- `services/core/src/agent-activity/activity-event-repository.ts:45-171`

That permits a theoretical “read active → archive → insert event” race.

For the creator grace rule to remain correct, the event insert itself must require:

```text
EXISTS (
  SELECT 1 FROM projects
  WHERE id = ?
    AND organization_id = ?
    AND archived_at_ms IS NULL
)
```

If archive wins first, event ingest returns `project_archived`.

If the event wins first, the member creator's conditional archive returns `has_activity`.

### Tests

In D1/miniflare, use deterministic interleaving cases rather than pretending to run a true concurrent stress test:

- archive-first ordering: the event is not stored
- event-first ordering: the member creator cannot archive
- owner archive: later events are still rejected
- a Project with only a daily aggregate cannot use the creator grace rule
- a Project with only a daily session key cannot use the creator grace rule
- an execution-link association cannot bypass the rule

The two ordering cases must validate the actual conditional statements in both directions.

User copy:

```text
This Project already has Activity. Only the organization owner can remove it.
```

---

## J. Implementation Stages And Dependency Graph

```text
W-NAV1..W-NAV5 complete
          │
          ▼
M-1 prerequisite docs and constitution
          │
          ▼
M0 shared contracts and Project authority
        /   \
       ▼     ▼
M1 Cloud/Web  M2 Local Service/CLI
       \     /
        ▼   ▼
M3 Agent Profile + Wake integration
          │
          ▼
M4 provider smoke + release closeout
```

### M-1: Prerequisite Documentation

- seven-slot rail in `web.md`
- new decision in `decisions.md`
- Use vs. Configure rationale
- `projects.md`
- move Project ownership out of `agent-activity.md`
- workspace + Default Project in `agent-profiles.md`
- three Project device operations in `local-openmeld-service.md`
- `AGENTS.md` routing
- progressive-disclosure / `web.md` owner-pointer debt
- API ownership and local-store migration discipline

Code is not permitted until M-1 is complete.

### M0: Shared Contracts And Authority

- `packages/projects`
- slug generator
- fingerprint normalization
- strict Project schemas
- strict `localProjectControl` schemas
- bindings v3 schema and migration discipline
- partial unique index migration
- owner-only plus creator-zero-Activity authority
- atomic evidence-aware archive
- active-Project ingest fence
- move six Core Project files into `services/core/src/projects/`
- API route migration
- initial Contract Impact Audit

M0 freezes cross-boundary contracts. M1 and M2 do not invent fields independently.

### M1: Cloud And Web

- seventh rail destination
- `/projects` route family
- card grid
- Add Project
- name-to-slug UX
- Repository URL to local fingerprint
- edit/remove
- permission presentation
- Project detail
- discovery generation state
- Connect folder dialog
- remove old Activity management entry point in one cutover
- Activity Project filter + Manage Projects
- preserve route family on Organization switch
- distinguish same-name Projects with slug
- 500-limit copy

### M2: Local Service And CLI

- converge the two path-matching primitives
- Git toplevel normalization
- bindings v3
- v1/v2 migration
- unknown-version fail closed
- Route Registry regression coverage
- candidate collectors
- Git origin/worktree verification
- `xcode-select` preflight
- concurrency and timeouts
- discover operation
- connect-candidate
- connect-declared-path
- default-connection mutations
- stale-connection detection
- CLI list/bind/unbind/default
- multiple-connection archive purge

### M1 And M2 Parallelism

They may run in parallel only after M0 freezes contracts:

- M1 mainly changes Web/Gateway presentation.
- M2 mainly changes CLI/Service/local store.
- Shared schemas, API paths, and Project authority must already be frozen in M0.
- Neither line may independently change protocol shape.

### M3: Agent Profile And Wake

Depends on M1 and M2.

- Agent Profile `defaultProjectId`
- local-only field gating
- Project selector in create form
- edit surface for existing Agent Profiles
- current-computer folder resolution
- `set_profile_workspace` integration
- default connection selection
- dispatch preflight
- missing-connection reason codes
- server-owned system notice
- no managed fallback
- readiness-impact mapping
- trace redaction
- future-Wakes-only copy

### M4: Provider And Delivery Closeout

- Codex new-session cwd smoke
- Claude Code new-session cwd smoke
- Claude authorized `/cd` boundary test
- current OpenCode capability research and smoke
- real worktree dogfood
- authenticated localhost Web smoke
- CLI real-user smoke
- Service restart/migration smoke
- real v2-to-v3 old-file upgrade
- stale-worktree smoke
- complete Contract Impact Audit
- release-ready
- release note for narrowed admin removal authority
- final owner-document alignment
- retired identifier / route checks

---

## K. Project API Route Migration

Migrate with the ownership promotion.

From:

```text
/v1/organizations/current/agent-activity/projects
```

to:

```text
/v1/organizations/current/projects
```

Current route locations:

- `services/gateway/src/routes/rpc-http.agent-activity.ts:25`
- `packages/api-client/src/agent-activity/routes.ts:1-31`

Reasons:

1. The product is not released and has no external consumers.
2. The old path permanently implies that Project belongs to Agent Activity.
3. Independent owner code, owner documents, and Main Sidebar with an Agent Activity HTTP owner would leave a false architecture signal.
4. Delaying the migration only makes it more expensive.
5. Current Navigation discipline deletes retired routes directly rather than retaining valueless compatibility: `developing/clients/web.md:191-194`.

Migration scope:

- Gateway route
- API client route builder
- CLI Projects commands
- Web queries/mutations
- neutral Core RPC naming
- neutral Project CRUD schema/type naming
- tests
- retired-identifier scan

Agent Activity endpoints remain under:

```text
/agent-activity/*
```

Activity snapshots may reference canonical Project records, but Activity no longer owns Project CRUD.

Do not add an old-route alias, redirect, or dual route.

The bindings file and the HTTP route intentionally use different rollout strategies because their failure modes differ:

- An old bindings writer can collapse multiple directories and destroy local data, so the file format requires consumer-before-producer rollout.
- An old CLI calling the retired HTTP route receives an explicit 404. It does not corrupt data, and the existing update-required policy provides the upgrade boundary, so the route can cut over without an alias.

The route change and its CLI candidate still ship in one controlled delivery window. Release notes must explicitly say that older `openmeld projects` commands will receive 404 until the CLI is updated. Record the difference and rollout in the Contract Impact Audit.

---

# 17. Acceptance Scenarios

## Navigation

1. Projects starts only after W-NAV1 through W-NAV5 are complete.
2. Both personal and multi-member workspaces show Projects.
3. Every role sees the same seven-slot rail.
4. Switching workspaces preserves the Projects route family.
5. Projects has no Inner Sidebar.

## Projects UI

6. Users see a card grid and one Add Project card.
7. Selecting a Project card opens its detail page.
8. Same-name Projects show slug for disambiguation.
9. After creation, other members see the Project after refresh; real-time push is not required.
10. A regular member can create a Project.
11. A member creator can edit their Project.
12. An admin cannot remove a Project.
13. An owner can remove any Project.
14. A member creator can remove their own zero-Activity Project.
15. A member creator cannot remove a Project with Activity.
16. An archived slug can be reused by a new active Project.

## Privacy

17. Web never sends a raw Repository URL to Core.
18. The cloud never stores an absolute path.
19. A discovery path is forwarded only to the requester.
20. Other Organization members cannot see a user's local connections.
21. Activity payloads, snapshots, and Center Agent context contain no path field.

## Discovery

22. Projects home verifies all Projects with one request.
23. No full-disk scan runs.
24. Candidate sources are bounded.
25. Git toplevel normalizes a subdirectory to repository root.
26. One match asks for confirmation.
27. Multiple matches require a user choice.
28. Worktrees appear as candidates.
29. Discovery never binds automatically.
30. A manual path submission invalidates a late result by generation.
31. Git unavailable is distinct from Not found.
32. Service unavailable is distinct from Not found.
33. Missing macOS Command Line Tools never causes the daemon to open the system installer GUI.

## Multiple Directories

34. One Project can connect a clone and multiple worktrees.
35. One canonical path cannot be connected to multiple Projects or Organizations.
36. The first connection becomes default automatically.
37. A new worktree does not replace the default automatically.
38. Removing the default explicitly selects a replacement connection.
39. Route Registry multiple-lane ambiguity continues to fail closed.
40. A v2 binding migrates automatically into the v3 default.
41. An old writer cannot downgrade or overwrite v3.

## Missing Folder

42. A missing connection is never removed automatically.
43. Projects shows Connected folder missing.
44. Users can Locate, Remove, or Make another default.
45. A connection automatically returns to Connected when the folder returns.
46. Dispatch validates the folder again before execution.

## Agent Profile And Wake

47. Agent Profile creation can select a Project.
48. A connected Project resolves its working folder automatically.
49. A Project with multiple connections uses an explicit default.
50. Existing Agent Profiles can maintain Default Project.
51. A change affects only future Wakes and new sessions.
52. An active session is never moved silently.
53. A Default Project without a connection causes an explicit Wake failure.
54. A missing default folder causes an explicit Wake failure.
55. Both failures publish server-owned `signal.system_notice` text.
56. Neither failure falls back silently to the managed workspace.
57. Trace contains a reason code and no local path.
58. A new Codex session starts in the target folder.
59. A new Claude Code session starts in the target folder.
60. OpenCode support is claimed only after real verification.

## Existing Foundation

61. Existing Project IDs do not change.
62. Existing Activity history does not change.
63. Existing bindings require no user rebind.
64. Activity no longer contains Project CRUD UI.
65. CLI `openmeld projects` remains available.
66. Archive clears every local connection for the Project.
67. Only the canonical new Project API route exists.

---

# 18. Contract Impact Audit

This feature changes:

- D1 Project index
- Project CRUD schemas
- Project RPC
- Gateway route
- API client
- Web queries/mutations
- RuntimeTransport capabilities and frames
- CLI
- OpenMeld Service
- local `project-bindings.json`
- Agent Profile schema
- dispatch preparation
- public failure reasons
- Web rail/router
- owner documents
- local-component release

It does not change:

- RuntimeCoordinator execution authority
- Queue authority
- Space reply placement authority
- Remote Agent native delivery authority
- Agent Activity evidence ownership
- Center Agent tool authority
- the final owner of Wake availability

## Breaking Fingerprint Cutover

The new normalization rule preserves explicit ports and lowercases paths on `github.com`, `gitlab.com`, and `bitbucket.org`. Existing stored fingerprints may therefore stop matching the same repository under the new canonical rule.

M0 applies the new rule once with no dual-version matcher. Every current dogfood Project with an old fingerprint must be edited once through Repository URL so the fingerprint is recomputed. The release/dogfood checklist must prove that discovery works afterward and never describe a silent mismatch as Not found.

## Bindings v3 And Route Cutover Release Order

1. Release CLI/Service with v1/v2/v3 read support, explicit unknown-version rejection, `project_bindings.update_required`, and the existing same-machine update-required version gate enabled before any v3 producer. The old `binding store is invalid` copy is retired for a newer-version file.
2. Expose the new capability through runtime reporting.
3. Apply the D1 partial-index migration.
4. Ship Core/Gateway/API/Web consumers, including the direct canonical HTTP route cutover.
5. Web exposes multiple-connection mutations only when the current Service supports v3.
6. The first mutation may now write v3.
7. Only after the coordinated window may local-component policy that requires v3 move from available to required.
8. Run release-ready plus packaged CLI/Service smoke.

This is the consumer-before-producer window for the local file. The HTTP route cuts over without an alias because an old caller receives a visible 404 instead of corrupting state. Release notes must call out both the CLI update requirement and the narrower admin removal permission.

---

# 19. Final-Review Coverage Ledger

Fable 5 approved every design item. This ledger preserves the sixteen explicit final-review decisions and the six required amendments.

## Decisions 1-16

1. `packages/projects` is the owner of shared fingerprint and slug algorithms; schemas continues to own shapes.
2. The public-host path-lowercase whitelist is safe, with the breaking cutover recorded.
3. Explicit ports are part of fingerprint identity.
4. A non-empty connection group has exactly one default after product mutations.
5. An old v2 reader fails explicitly instead of pretending to tolerate v3.
6. `localProjectControl` is a sibling capability.
7. The discovery discriminated union carries no duplicate state.
8. A 30-second transport timeout correctly exceeds the 25-second daemon budget.
9. A Project without a fingerprint may connect a non-Git folder after a second confirmation.
10. `project.local_connection.missing` and `project.local_connection.folder_missing` are stable reason codes.
11. The creator archive and event ingest use two atomic fences.
12. The API route migrates directly with no alias.
13. M1 and M2 may run in parallel only after M0 freezes contracts.
14. The default seven-slot order remains Directory → Agent Activity → Routines → Projects, subject only to final real-browser visual confirmation.
15. M-1 covers every required owner document.
16. The implementation task re-verifies every rail integration point after final NAV delivery.

## Amendments R1-R6

- R1: Treat normalization changes as a breaking fingerprint cutover; recompute dogfood fingerprints through Repository URL edit and record it in the Contract Impact Audit.
- R2: Replace misleading old-version copy with `project_bindings.update_required`, and put the existing same-machine CLI/Service update-required version gate before capability-gated v3 production.
- R3: Document why the local file requires consumer-before-producer while the HTTP route can cut directly, and call out old CLI 404 behavior in release notes.
- R4: Cap automatic slug suffix retries at `-99`, then return 409.
- R5: Do not promise a Workspace display name that the daemon does not own; use Project slug plus “another workspace,” with a context-cache name only when explicitly sourced and verified.
- R6: Test the archive/event race as deterministic archive-first and event-first interleavings in D1/miniflare, not as a pretend concurrent stress test.

---

# 20. Final Product Promise

> Projects is a first-class destination in the OpenMeld App. Members of a workspace maintain shared Projects, while OpenMeld uses bounded, low-resource discovery to find, verify, and connect the corresponding repositories and worktrees on the current computer. When users start an Agent, they choose a Project and OpenMeld resolves the correct local working folder. If the current computer cannot resolve it safely, OpenMeld fails explicitly and tells the user how to fix it; it never silently starts in the wrong directory.

This approved plan does not itself authorize implementation. W-NAV1 through W-NAV5 must be complete, the implementation task must re-baseline against current HEAD, and Felix must issue an explicit Projects implementation order.
