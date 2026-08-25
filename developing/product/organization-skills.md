# Organization Skills

## Agent Context

- Purpose: Define the Organization Skill product, authority, release, runtime,
  Web, Center Agent, CLI, and local-agent contract.
- Read this when: Changing Center Agent Skills navigation, Agent Skills import
  or editing, Skill permissions, release storage, Flue integration, Skill-aware
  delegation, or `openmeld skills`.
- Update this when: Any Organization Skill surface, authority rule, portable
  bundle contract, release behavior, runtime integration, or CLI behavior
  changes.
- Do not use this for: OpenMeld's mandatory system prompt, internal operating
  playbooks, OpenMeld-managed local setup assets, general App/tool authority,
  Routine scheduling, or future Self-Evolution behavior.
- Source of truth: This file owns Organization Skills across OpenMeld product
  surfaces. Data and wire shapes remain implemented by their scoped
  architecture owners.

## Product Definition

An **Organization Skill** is an optional, Organization-owned, reusable way of
working that can teach the Center Agent and explicitly selected local agents
how to complete a class of tasks.

There is one user-facing Skill kind: **Organization Skill**. OpenMeld must not
add user-facing `internal`, `external`, `built-in`, `required`, `workgroup`, or
`system` Skill categories.

Every Organization Skill:

- belongs to exactly one Organization;
- is visible to every current member of that Organization;
- may be enabled or disabled;
- is represented by one stable Skill identity and immutable releases;
- is editable only through Organization authority;
- uses the portable Agent Skills bundle format;
- cannot grant itself an App, tool, permission, network path, execution
  environment, or destructive authority.

An Organization with zero Skills is valid. OpenMeld does not install a hidden
required Organization Skill to make the Center Agent work.

## What Is Not An Organization Skill

The following are mandatory product or runtime behavior and stay internal:

- Center Agent identity and product role;
- information-protection guidance;
- authorization, destructive-confirmation, and attribution rules;
- execution routing and Runtime selection boundaries;
- tool contracts and tool-specific operating guidance;
- first-contact, setup, readiness, and handoff behavior needed for OpenMeld to
  operate correctly;
- Flue durability, recovery, compaction, and Sandbox trust boundaries;
- OpenMeld-managed helper instructions installed by local setup.

These may remain split into internal prompt modules or operating playbooks for
maintainability. They must not appear in the Organization Skills catalog and
must not become user-editable or optional merely to reduce the system prompt.

Use the surrounding product owners for adjacent concepts:

- **Organization Documents** store Organization facts and shared knowledge.
- **Apps, tools, and MCP connections** provide data access and actions.
- **Permissions** decide who may do what.
- **Routines** decide when the Center Agent runs.
- **Projects** provide Organization and local execution context.
- **Organization Skills** describe a repeatable method.

Example: `weekly-customer-risk-review` may describe how to collect signals,
assess risk, and write the report. CRM and Slack Apps provide data. Organization
Documents provide customer or policy facts. A Routine chooses Friday at 3 PM.
Core authority decides whether any read, message, or external write is allowed.

## Portable Bundle Contract

OpenMeld uses the open Agent Skills bundle as its canonical content format:

```text
skill-name/
├── SKILL.md
├── references/
├── assets/
└── scripts/
```

`SKILL.md` contains YAML frontmatter plus Markdown instructions. Phase 1
supports the portable core fields:

- required `name`;
- required `description`;
- optional `license`;
- optional `compatibility`;
- optional string-to-string `metadata`;
- optional `allowed-tools`, preserved as source content but never treated as
  OpenMeld authority.

OpenMeld-specific ownership, source, permission, release, digest, enablement,
and audit facts live in the Core registry. They must not be inserted as
OpenMeld-only top-level frontmatter fields into the portable `SKILL.md`.

The imported original bundle and every OpenMeld-created release must remain
exportable as a valid portable Agent Skills directory.

### Phase 1 file policy

- `SKILL.md` instructions are editable as CommonMark + GFM through the shared
  Plate WYSIWYG editor.
- Markdown files under `references/` use the same editor.
- Other bounded UTF-8 reference files are readable in Phase 1.
- Binary assets are visible by name, size, and media type and may be viewed or
  downloaded through an authenticated path.
- Script files are visible but display **Not executable**.
- OpenMeld does not execute imported or user-authored Skill scripts in Phase 1.
- Symlinks, absolute paths, normalized `..` traversal, device files, duplicate
  normalized paths, and files outside the bundle root are rejected.

The product imposes bounded file count, text size, total uncompressed size, and
instruction length limits below platform limits. Validation failures are
specific and visible; import must never silently drop or rewrite unsafe files.
Phase 1 accepts at most 128 bundled files, 256,000 bytes per file, and
2,000,000 uncompressed bytes across instructions and resources. GitHub tree
metadata is checked before blob downloads, and downloaded bytes are checked
again.

## Identity, Release, And Save Semantics

A stable Organization Skill identity is separate from its portable `name`.
Renaming a Skill changes the bundle name in a new release without changing the
OpenMeld Skill id.

Every saved or imported version creates an immutable **Organization Skill
Release**:

- the release has a stable release id;
- its complete file manifest and bytes produce one SHA-256 digest;
- its R2 object prefix is immutable;
- it records source provenance and the verified actor;
- it is never overwritten in place.

The Skill record holds the active release pointer and enabled state.

Phase 1 has no separate Draft or Publish mode. Browser-local edits are
**unsaved changes**. A successful **Save**:

1. validates the complete bundle;
2. compares the expected active release or Skill version;
3. writes a new immutable release;
4. atomically updates the active release pointer; and
5. makes the release available to future admitted turns and tasks.

An in-flight Center Agent turn, Routine Run, or local-agent delivery stays
pinned to the exact releases selected at admission. A concurrent Save affects
future work only.

Concurrent editors must not overwrite each other. A stale expected release or
version returns a conflict and leaves both the active release and the editor's
local content intact for reload or comparison.

Phase 1 exposes release history for inspection but does not provide a Restore
action. A future Restore must create another immutable release whose content is
copied from the selected historical release; it must never move the active
pointer backward.

## Source And GitHub Import

Source is provenance, not a user-facing Skill type.

Phase 1 accepts a GitHub repository, tree, or file URL that resolves to exactly
one public Skill directory. Core authenticates its bounded GitHub REST metadata
reads with an OpenMeld operator secret so production traffic does not share the
anonymous per-IP rate limit. If GitHub rejects that credential with an
authentication, authorization, or repository-scope response, Core retries the
same public metadata read once without credentials. The secret never enters a
Skill, client response, or model-visible context. Import:

1. resolves the repository, ref, and directory;
2. resolves the ref to an immutable commit SHA;
3. reads the bounded bundle;
4. validates and previews metadata, files, scripts, license, and warnings;
5. creates the stable Skill and first immutable OpenMeld release; and
6. records repository, directory, commit SHA, and digest.

An ambiguous repository containing multiple Skills requires an exact user
selection. OpenMeld does not guess the intended directory.

Editing an imported Skill in OpenMeld creates an OpenMeld-authored release based
on the imported commit. It does not write back to GitHub. The UI preserves
**Based on GitHub commit ...** provenance. A later upstream update must show a
diff and must never overwrite OpenMeld edits silently.

The Center Agent may install a GitHub Skill for a verified represented member
through the same Core service as Web. An explicit request with an exact URL is
ordinary installation authority when the represented member may install. If
the Center Agent recommends an unrequested installation, it asks once with the
exact source and effect.

The Center Agent may also author and install a complete portable bundle when a
verified owner or admin explicitly asks for a Skill in conversation. It first
previews a GitHub source to resolve the immutable commit, uses one stable
operation id for an exact installation retry, and never exposes installation
to Routine Runs. Listing and reading remain available to every current
Organization member, including a connected Message Channel member admitted
through a connected workspace. Connected Message Channel members cannot preview
GitHub sources, install, or mutate Skills because those actions require a
verified OpenMeld identity and owner/admin authority. Conversational
installation returns a bounded Skill summary; full instructions and files
remain available through an explicit Skill read.

## Permissions And Maintainers

Every current Organization member may:

- list enabled and disabled Skills;
- open metadata, instructions, references, assets, source, and release history;
- use an enabled Skill through the Center Agent;
- load an enabled Skill through the authenticated CLI.

Owners and admins may:

- create or install a Skill;
- enable or disable it;
- edit and save any Skill;
- assign or remove Skill Maintainers;
- remove a Skill from the Organization.

An assigned **Skill Maintainer** may edit and Save that Skill. A maintainer may
not install another Skill, enable or disable a Skill, manage maintainers, or
remove a Skill unless they are also an owner or admin.

Maintainer authority is stored by stable user id and rechecks current
Organization membership on every mutation. Removing a member removes effective
maintainer authority immediately. The UI projection is not authority; Core
enforces the same rule for Web and Center Agent calls.

Skill removal is destructive and requires one explicit confirmation naming the
Skill and Organization. Phase 1 removes it from active Organization use and
retains immutable release/audit evidence according to retention policy. A
removed Skill cannot appear in runtime or CLI snapshots.

## Web Product

Center Agent owns no secondary sidebar. Its primary header navigation is:

1. **Messages**
2. **Graph**
3. **Files**
4. **Tasks**
5. **Routines**
6. **Skills**
7. **Apps**

One compact header menu preserves **Channels**, **Memory**, and **Center Agent
settings**. Skills remains one capability inside
that product home; required system behavior remains internal. The Center Agent
remains one primary-rail destination.

Canonical routes are:

```text
/o/{orgSlug}/center-agent/chat
/o/{orgSlug}/center-agent/routines
/o/{orgSlug}/center-agent/skills
/o/{orgSlug}/center-agent/skills/{skillId}
/o/{orgSlug}/center-agent/channels
/o/{orgSlug}/center-agent/apps
/o/{orgSlug}/center-agent/apps/{service}
/o/{orgSlug}/center-agent/memory
/o/{orgSlug}/center-agent/settings
```

The Skills list shows all Organization Skills without a type filter. It offers
search, **Create skill**, and **Install from GitHub**. Each row shows name,
description, enabled state, source summary, and last update.

In a personal workspace, Web uses personal-workspace copy for this same
Organization Skill model. This is presentation only; it must not introduce a
separate Personal Skill type, storage scope, permission model, or runtime
catalog.

The detail page is directly editable when the current member may edit. It does
not have View/Edit modes. A read-only member sees the same content surface
without editable controls.

Portable frontmatter fields use labeled form controls. Instructions and
Markdown references use one shared Plate WYSIWYG editor whose persisted value
is CommonMark + GFM. The editor does not expose raw frontmatter as editable
Markdown.

The Save lifecycle uses the shared status vocabulary:

- **Unsaved changes**
- **Saving…**
- **Saved**
- **Couldn't save**

Internal navigation with unsaved changes opens:

- title: **Save changes before leaving?**
- body: **Your changes to this skill haven't been saved.**
- actions: **Cancel**, **Discard changes**, **Save and leave**

**Save and leave** awaits a successful Save before proceeding. A failure keeps
the user on the page. Browser refresh, close, or external navigation uses the
native browser before-unload prompt.

The unsaved-changes guard and Markdown editor are shared Web primitives used by
Organization Documents and Organization Skills. Do not create a second Plate
configuration or page-specific navigation blocker.

## Core Data And Storage Ownership

Core owns Organization Skill identity, authority, enabled state, active release,
maintainers, provenance, import validation, and audit.

D1 stores relational truth:

- stable Skill identity and Organization ownership;
- normalized current name and description for listing;
- enabled and removed state;
- active release id and optimistic concurrency version;
- source provenance;
- maintainer membership;
- immutable release metadata, manifest digest, and R2 prefix;
- actor, represented member, and lifecycle audit.

R2 stores immutable release bytes. Keys are Organization-, Skill-, and
release-scoped. Core writes and reads the private bucket through a dedicated
binding. Web, the browser, CLI, and Remote Agent do not receive bucket authority
or construct R2 keys.

The complete bundle does not live in D1 rows. R2 object metadata is not
relational authority.

Core must make release creation recoverable. The D1 active pointer may advance
only after every immutable object needed by the release exists and matches the
canonical manifest. An unreferenced completed R2 prefix may be cleaned by a
bounded repair job; a referenced release must never point at missing or
digest-mismatched content.

## Center Agent And Flue Runtime

Flue is the only model-visible Skill runtime for the hosted Center Agent.
OpenMeld does not also mount Cloudflare `agents/skills` tools in the same turn.

For every admitted Center Agent turn or Routine Run:

1. the immutable execution context establishes Organization and represented
   member identity;
2. Core returns the exact enabled Organization Skill release snapshot;
3. the snapshot contains stable Skill ids, release ids, portable metadata,
   canonical manifest, digest, and Core-authorized bundle read data;
4. Remote Agent reads exact immutable release bytes and verifies the digest;
5. the Flue adapter constructs definition-provided Skills through Flue's public
   API;
6. Flue owns catalog disclosure, `activate_skill`, and lazy resource reads.

OpenMeld keeps Sandbox workspace discovery disabled. Files written by the model
or tools into a long-lived Sandbox must not become later `AGENTS.md`,
`CLAUDE.md`, directory context, or Skills.

Disabling workspace discovery must not remove definition-provided Skill catalog
entries. The Flue adapter requires contract tests proving both sides:

- a Sandbox-written Skill is not discovered;
- an explicitly mounted Organization Skill appears in **Available Skills**,
  activates, and reads a packaged resource.

An enabled Skill that Core selected but Remote Agent cannot load is a visible
admission failure. The worker must not silently omit it.

`allowed-tools` remains portable source metadata only. OpenMeld does not pass
it into Flue tool selection or permission policy. Skill instructions cannot
grant an action. Effective actions remain the intersection of active tools,
represented-member authority, Organization policy, App connection scope,
runtime policy, and action-specific confirmation.

At most 64 Skills and 16,000,000 canonical bundle bytes may be enabled at one
time. Install and Enable reject an action that would exceed either limit before
the catalog becomes invalid. Runtime admission independently rechecks both
limits and fails closed if storage has drifted.

Activation telemetry records Organization id, Skill id, release id, digest,
submission id, and Routine Run id when present. It never logs full instructions
or protected resource content.

## Center Agent Management Surface

The Center Agent uses the same Core services as Web for:

- list and show;
- GitHub import preview and installation; and
- authoring and installing a complete portable bundle after an explicit
  owner/admin request.

Enable, disable, maintainer assignment, editing, release history, and removal
remain on the Web management surface in Phase 1.

Tool inputs never accept caller-supplied Organization role or maintainer
authority. Core derives the represented member from the accepted Center Agent
turn and authorizes every action.

Mutation retries use an immutable request signature and operation id. An exact
replay returns the prior result; conflicting input under one operation id is
rejected before GitHub, R2, or D1 mutation.

## CLI And Local Agents

`openmeld skills` is the canonical Organization Skills command group.

Phase 1 exposes:

```text
openmeld skills list
openmeld skills show <name-or-id>
openmeld skills load <name-or-id>
```

Every command supports Human View, `--view agent`, and the existing explicit
`--json` output contract where applicable. Responses use shared strict schemas.

The previous top-level `openmeld skills` setup commands manage OpenMeld's own
local helper instructions, not Organization Skills. Their canonical ownership
moves to Setup and Doctor. Existing `ensure`, `install`, `uninstall`, `check`,
and `update` spellings remain deprecated compatibility aliases for one
published CLI compatibility window and print the replacement guidance. The
ambiguous legacy `skills list` changes to Organization Skills; Setup and Doctor
own local helper status.

`load` authenticates the current account and Organization, resolves an enabled
release through Core, downloads the exact bundle, verifies its digest, and
materializes a private read-only cache:

```text
{OPENMELD_HOME}/organization-skills/
  {organizationId}/{skillId}/{releaseId}/
```

The Agent View result includes Organization id, Skill id, release id, digest,
`SKILL.md` path, and bounded resource paths. It does not expose credentials or
R2 keys.

OpenMeld never automatically copies Organization Skills into a user's global
Codex, Claude, Cursor, or `.agents/skills` directories. Global installation
would leak across Organizations, conflict by name, and lose exact-release
semantics.

The OpenMeld-managed local helper Skill teaches local agents how to call the
authenticated `openmeld skills` read/load commands. That helper remains a
setup integration asset and does not become an Organization Skill.

The same helper owns the supported Local Agent collaboration recipe: request a
bounded Center Agent Context Manifest only when useful, verify that its entries
reached the current working context, then run the exact Context Load Receipt
command returned in Agent View. It also teaches the harness to preserve
canonical Task references returned by `center-agent ask` and never resubmit
work that the Center Agent already made durable. These instructions orchestrate
public commands; they do not install Organization Skills globally, create a
second chat store, or claim model reliance.

## Local-Agent Access

Phase 1 gives local agents an explicit authenticated CLI path: list, show, and
load one enabled exact release. The Center Agent or a team member can include
the stable Skill name or id in task instructions, and the OpenMeld-managed
local helper teaches the receiving agent to call `openmeld skills load`.

Structured automatic injection into a child Wake request is deferred. Phase 1
does not silently copy Organization Skills into local agent directories,
rewrite a local agent's global catalog, or claim that an ordinary Wake used a
Skill merely because the Organization had it enabled.

## Self-Evolution Boundary

Center Agent Self-Evolution does not create, edit, enable, disable, or update
Organization Skills in Phase 1.

The release and provenance model intentionally supports a future reviewed
Self-Evolution proposal, but no scheduler, automatic update policy, or
autonomous Skill mutation is added by this feature.

## Phase 1 Negative Acceptance Checklist

The implementation is incomplete if any of the following appears or succeeds:

- a built-in or required item appears in Organization Skills;
- the Center Agent needs an Organization Skill to operate with an empty catalog;
- a connected Message Channel member previews GitHub sources, installs, enables,
  disables, edits, restores, removes, or reassigns maintainers for a Skill;
- an ordinary member edits an unassigned Skill;
- a maintainer enables, disables, restores, removes, or reassigns maintainers
  without owner/admin authority;
- a Skill grants a tool, App, network path, shell permission, or destructive
  action;
- a third-party Skill script executes;
- raw R2 keys or credentials reach Web, CLI, or model context;
- a release is overwritten in place;
- a Save changes an in-flight task's frozen release;
- a GitHub update overwrites OpenMeld edits without review;
- a Sandbox-written Skill enters a later Center Agent catalog;
- an explicit Organization Skill disappears silently at runtime;
- an Organization Skill is copied automatically into a global local-agent
  Skill directory;
- another Organization lists, reads, loads, or receives a Skill;
- Web, Center Agent, and CLI implement separate permission rules.

## Production Acceptance

Before release, prove through user-accessible entry points:

- Web can create and install from GitHub, list, open, edit, Save, enable,
  disable, assign a maintainer, inspect release history, and remove with correct
  authority;
- WYSIWYG CommonMark + GFM survives Save/reload and unsaved navigation behaves
  correctly;
- a Center Agent turn sees and activates the exact enabled release;
- a disabled Skill is absent from a future turn;
- Center Agent installation uses represented-member authority and is replay
  safe;
- published CLI can list, show, and load the same release;
- one local agent can follow the OpenMeld-managed helper to load the exact
  release through published CLI;
- cross-Organization, stale-version, missing-object, digest-mismatch, duplicate
  name, and script-execution negative paths fail visibly;
- activation evidence correlates Skill, release, Center Agent submission, and
  Routine Run when present.

Internal HTTP, D1, R2, or RPC inspection may support diagnosis but is not
real-user smoke evidence.
