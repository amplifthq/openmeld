# Project Workflow Design

## Agent Context

- Purpose: Define the approved design for connecting the existing Project identity to work, Agent Profiles, code repositories, and external issue destinations while preserving the responsibilities of Spaces, Tasks, Bindings, and provider integrations.
- Read this when: Evaluating Project-aware Task association, issue routing, Agent selection, or the Projects, Space, and Task user experience.
- Update this when: The proposal is accepted, rejected, implemented, or changed by a scoped owner contract.
- Do not use this for: Current production behavior, permission grants, execution authority, a generic project-management framework, or an implementation shortcut around the scoped owner documents.
- Source of truth: This file records the approved design and its acceptance scope. Implemented behavior remains owned by `developing/product/projects.md`, `agent-profiles.md`, `space-collaboration.md`, `space-tasks-design.md` while it exists, `organizations-and-center-agent.md`, and their architecture and client owners until those documents change with the implementation.

Status: IMPLEMENTING — the user confirmed all fifteen interview decisions and the consolidated design on 2026-09-24. Draft PR #1286 now contains source implementations for Project configuration, issue routing, Task associations, provider-typed references, explicit per-Context repository selection, same-owner shared local folders, and partial Session attribution. Installed Service, deployed provider, mixed-version, complete Project/Task UI, and end-to-end user acceptance remain open; this document does not certify deployment or provider capability.

Removal condition: Remove when the accepted design ships and its durable rules have been incorporated into the scoped owner documents, or when the proposal is rejected or superseded. Git history is the archive.

## Design Interview

The name **Project** and Q1–Q15 below were explicitly confirmed in discussion.
The text below incorporates those decisions and preserves existing owner
contracts except for the extensions called out in the implementation impact
section. The user confirmed the consolidated design with "OK, no problem" on
2026-09-24. The design interview is complete; implementation remains a separate
request.

| Decision branch | Current status | Dependent decisions |
| --- | --- | --- |
| Product name: Project or Context | Confirmed: Project. Execution Context keeps its existing meaning. | Product copy and glossary. |
| Q1 — What one Project represents | Confirmed, round 1: a durable body of work, with zero, one, or several repositories; non-code Projects are valid. | Repository selection, cross-Project work, and migration. |
| Q2 — Agent relationships | Confirmed, round 1: explicitly configurable Common Agents, available before any work history exists. One Agent may appear in several Projects. The list assists selection; assignment and execution remain explicit. | Management rights and eligibility presentation. |
| Q3 — First-release entry journey | Confirmed, round 1: select Project within existing Space work; Project pages provide configuration and viewing. Starting work from a Project page is deferred. | Composer, Task detail, configuration, and delivery slices. |
| Q4 — Code context versus issue destination | Confirmed, round 1: a GitHub PR reference does not override a configured Linear destination for new issues. Use the Project rule without another destination question; an explicit request to create in GitHub overrides it. | Routing precedence and acceptance. |
| Q5 — Sharing a repository across Projects | Confirmed, round 2: a repository may be associated with several Projects in the same Organization. A repository match may therefore leave Project selection ambiguous. | Repository-to-Project inference and local connection attribution. |
| Q6 — A Task spanning Projects | Confirmed, round 2: one Task may associate several Projects. Each operation resolves its own relevant Project and exact target; list order selects neither. Split Tasks for independent deliverables or responsibility, not merely to fit repository or Project counts. | Task association and action-specific Project selection. |
| Q7 — Managing Project configuration | Confirmed, round 2: reuse current Project management rights. The creator may configure their Project and the Organization owner may configure all Projects. This adds no general admin or maintainer permission. | Repository associations, default issue destination, and Common Agents use the same management boundary. |
| Q8 — Initial routing configuration | Confirmed, round 2: one default issue destination per Project in the first release. Explicit per-request destinations override it; work-kind rules are deferred. | Exact target configuration and one-time overrides. |
| Q9 — Routing entrypoints | Confirmed, round 2: use the same routing rule in all supported OpenMeld-controlled Space, DM, CLI, and Routine actions; no Task prerequisite. Independent local tools remain outside server enforcement. | Shared resolution, validation, and unattended ambiguity handling. |
| Q10 — Default repository for code work | Confirmed, round 3: a Project may configure one optional default code repository. Explicit repository intent wins; otherwise use that default, use an unambiguous sole repository, or ask when several candidates remain. Existing execution continuity retains its accepted repository. | Repository selection and connection validation. |
| Q11 — Repositories within one execution | Confirmed, round 3: each first-release code execution uses one repository/workspace. A cross-repository Task can link several executions and retain one delivery and acceptance boundary. | Reuse existing execution isolation and recovery. |
| Q12 — Shared-repository Session attribution | Confirmed, round 3: attribute Session metadata only when Project scope is explicit or unambiguous and existing Activity collection rules permit it. Request missing attribution; do not fan out observations to every Project sharing the repository or relabel historical evidence. | Local observation and source coverage changes. |
| Q13 — Common Agent outside the current Space | Confirmed, round 3: provide an explicit Add and assign action in the assignment flow, showing the Agent and any owner who will join. Use existing membership authority before Task assignment; neither shortlist selection nor assignment starts execution. | Membership/assignment partial outcomes and UI disclosure. |
| Q14 — One local folder used for several Projects | Confirmed, round 4: allow the same owner, Organization, Computer, and lane to reuse a verified local folder for several associated Projects with explicit work attribution. Conflicting writes are governed by the actual folder resource across all Project associations. | Replace the current exclusive Project attribution of a local connection without widening owner or Organization access. |
| Q15 — Linear result association in the first release | Confirmed, round 4: GitHub and Linear issue creation both support exact external references on eligible Tasks. Requests without a Task still return the normal issue result. Linear event subscriptions, close synchronization, and automatic follow-up remain deferred. | Typed provider references, creation receipts, and association recovery. |

The product decision frontier is empty and final shared understanding is
confirmed. Implementation begins when requested. Repository glossary and
scoped owner documents remain the canonical
homes for terminology and implemented behavior. The rationale below preserves
the design trade-offs until those owners incorporate the accepted change.

Round 1 rationale: repository topology must not determine Project identity;
explicit Common Agents must work on the first day; the first delivery targets
the observed Space routing failure; and a configured issue destination should
remove repeated choices even when the code under discussion lives elsewhere.
These are accepted design decisions. Current single-repository contracts and
runtime capabilities still require implementation and migration work.

Round 2 rationale: shared repositories and cross-Project deliverables are
normal relationships, so their identity must be modeled independently. Keeping
one issue destination and existing Project management rights limits first-release
configuration. A request should follow the same Project rule across supported
OpenMeld entrypoints, whether or not it has a Task. These relationship decisions
require schema and local-connection changes; they do not retroactively widen
the existing Session observation or execution contracts.

Round 3 rationale: an explicit repository default avoids repeated selection,
while preserving one repository per execution keeps the first release within
the current isolation and recovery model. Session attribution follows actual
work scope and collection permission. Add and assign removes navigation steps
while making the existing Agent-owner participation consequence visible.

Round 4 rationale: shared code should not require duplicate clones merely to
express different business Projects. Reusing a folder must also reuse its
resource-conflict boundary. Selecting Linear should preserve the same Task
result traceability as selecting GitHub, while provider event monitoring has a
separate capability and delivery cost.

## Decision

Keep **Project** as the durable Organization-scoped product object. The existing Project already identifies a shared body of work; this design extends its relationships and configuration under the same Project IDs and Core writer. Do not create a second workflow Project store or API, or make members recreate their Projects. A Project may associate zero, one, or several code repositories, and non-code work can have a Project. **Execution Context** retains its existing, narrower meaning beneath an Agent Profile.

Make a concrete piece of work identify its known Project scope. A Task may associate several Projects; an individual operation still resolves its relevant Project and exact target. A Space can discuss more than one Project, so Space location alone cannot choose a Project, Agent, repository, or external issue destination. A Task remains owned by its Space; Project association adds work scope, not another Task writer or permission owner.

Project configuration may suggest where work should happen. It never authorizes a Wake, grants access to another member's Agent or Computer, installs an App, or permits an external write. Existing owners revalidate each effect at execution time.

## Current Baseline And Gap

| Current fact | Consequence |
| --- | --- |
| An Organization is the only resource container; **Workspace** is the Web label for the selected personal or collaborative Organization. | Project remains inside one Organization. A local working folder is not a Workspace or a cloud Project. |
| Project has a stable ID, name, slug, optional canonical Repository URL and fingerprint, and owner-self Local Project Connections. A local Agent Profile may have a `defaultProjectId` for future work. | Project currently helps choose a local folder and group Agent Activity. A Profile default is neither permanent Project membership nor a per-Task Project decision. |
| Agent Profile is the teammate identity; Binding and the relevant runtime own the execution connection. Local, personal Remote, and Center Agents have different execution capabilities. | A Project cannot infer an Agent's ability to perform code or provider actions from its name, default Project, or recent Activity. |
| Space owns collaboration, access, messages, and visible outcomes. A Space Task has one immutable owning Space, an optional assignee and reviewer, and source-message and Thread references. The current Task schema has no `projectId`. | A mixed-Project Space cannot consistently show which Project a Task is about or route a later external action from the Task alone. |
| Project edit currently covers name, slug, and repository identity. Space Task external work item support is currently GitHub-specific; Linear association is deferred. | There is no Project-owned GitHub-versus-Linear issue destination rule. Issue [#1251](https://github.com/amplifthq/openmeld/issues/1251) records an actual wrong-system write caused by this gap. |

This baseline describes the current source and owner contracts, including work in progress. It does not certify installed or production behavior.

## Target Product Model

| Object or relationship | Meaning | Authority boundary |
| --- | --- | --- |
| Project | Stable Organization-scoped work identity and controlled work configuration. | Core Project owner; no local path or credential stored in Project. |
| Project repository | One explicit association between a Project and a canonical code repository. A Project may have several repositories or none, and a repository may be associated with several Projects in the same Organization. | Project records the association; the provider and authorized connection own repository access and mutations. Repository identity alone need not resolve one Project. |
| Default code repository | One optional repository association used for new code work when the Project is resolved and the request supplies no more specific repository intent. | Project managers configure it under the existing Project policy. It selects no local path, grants no repository access, and cannot change a retained Execution Context. |
| Default issue destination | One configured target for new issues in a Project, such as a GitHub owner/repo or a Linear team and optional provider project. | Project configuration supplies routing evidence. The provider integration owns connection, permission, target validation, and write receipt. Per-request explicit targets override the default. |
| Task Project association | The set of Projects explicitly associated with an accepted deliverable. It may be empty, contain one Project, or contain several. | The owning Space Task remains the only Task writer and visibility owner. No primary Project is invented from association order. Each operation resolves its exact scope and target. |
| Space–Project relationship | Navigation and context hints for the Projects discussed in a Space. | Space access controls visibility. A Space association is not a default write target and cannot replace the Task or request's exact Project selection. No persisted Space–Project membership is required by the first slice. |
| Common Agents | The explicitly configured shortlist of Agent Profiles usually chosen for a Project. It exists independently of observed work history, and a Profile may be listed in several Projects. | Project owns the shortlist; Agent Profile owns identity; Space owns participation; Task owns assignment; Binding, provider capability, and file/App policies own execution eligibility. Adding a Common Agent grants no access or automatic assignment. |

Project–repository, Task–Project, and Common Agent relationships are many-to-many within an Organization. One Space may contain Tasks for several Projects, and one Task may span Projects while retaining one primary assignee and one optional reviewer under the existing Task contract. These associations grant no additional access to private source material.

### Selecting a Project for work

Resolve the Project scope relevant to the current action from an explicit Project choice, repository or PR URL, issue URL, or verified Task associations. Use trusted, current relationships to narrow candidates. A repository or multi-Project Task can match several Projects; neither creates a first-match default. A Space's related Projects and an Agent Profile's Default Project are suggestions only for business attribution. If evidence conflicts or several Projects with different applicable targets remain plausible, preserve the unknown state and ask one question naming the concrete alternatives before a Project-dependent external write or execution.

Add explicit Project associations to new eligible Tasks and Task reads. Existing Tasks remain unassociated until an authorized, explicit choice is made; do not backfill from titles, the last Space conversation, local paths, or linked issue labels. Changing the Project set is a revision-checked Task scope mutation. It affects future work only. Already admitted executions and accepted external operation targets keep their frozen identities and receipts.

One deliverable with one responsibility and completion boundary can remain one Task across Projects or repositories. Split work when it has independently assignable deliverables, owners, or acceptance, rather than to satisfy a one-Project field. For example, a coordinated billing change may link both Payments and Developer Platform while a particular issue creation chooses one exact destination. Never create one issue per associated Project unless the request explicitly calls for those separate effects.

For local execution, resolve the operation's explicit Project and repository through the current owner's verified local connection and file policy on the selected Computer. The existing `defaultProjectId` remains a working-folder preference for requests without an explicit Project selection; it does not label unrelated business work or authorize external issue routing. A retained Execution Context keeps its accepted workspace and conversation identity: selecting a different Project for a Task cannot silently move or resume that Context in another repository. The caller must request a supported new context or receive an explicit blocker. Personal Remote and Center Agents can receive Project identity and authorized Project reads without pretending to have a local folder; code or external actions require their actual supported capabilities. This explicit per-work selection needs a shared cross-process contract and validation before the UI can promise it.

### Selecting a repository and local workspace

A Project may have one optional default code repository, configured by its
existing managers. For new code work, select the exact repository explicitly
named or unambiguously identified by the request. Otherwise use the resolved
Project's configured default. If no default exists and only one repository is
associated, use that repository; if several candidates remain, ask once. A
repositoryless Project remains valid for non-code work and has no implicit
code workspace.

An unavailable configured default is a blocker, not permission to select
another repository. Validate the selected repository and the current owner's
local connection on the executing Computer. Multiple clones and worktrees of
that repository still require the supported connection selection rules.
Neither Project defaults nor a repository list order supply an absolute path.
Existing Profile defaults need a compatible mapping to the selected repository;
that mapping must preserve the old single-repository behavior during migration.

Each first-release code execution accepts one repository/workspace under the
existing isolation, file-policy, and continuity contracts. One Task may link
separate executions for its several repositories and then receive one result
against its completion conditions. This does not automatically create sub-Tasks
or a new scheduler. A retained Execution Context cannot be moved to another
repository through a Project default change.

### Reusing a local folder across Projects

The same owner may reuse a verified folder for several Projects associated with
its repository in the same Organization, Computer, and lane. The local owner
must explicitly authorize the additional Project use. A cloud repository
association alone does not register a local connection, enable observation,
or change another owner's Computer. Cross-Organization, cross-owner, and
cross-lane reuse are outside this extension and retain their current rules.

Keep one canonical local resource identity for that folder and use explicit
Project associations to describe its authorized uses. Private paths remain
device-local. Each new execution records its selected Project and repository,
then checks the matching local use and current file policy. Changing a Project
label must never bypass a current-folder write conflict: conflicting writers
across all Project associations of the same folder still serialize through the
existing resource owner. Isolated executions retain their own verified
workspaces and established execution admission.

Removing one Project's association does not delete the folder or remove another
Project's authorized use. It also does not rewrite a running execution's frozen
workspace or duplicate its resource claim. The local connection owner must
replace the current exclusive-Project model deliberately; allowing duplicate
connection rows while keeping the old first-match resolver is insufficient.

### Session attribution for shared repositories

A repository's Project associations do not by themselves attribute every native
Session to every associated Project. Require explicit or unambiguous work scope
and the existing opt-in, ownership, and metadata-only Activity rules. When
scope is ambiguous, request the missing attribution instead of publishing it
as work for all candidates. Do not inspect private transcript content to infer
business attribution. Existing historical Activity retains its original
attribution; adding a Project association is not a historical reclassification.

The current canonical-folder contract and Session reconciler assume one Project
per authorized connection. The new shared-folder model must resolve actual
work attribution before publishing Project-specific Session metadata. Explicit
OpenMeld work scope is attribution evidence, not a substitute for collection
consent. For native sessions without that scope, ambiguous folder associations
need a user decision. That observation gap remains visible and must not be
reported as a complete empty inventory or an Agent execution failure. Activity
continues to follow its own completeness, stale-data, and retention rules.

### Routing an external issue

Resolve the work object and any Project scope needed to apply a default, then choose the destination in this order. A request that already names an exact authorized destination can proceed without a Project association; do not require or automatically create a Project or Task merely to route it.

1. The user's explicit provider or exact target in the current request. Resolve any missing target detail from a compatible verified Project rule; do not let an incompatible rule override the explicit choice.
2. The current, verified default issue destination of the Project relevant to this action.
3. A sufficiently clear, object-specific target from trusted context when no applicable rule exists.
4. One short clarification when the remaining targets conflict or cannot be established.

An Agent's choice of a provider tool and its exact input arguments is not proof
that the requester chose that destination. In particular, a GitHub PR cited as
background must not become an explicit GitHub override merely because the Agent
called a GitHub issue tool. A supported OpenMeld action resolves the target from
the verified current request, an explicit user selection when present, and the
Project rule before invoking a provider. The resolution carries its basis and
the Project configuration revision when a default was used. The action owner
checks the eventual provider and target against that decision and rejects a
mismatch. A model-supplied `explicit` flag or quoted fragment is evidence for
interpretation, not independent user authority. Natural-language destination
intent can require interpretation; if the request does not clearly identify a
real override, ask about the concrete target instead of claiming mechanical
certainty. A clear request such as “create it in this GitHub repository” follows
that explicit target through normal authorization without another generic
confirmation step.

A PR or issue cited as background identifies the work being discussed. For a new issue, that reference alone does not select a destination or conflict with a Project's configured tracker. If a Project's default issue destination is Linear, a request to file an issue about its GitHub PR creates the Linear issue and links the PR without another destination question. An explicit instruction to create the issue in that GitHub repository overrides the Project default. Updating or commenting on an existing issue still targets that exact existing object.

A configured destination is not write permission. Before writing, recheck the requester, current Project and target, provider connection and actor identity, provider capability, and the action's authorization. An unavailable connection blocks that destination; it never causes an automatic switch to another provider or account. Report the actual provider, target, and created link after a successful write. Preserve `outcome_unknown` when the provider effect cannot be determined, and do not blindly retry it.

Before an external action is accepted, recheck any Project configuration
revision used to select its destination. If the applicable default changed,
resolve again and show a materially different destination before execution;
an unrelated Project edit does not invalidate a fully explicit user target.
After acceptance, freeze the exact provider target and operation identity in
the existing action owner's record. Recovery retries that accepted effect
without consulting a later default or switching providers, while current
authorization and connection access must still pass. Confirmed creation and
Task-reference recovery remain separate effects as described below.

The first release provides one optional default issue destination per Project. It does not classify requests into bug, feature, or internal-tracking routes; work-kind overrides are deferred. An explicit destination applies to that request and does not automatically rewrite Project configuration. Do not introduce an arbitrary rule language, automatic GitHub-plus-Linear double writes, or a universal status mapping. A Project may use different systems for code and issue tracking. External issues remain provider-owned references on Space Tasks; they are not another Task lifecycle.

Repository associations, the default code repository, the default issue destination, and Common Agents reuse the existing Project management policy: members can configure Projects they created and the Organization owner can configure all Projects. An admin gains no general right to edit another member's Project, and this release adds no Project maintainer role. App installation, credentials, and shared-connection administration retain their existing owners and permissions. Store configuration attribution and revision, and show the effective default to authorized readers. A configuration change never rewrites already created issues, Task references, or admitted work.

### GitHub and Linear issue results

Both providers must return their verified creation receipt and exact issue
reference. For work associated with an eligible Space Task, attach a typed
external reference that retains the provider, necessary provider scope, stable
object identity, display identifier, and usable URL. GitHub and Linear keep
their native identity semantics; a Linear issue is not encoded as a GitHub
owner/repo/number tuple. Task and Project views recheck source access and show
the created result consistently for both providers.

When no Task is associated, return the normal provider result and link. Existing
Space Task capture policy still owns whether that deliverable merits a Task;
neither Project resolution nor a DM request creates a Task by itself. References
do not transfer provider state ownership or grant automatic observation.
Existing verified GitHub capabilities remain available. Linear event
subscriptions, closure synchronization, and automatic follow-up are deferred;
the UI must not claim a linked Linear issue is being monitored.

If the provider has created the issue but attaching its Task reference fails,
preserve the exact creation receipt, report the partial result, and recover
only the association through the Task owner. Do not create the issue again.
An unknown provider outcome keeps the existing reconciliation boundary and
must not be presented as either confirmed creation or confirmed no effect.

### Routing reach

All supported OpenMeld-controlled issue-creation entrypoints must consume the
same Project routing decision: native GitHub tools, generic App actions such as
Linear operations, and Local Agent calls through `openmeld plugins call`.
This includes supported Space, DM, CLI, and Routine requests. Resolving a
Project or using its destination never requires or automatically creates a
Space Task; Task capture continues to follow its existing owner contract.
The current action inputs name exact provider targets without carrying this
Project decision, so shared resolution and execution validation are new work.

An independent Local Agent's direct `gh`, third-party MCP, or plugin invocation
can bypass these OpenMeld entrypoints. Project guidance can inform that Agent,
but it is not server enforcement of those external tools. The product must
describe that limit honestly. Unattended work that needs a new target decision
must record an actionable blocked outcome through its existing attention path.

## User Experience

### Projects home and Project detail

Retain **Projects** as the single Project home and keep creation light: name and optional Repository URL. Do not force App installation, a local folder, an issue tracker, or an Agent choice before a Project can be created. Project cards should distinguish the shared repository/work routing summary from the owner-self **This computer** connection state. A Project remains useful to personal Remote Agents and team coordination when this computer has no connection.

The first release starts work through existing Space interactions. Projects
provides configuration and authorized views; a new Project-page work composer
and automatic Space selection are deferred. Users can add further repository
associations after creating the Project.

Keep the Project detail as one continuous page, without a second Task board or nested Settings copy. As capabilities ship, organize it around:

1. **Project**: identity and associated code repositories, with an optional default code repository and a valid state with no repository.
2. **Where issues go**: one default issue destination, connection availability, and a contextual edit action for existing Project managers. The unconfigured state explains that no Project default has been set.
3. **Work and Agents**: viewer-authorized Task links back to their owning Spaces, a configurable Common Agents shortlist, and separately labeled observed work. Neither count nor preview may reveal a private Space to an unauthorized viewer.
4. **This computer**: verified local connections for the selected repositories, their allowed Project uses, applicable default folder choices, and precise repair actions. Reusing a shared folder must not appear as moving it away from another Project.

Common Agents is available before a Project has work history and prioritizes those Profiles in task-assignment choices. The same Profile may be a Common Agent for several Projects. Automated role-based assignment is deferred. Do not present an Agent as **Available** merely because it is on the shortlist or used this Project before. Show current eligibility only from the owning Agent, Binding, provider, and Project-access projections. Listing an Agent does not add it to a Space, start a Wake, or change its Default Project.

When a chosen Common Agent is not an active member of the current Space, offer
an explicit **Add and assign** step in the same flow. Show which Agent and
which owner Human Profile will join and what Space they will access. Only an
actor with the existing membership permission may add them. Apply the normal
atomic Agent-and-owner membership operation first, then the revision-checked
Task assignment. Managed Agent exceptions keep their current membership rules.
An actor without membership authority receives the existing access path rather
than an implicit invite or an assignment that bypasses membership.

The two owners have separate commit points. If membership succeeds but Task
assignment fails, report that partial outcome accurately; do not silently
remove the newly added members or claim that assignment succeeded. Retrying
assignment must not duplicate membership or overwrite a concurrent Task change.
Add and assign does not start an execution without the existing work request.

### Space, Task, and issue-action surfaces

When creating or opening an eligible Task, show its associated Projects near its title, assignee, and source. If a Project is resolved from an exact repository or PR, expose the basis and allow the authorized user to correct it before a Project-dependent action. A Task without Project remains valid for general collaboration; several Project associations are also valid. The Space's Task board can filter by Project when mixed-Project work warrants it, while its cards and lifecycle remain Space-owned. The action surface identifies the particular Project and target used for each external write rather than treating every Task association as a write destination.

At an external issue action, show the resolved provider, exact repository or team/project, and acting connection in compact preflight feedback. A clear authorized request proceeds without an extra generic approval click. If the target is ambiguous or unavailable, state one actionable choice or repair step. A configured Project rule should not hide a user's explicit override.

Keep execution-context controls separate from Project selection. The current composer label **New project task** describes an isolated Agent execution, not a selected OpenMeld Project. Rename or clarify it when introducing a Project selector so **Project**, **Space Task**, and **Agent execution context** are not presented as the same object.

## Implementation Impact And Migration

These accepted extensions require changes to current owner contracts. They
must not be implemented by relaxing a client validation or adding a second
authority alongside the existing one.

| Current owner boundary | Required extension |
| --- | --- |
| Project has one optional repository URL/fingerprint | Preserve Project identity and add canonical repository associations, same-Organization repository sharing, one optional default code repository, one optional issue destination, and Common Agents. |
| A canonical local folder belongs to one Project scope | The local connection owner must support explicit same-owner, same-Organization, same-Computer, same-lane Project uses of one verified folder while retaining one resource identity for conflict handling. |
| Session Inventory derives one Project from one folder connection | Resolve actual work attribution and preserve source completeness when a shared repository or folder leaves that attribution ambiguous. Collection consent, metadata-only disclosure, native Session identity, and historical retention keep their owners. |
| Task has no Project association and its external item schema is GitHub-only | Add a Project reference set and provider-typed GitHub/Linear issue references through the Space Task writer, including revision checks and receipt-based association recovery. |
| Local Agent Profile defaults resolve a working folder | Carry exact per-operation Project and repository selection through the shared execution contracts. Keep one workspace per execution and preserve accepted Context identity. |
| Provider actions consume exact targets independently | Reuse one Project routing decision across supported OpenMeld entrypoints. Carry selection basis and applicable configuration revision to the existing action owner; compare accepted provider inputs against the resolved target, freeze the accepted effect, and recheck live actor and connection authority. |
| Task assignment accepts active Space members | Compose the existing membership operation and Task assignment with explicit Add and assign UX and truthful partial outcomes. |

Keep existing Project IDs, Task IDs, Agent Profiles, accepted execution
identities, provider references, and historical evidence. Convert each legacy
repository association and local connection without changing its effective
repository or owner scope. Preserve configured behavior for existing Profile
defaults; do not infer new repository URLs from legacy fingerprints. Existing
Tasks remain without Project associations until explicitly associated.
The new issue destination, Common Agents, and additional repositories are
optional: an existing Project that leaves them unset still supports work that
was valid under its former repository connection and Profile defaults. A
Project-independent request with an exact authorized external target likewise
continues without creating or selecting a Project.

Deploy shared contract consumers before producers according to each owning
release contract. An older client or Service unable to represent multiple
repositories or shared-folder uses must return an explicit unsupported result;
it must not flatten those facts to the first Project or repository. A disabled
or removed Project/repository association blocks newly requested dependent work
under the existing owner rules without rewriting a Task, cancelling an unrelated
execution, moving a retained workspace, or altering an external issue.

Project configuration names destinations and preferences. It contains no App
credentials and does not change who may administer a connection. Project
aggregate reads retain each source's visibility checks, including counts and
previews. RuntimeCoordinator, native delivery, Space publication, and the Task
writer keep their current responsibilities; this design adds no execution
scheduler or independent completion authority.

## Delivery Increments And Acceptance

The approved first-release outcome includes all three acceptance areas below.
Implementation can reach useful results in four ordered increments without
making the shared-folder and Session attribution migration a prerequisite for
correct issue routing. These increments do not redefine the first release as
complete after an early milestone.

| Increment | Usable result | Boundary before the next increment |
| --- | --- | --- |
| 1 — Correct issue destination | Configure one optional Project issue default; resolve the request and target once across every supported OpenMeld-controlled entrypoint; execute with live authorization and an exact, recoverable GitHub or Linear result. Works without a Task or local folder. | Existing Project identity and current repository facts are sufficient where unambiguous. This increment does not claim Task Project association, shared local folders, or completion of the full first release. Agent-selected tool inputs do not establish a user override. |
| 2 — Work association and assignment | Add Task Project sets, typed GitHub and Linear issue references on eligible Tasks, authorized Project-to-Task links, Common Agents, and explicit Add and assign. | Space remains the Task and visibility owner. These links do not change Profile defaults, start an Agent, or imply new code access. |
| 3 — Multiple repositories for code work | Add canonical many-to-many Project–repository associations, an optional default code repository, and exact repository selection through the supported single-workspace execution path. | Migrate existing repository and Profile-default consumers together. A cloud association alone cannot grant local folder use. Older clients or Services reject unsupported new facts instead of selecting the first repository. |
| 4 — Shared folders and accurate Activity | Permit authorized same-owner uses of one canonical local folder across Projects with one real conflict boundary and truthful Session attribution. | Prove canonical path ownership, removal, concurrent writes, observation consent, ambiguous attribution, and mixed-version behavior before enabling shared-folder reuse. |

Until increment 4, the current exclusive local-folder rule still applies to
execution even if a repository is associated with several Projects in the
cloud. Do not show the accepted shared-folder experience as available early or
describe increment 1 as satisfying the entire Project workflow design.

The following table defines the complete first-release acceptance scope. Its
lettered areas are requirements, not an ordering constraint.

| Slice | Product result | Acceptance evidence |
| --- | --- | --- |
| A — Explicit work scope | Projects support zero or several repository associations, repositories may be shared across Projects, and Tasks may associate several Projects. Same-owner, same-Organization local folder reuse is supported with exact work attribution and one folder-conflict boundary. | A mixed-Project Space can hold both single- and cross-Project Tasks; a shared repository does not invent a unique Project; a reused folder does not permit conflicting writers through different Project labels; non-code Projects remain useful; existing Tasks stay unassociated; scope changes are authorized and revision-checked; private Tasks do not leak through a Project read projection. |
| B — Project-aware external routing | Existing Project managers configure one optional default issue destination. Supported OpenMeld Space, DM, CLI, and Routine actions resolve and report their exact destination without a Task prerequisite. Both GitHub and Linear creation results can attach exact references to eligible Tasks. | A Project configured for Linear creates an issue there about its GitHub PR without clarification; an Agent-generated GitHub tool input cannot impersonate the user's explicit override. A real explicit GitHub request works, and an exact authorized target can work without a Project. If the default changes before action acceptance, the destination is resolved again; after acceptance, retry keeps the accepted target. Cross-Project Task membership does not double-write. Genuine ambiguity asks once or blocks unattended work; unavailable access blocks without fallback. A failed Task association retries only association, not issue creation; a Linear reference never claims event monitoring. |
| C — Agent and Project workflow | Common Agents can be configured before work begins and offered in Space task-assignment choices, including explicit Add and assign. A Project may have an optional default code repository. Each code execution uses one verified repository/workspace; a Task can link several executions. | Explicit repository intent wins; absent intent uses the configured default or a sole repository, otherwise asks. An unavailable default never selects another repository. Common Agents alone changes no membership or Profile default. Add and assign discloses owner participation and reports partial outcomes. Shared-repository Sessions require actual work attribution and existing Activity consent. |

Each increment extends the existing owner contracts. Update the affected product, architecture, shared-schema, and client owners in the same change that alters their behavior. Contract-impact, mixed-version, and release validation follow `developing/engineering/development-workflow.md` and `developing/engineering/agent-native-delivery.md`; this proposal is not that certification.

The first-release user journey must work end to end: in a Space discussing
Payments and Developer Platform, select their shared SDK repository for a Task,
choose a Common Agent, explicitly add it and its owner when needed, and execute
against the verified folder. Create one issue in the selected Project's default
tracker and inspect its exact reference from the same Task. A second execution
may work on another repository under that Task. The final Task result remains
in its source Space and follows its original completion conditions.

Acceptance must also show that a repositoryless Project is usable, a Project
with no issue default can use an explicit request target, ambiguous Session
attribution does not become successful empty coverage, and a removed shared
folder association does not revoke another Project's legitimate use. These
are behavior requirements, not a per-file test quota. Source checks, deterministic
contract tests, provider receipts, and real-user UI evidence must be reported
as distinct validation layers during implementation.

## Exclusions

- No new top-level `Context` object, Project-owned Space or Task store, global Task scheduler, or alternate Agent Profile/Binding authority.
- No Project membership ACL that implicitly grants private Space, Agent conversation, local folder, repository, or App access.
- No automatic Project inferred from the most recent Space, Agent Profile default, search similarity, or an arbitrary linked issue.
- No mandatory one-Project-per-Space rule, one-Agent-per-Project rule, or new Agent Profile per Task.
- No first-release multi-repository execution workspace, automatic task splitting by repository, or historical Session fan-out from new Project associations.
- No transcript ingestion, generic project-management board, arbitrary workflow engine, automatic issue import, or unverified Linear event-follow-up promise.

## Related Owners

- [Projects](projects.md): durable Project identity, repository and local-connection rules, Default Project, and mutation authority.
- [Agent Profiles](agent-profiles.md): Agent identity, Binding, local working-folder preference, and Wake eligibility.
- [Space Collaboration](space-collaboration.md) and [Space Tasks Design](space-tasks-design.md): Space visibility, Task ownership, assignment, review, and external references.
- [Organizations and Center Agent](organizations-and-center-agent.md): tenant, App connection ownership, and provider-action attribution.
- [Agent Transport Contract](../architecture/agent-transport-contract.md): workstation admission and execution authority.
- [Web Client](../clients/web.md): canonical Projects, Space, Agent, and Task presentation.
- [Issue #1251](https://github.com/amplifthq/openmeld/issues/1251): the concrete cross-provider issue-routing failure and acceptance examples.
