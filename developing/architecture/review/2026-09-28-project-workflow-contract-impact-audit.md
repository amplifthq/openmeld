# Project Workflow Contract Impact Audit — 2026-09-28

## Agent Context

- Purpose: Record the cross-process compatibility and rollout evidence for the implementation in Draft PR #1286.
- Read this when: Reviewing Task Project associations, Project configuration, issue routing, provider references, or deciding whether the PR can be marked ready or deployed.
- Update this when: A consumer, producer, local execution contract, provider receipt, release manifest, or acceptance result changes in this PR.
- Do not use this for: The durable product model, release authorization, or a claim that the approved first-release journey is complete.
- Source of truth: This file is the dated contract-impact audit and open-gate record; scoped owner documents own lasting behavior.

Status: IN PROGRESS — cloud Project, Task, issue routing, bounded Project Task reads, Web and CLI per-Context repository selection, same-owner shared-folder use, and partial Session attribution have focused source tests. Installed Service, deployed provider, mixed-version rollout, and complete user-journey acceptance remain open. The PR is Draft and must not be deployed as the complete workflow release.

Removal condition: Remove after this candidate's full accepted behavior, rollout compatibility, and release evidence are recorded in the durable owner documents or the proposal is superseded. Git history remains the audit record.

## Changed Boundaries

| Boundary | New fact | Current owner |
| --- | --- | --- |
| Project HTTP/RPC and D1 | Additive, revision-checked issue destination, repository associations/default, and Common Agents on existing Project identity; migrations 0186 and 0187. | Core Project service and the existing Project management policy. |
| Space Task HTTP/RPC and Durable Object | Version 2 adds a Project ID set and typed Linear external issue reference; Task revisions and Space visibility remain authoritative. | Space Task writer; Core validates Project Organization scope before the mutation. |
| Project Task read projection | Migration 0189 adds revision-fenced, key-only D1 Task/Project links. The Space Task transaction enqueues projection through its recoverable outbox. Project reads recheck current Space access and Task association before returning bounded summaries. | Space Task remains the only Task writer; Core projection is candidate lookup only. |
| Provider action and operation receipt | New GitHub and Linear issue actions check a Core routing decision before accepting an operation. Completed Linear issue creation stores an exact minimal receipt on the Core connector operation and returns it for a separate Task association without another provider create; migration 0188 adds its nullable column. | Remote Agent or Core Local Plugin action owner; Core owns the operation receipt; provider integration owns the effect. |
| Web/API client | Project detail configuration, Task Project editing, Common Agent suggestions, and explicit Add and assign; updated Task callers send `taskContractVersion=2`. | Web presentation and API client transport. |
| CLI/Service and local Project store | Execution Context v1 adds optional frozen `projectWork`; Codex and Claude advertise capability v4. The Service verifies an owner-local Project/repository connection after current-route checks. Local binding store v4 admits explicitly confirmed same-owner, same-Organization folder uses; Session Inventory can publish exact rows with incomplete coverage. CLI bind can select a configured repository and confirm sharing. | RuntimeCoordinator owns acceptance; Service owns local folder and slot truth; Project connection store owns local uses; Core owns Session Inventory projection. |

## Mixed-Version Matrix

| Combination | Expected behavior and gate |
| --- | --- |
| Old cloud, new Web/API client | Old Gateway ignores the additive Task query parameter and returns legacy Tasks; new schema reads missing `projectIds` as an empty set. New Project settings endpoints and issue-routing RPC are unavailable, so callers must fail visibly and must not perform a mismatched provider write. |
| New Core, old Web or published CLI | Legacy Tasks with no new facts are projected without the new field. A Task with Project scope, a Linear reference, or a Project-set detail event returns `space_task.contract_update_required` (HTTP 426), before an old strict reader can silently flatten or misparse it. Other existing Space, setup, Wake, service status, and trace paths retain their current request shapes. |
| New Core, old Remote Agent | Existing GitHub issue tools can still create an issue without the new Project routing guard. An old Remote Agent also omits the Linear receipt. Therefore a configured Project issue default and Linear issue creation must not become user-available until the new Remote Agent action owner is deployed. This is a release-order blocker, not an acceptable mixed-version state. |
| New Core, old Local Agent CLI | `openmeld plugins call` goes through Core's Local Plugin action owner, so new issue routing is enforced there. Old Task commands use the legacy Task response/error behavior above. Independent `gh` or third-party tools remain outside OpenMeld enforcement. |
| New cloud, old local Service | Legacy working-folder and Default Project behavior remains. A selected `projectWork` requires adapter capability v4 and receives `service.update_required` before execution on an older Service. Shared-folder controls remain unavailable until the new Service is installed. |
| Old cloud, new CLI/Service | The new Service advertises Execution Context capability v4 and can send `partial` Session reconciliation; an older strict Core may reject those new shapes. Publish and verify Core before the new local component, and do not roll Core back while v4 Services or shared-folder stores are active. |
| Old CLI/Service, local binding store v4 | An older local component returns `project_bindings.update_required` on the new store; it must not reinterpret a shared path as one Project. Update the local component before enabling sharing; preserve the store on rollback. |

## Required Rollout Before Ready

1. Apply additive D1 migrations 0186 through 0189 before Core reads their columns.
2. Deploy consumers and Gateway that accept Task v2 while keeping legacy Task reads compatible.
3. Deploy the Core issue-resolution receiver, then the Remote Agent caller; only after both are healthy expose Project issue-default configuration in Web. The normal coordinated cloud order exposes Web before Remote Agent, so this PR needs a gated or staged lane before release.
4. Ship and verify the new local component only after Core understands capability v4 and `partial` Session reconciliation. Confirm current-folder writers serialize across Project labels; selected repository work must fail without an owner-matching local connection. Do not enable shared-folder UI before this local version is available.
5. Prove the deployed Linear create action's input/output catalog and a real creation receipt, association-only recovery, and the user-accessible Project/Task workflow. Source tests are not provider or production evidence.
6. Keep the bumped CLI/Service contract constants with this feature. On the Draft branch, run the local-component gate with `--defer-release`; the clean lane that actually publishes the feature must bump its package version, stamp the rebuilt manifest, and run strict release-ready. Validate old/new setup, Wake, Space actions, status, trace, and rollback behavior before Ready or release as applicable.

## Current Evidence

- `origin/main` was fetched and the design branch rebased on it before implementation.
- `pnpm run verify:pr -- --feedback` passed on the uncommitted Draft candidate. Its selected Web (18), API client (63), schema (7), Core Node boundary (5), and Core Worker (42) tests passed, along with the selected dependency builds and Biome check.
- Focused Remote Agent GitHub/Linear action tests passed separately (120 tests), as did package type checks for Core, Gateway, API client, Remote Agent, and Web and the strict docs lifecycle check.
- A later focused Core connector-operation run (39 tests) verified that a changed Project default rejects a new issue operation atomically without creating an operation or attempted audit row, while an accepted exact replay still succeeds. Remote Agent GitHub batch and App action regressions passed after the same change.
- Core issue routing now distinguishes verified requester/Routine sources from Agent-authored text and excludes negated, quoted, and code-formatted instructions from an inferred override. The focused routing test and Core type check passed locally.
- The public OpenConnector fork at commit `83a5dbcaa320b5fc98ccb8c5846fc9589c58443f` declares `linear.create_linear_issue` with `team_id`/`project_id` input and flat `id`/`identifier`/`ticket_url` output. OpenMeld's action recognition and Task-reference parser now match that source contract; focused Remote Agent tests passed. This is source evidence, not a deployed-catalog or real-creation receipt.
- Migration 0188 adds a nullable, bounded Linear issue receipt to the existing connector operation. Focused Core persistence and Remote Agent replay tests show that a completed operation returns its saved reference without invoking the provider again. The public OpenConnector source retains idempotency responses for 24 hours; old uncertain operations now stop before that window expires instead of risking a second issue.
- Focused RuntimeCoordinator tests show selected Project/repository identity is frozen and an older Service is rejected before work starts. CLI tests show the Service selects a matching owner-local folder instead of the Profile default and rejects a different owner's folder. Web composer and Project computer tests cover explicit repository selection and same-Organization share confirmation.
- Local store, control-handler, hook, provider inventory, and Core inventory tests show v4 shared-folder use, lane routing, exact OpenMeld Session attribution, ambiguous native coverage, and preservation of another Project's connection on removal. The current-folder scheduler's exclusive slot remains a conservative conflict boundary across Profile labels.
- `pnpm run verify:pr -- --feedback` passed after the Project Task read and CLI selection changes, including the Worker-safe Zod guard, strict docs lifecycle, changed-file Biome check, dependency builds, and selected CLI, Web, API client, DB, schema, Core Node, and Core Worker tests. Focused Remote Agent action tests passed separately (30 tests). This is local source evidence.
- Focused Core Project tests cover an inaccessible password-protected Space, a stale Task association, and a late older D1 projection replay. Space Task outbox tests cover Project association creation and removal. Focused CLI tests cover repository default, explicit URL selection, and ambiguous local clones; the Project page test checks the owning-Space link.
- `pnpm run verify:release-ready -- --defer-release --base a49be4ca21f904f0f409a1da9691a27b5de3d5b8` passed after rebuilding the packaged CLI and Service facts. The release manifest remains at the base; pending publishing-lane impacts are the CLI command contract, Service bundle hash, runtime contract epoch, and Service contract version. No installed runtime or production release is implied.

## Open Acceptance Gaps

- Web and CLI sends can select one Project/repository for a new Context. Legacy work without that selection still follows Profile Default Project. Multiple local clones use the configured Default Local Project Connection when it matches the selected repository; otherwise the Service blocks and asks for a default choice. Retained-context user acceptance still needs real product validation.
- Local binding store v4 and conservative current-folder serialization support confirmed same-owner sharing. An exact OpenMeld Session can be attributed; ambiguous native Sessions remain unassigned with error coverage, and the UI requests explicit Project selection for new work. Historical Activity is not relabeled. Installed-device acceptance remains open.
- Linear receipt parsing now matches the public OpenConnector action contract. The deployed action catalog and a real provider result remain unverified. If identifier and URL are absent, the action reports the confirmed issue and a failed Task association without making another issue.
- Default-based GitHub, Linear, and Local Plugin operation claims now fence the Project revision and exact destination in the connector-operation insert; stale claims write no operation or audit row. GitHub batches claim a frozen operation before creating their manifest. The deployed path still needs provider and user acceptance evidence.
- Free-text destination intent excludes quoted and negated forms, and Agent-authored text cannot override a Project default. A clear requester instruction to create in the cited GitHub repository has a focused regression test. Ambiguous wording still asks for a destination; end-to-end user acceptance is needed rather than a claim that all natural language can be classified mechanically.
- The Web composer now selects one Project and repository for a new isolated task. Project detail has a bounded authorized recent Task view; a complete mixed-Project user journey remains open.
- Issue #1251 is related but not closed by this Draft until the full supported routing and provider acceptance evidence is complete.
