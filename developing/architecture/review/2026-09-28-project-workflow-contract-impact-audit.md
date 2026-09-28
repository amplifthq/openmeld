# Project Workflow Contract Impact Audit — 2026-09-28

## Agent Context

- Purpose: Record the cross-process compatibility and rollout evidence for the implementation in Draft PR #1286.
- Read this when: Reviewing Task Project associations, Project configuration, issue routing, provider references, or deciding whether the PR can be marked ready or deployed.
- Update this when: A consumer, producer, local execution contract, provider receipt, release manifest, or acceptance result changes in this PR.
- Do not use this for: The durable product model, release authorization, or a claim that the approved first-release journey is complete.
- Source of truth: This file is the dated contract-impact audit and open-gate record; scoped owner documents own lasting behavior.

Status: IN PROGRESS — the cloud Project, Task, and issue-action slices have focused source tests. Per-execution repository selection, shared local folders, Session attribution, and real provider/user acceptance remain open. The PR is Draft and must not be deployed as the complete workflow release.

Removal condition: Remove after this candidate's full accepted behavior, rollout compatibility, and release evidence are recorded in the durable owner documents or the proposal is superseded. Git history remains the audit record.

## Changed Boundaries

| Boundary | New fact | Current owner |
| --- | --- | --- |
| Project HTTP/RPC and D1 | Additive, revision-checked issue destination, repository associations/default, and Common Agents on existing Project identity; migrations 0186 and 0187. | Core Project service and the existing Project management policy. |
| Space Task HTTP/RPC and Durable Object | Version 2 adds a Project ID set and typed Linear external issue reference; Task revisions and Space visibility remain authoritative. | Space Task writer; Core validates Project Organization scope before the mutation. |
| Provider action | New GitHub and Linear issue actions check a Core routing decision before accepting an operation. Existing operation replay keeps its accepted provider, connection, input, and idempotency key. | Remote Agent or Core Local Plugin action owner; provider integration owns the effect. |
| Web/API client | Project detail configuration, Task Project editing, Common Agent suggestions, and explicit Add and assign; updated Task callers send `taskContractVersion=2`. | Web presentation and API client transport. |
| CLI/Service | No daemon delivery payload or local Service carrier changes are in this candidate yet. The updated API client opts the future packaged CLI into Task v2. | CLI and Service owners remain unchanged pending the local execution increments. |

## Mixed-Version Matrix

| Combination | Expected behavior and gate |
| --- | --- |
| Old cloud, new Web/API client | Old Gateway ignores the additive Task query parameter and returns legacy Tasks; new schema reads missing `projectIds` as an empty set. New Project settings endpoints and issue-routing RPC are unavailable, so callers must fail visibly and must not perform a mismatched provider write. |
| New Core, old Web or published CLI | Legacy Tasks with no new facts are projected without the new field. A Task with Project scope, a Linear reference, or a Project-set detail event returns `space_task.contract_update_required` (HTTP 426), before an old strict reader can silently flatten or misparse it. Other existing Space, setup, Wake, service status, and trace paths retain their current request shapes. |
| New Core, old Remote Agent | Existing GitHub issue tools can still create an issue without the new Project routing guard. Therefore a configured Project issue default must not become user-available until the new Remote Agent action owner is deployed. This is a release-order blocker, not an acceptable mixed-version state. |
| New Core, old Local Agent CLI | `openmeld plugins call` goes through Core's Local Plugin action owner, so new issue routing is enforced there. Old Task commands use the legacy Task response/error behavior above. Independent `gh` or third-party tools remain outside OpenMeld enforcement. |
| New cloud, old local Service | Legacy working-folder and Default Project behavior remains. Additional repository associations cannot yet select a new local folder. Do not represent the cloud association as executable until the local connection and execution contract increments land. |

## Required Rollout Before Ready

1. Apply additive D1 migrations 0186 and 0187 before Core reads their columns.
2. Deploy consumers and Gateway that accept Task v2 while keeping legacy Task reads compatible.
3. Deploy the Core issue-resolution receiver, then the Remote Agent caller; only after both are healthy expose Project issue-default configuration in Web. The normal coordinated cloud order exposes Web before Remote Agent, so this PR needs a gated or staged lane before release.
4. Complete exact per-operation repository selection, same-owner shared-folder uses with a physical resource conflict boundary, and consent-aware Session attribution. A cloud repository list alone does not meet the accepted first-release scope.
5. Prove the deployed Linear create action's input/output catalog and a real creation receipt, association-only recovery, and the user-accessible Project/Task workflow. Source tests are not provider or production evidence.
6. Run the local-component release-ready and contract-impact gates after any CLI/Service consumer or payload change. No contract constant or release manifest has been intentionally changed in this Draft slice; reevaluate before local execution is added or the PR is marked ready.

## Current Evidence

- `origin/main` was fetched and the design branch rebased on it before implementation.
- `pnpm run verify:pr -- --feedback` passed on the uncommitted Draft candidate. Its selected Web (18), API client (63), schema (7), Core Node boundary (5), and Core Worker (42) tests passed, along with the selected dependency builds and Biome check.
- Focused Remote Agent GitHub/Linear action tests passed separately (120 tests), as did package type checks for Core, Gateway, API client, Remote Agent, and Web and the strict docs lifecycle check.
- `pnpm run verify:release-ready -- --defer-release --base a49be4ca21f904f0f409a1da9691a27b5de3d5b8` passed without changing the local-component release manifest. These local results do not prove installed CLI, live Service, provider, or deployment behavior.

## Open Acceptance Gaps

- One execution still resolves the Agent Profile's existing Default Project/local folder. The new optional code-repository default and a cross-repository Task do not yet select exact workspaces.
- The v3 local Project binding store still grants one canonical folder to one Project; duplicate folder association, physical conflict serialization across Project labels, and ambiguous Session attribution are not implemented.
- Linear receipt parsing is conservative and needs the deployed action catalog or captured provider result. If identifier and URL are absent, the action reports the confirmed issue and a failed Task association without making another issue.
- Project routing rechecks the current default before a new action claim, but the Project revision is not yet fenced atomically with the connector-operation insert. A concurrent default change across that boundary needs a claim-time revision guard before this can be called complete.
- Free-text destination intent uses conservative request-side parsing and targeted clarification. An explicit structured requester selection and adversarial quoted-context acceptance evidence are still needed before claiming every natural-language override is reliable.
- Task-to-Project aggregate views and first-run Project selection during work creation remain narrower than the approved full journey.
- Issue #1251 is related but not closed by this Draft until the full supported routing and provider acceptance evidence is complete.
