# Center Agent GitHub release dispatch plan

## Agent Context

- Purpose: Define the implementation task for starting and tracking GitHub releases from the Center Agent.
- Read this when: Implementing or reviewing the native GitHub workflow dispatch capability.
- Update this when: The proposed scope, provider contract, or acceptance evidence changes.
- Do not use this for: Current production release authority, deployment approval, or a replacement release scheduler.
- Source of truth: This draft owns the proposed work only; the linked product and release owners govern current behavior.

Status: DRAFT — requirements and proposed implementation only.
Remove when the feature ships and the settled behavior is recorded in the owner documents; delete this plan in the completing PR.

## Problem and intended outcome

An authorized member should be able to ask the Center Agent to release an
identified repository change, then receive the exact GitHub run, its progress,
and an evidence-based result. A local Agent or human should not be necessary
solely to press Run workflow.

At main `239c88963a5f5ea6d6bc6c37c231a80e4e9eaf47`, the native GitHub
catalog can list workflows and runs and rerun an existing run, but cannot
dispatch a new one. The repository already has guarded release workflows.
Reusing an old run retains its original inputs and does not release a new SHA.

This draft adds a plan only. It does not implement the capability, enable
deployment access, dispatch a workflow, or claim release readiness.

## Product behavior

1. Resolve the repository and explicitly selected GitHub execution identity
   through the existing connected-account contract. Read the relevant release
   instructions, per-component deployment evidence, pending diff, and candidate
   validation evidence. An overall failed fleet run can still contain successful
   component jobs.
2. Establish a concrete release intent: repository, reviewed workflow, selected
   components, immutable source SHA, and the existing authority for this action.
   Show these facts in the conversation. Reuse a user's already sufficient
   authorization; do not add a second approval system or require repeated
   confirmation for the same authorized action.
3. Dispatch through the provider using the repository's trusted workflow ref.
   For OpenMeld, use `ref=main` and the full 40-character first-parent main
   `release_sha`. Do not silently expand the release when main advances.
4. Return the exact GitHub run link and track its run and component results.
   Report waiting for a GitHub Environment decision, permission failure,
   cancellation, and deployment failure accurately.
5. Start a dependent stage only after the preceding stage meets the repository's
   existing release conditions. Stop the remaining plan after a relevant failure.
6. Report dispatch acceptance, workflow completion, component deployment and
   health, and product smoke as separate facts. Delegate browser or Mac smoke
   through existing Agent Task Coordination when needed and authorized. Until
   that evidence exists, say smoke is pending.

Independent initiation does not imply unrestricted deployment authority, an
automatic merge, an automatic rollback, or that the hosted Agent has a real
Mac. GitHub Environment protection continues to apply.

## Proposed implementation

### Extend the existing GitHub action path

Add a native `github_dispatch_workflow` write tool alongside the current
workflow diagnosis and rerun tools. Route it through the existing GitHub tool
wrapper, Core App action authorization, and OpenConnector provider adapter.
Update all required operation registration, discovery, input validation,
provider action policy, and execution layers together. Adding only a
model-visible tool is insufficient.

Reuse the existing `githubActor`, `operationId`, write disclosure,
canonical request signature, Core operation claim, action finalization, and
audit result. Do not create a separate release authorization or retry ledger.

Preserve explicit `organization` versus `requester` selection. Organization
access uses the verified installation and OpenMeld bot identity. Unattended
actions require the existing Organization/delegated-member authority; never
fall back to a personal credential. The model cannot assert an Organization,
role, installation, token, or authorization grant.

Cross-service action payloads belong in `packages/schemas` under the existing
contract; expose them through the native tool's authoritative input-schema
adapter rather than a separately maintained Code Mode schema.

### Dispatch contract and reviewed workflow surface

The provider call is
`POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`.
Suggested inputs are repository, workflow identifier, workflow ref, validated
workflow inputs, GitHub actor, and operation ID.

Keep the provider adapter reusable for connected repositories, while the
release action admits only explicitly configured repositories and reviewed
release workflows/inputs. Discover workflows from the selected repository and
validate against trusted policy; a model-provided filename or arbitrary input
map is not an allowlist. Do not hardcode every Organization to OpenMeld's
repository or embed OpenMeld's deployment order in the generic GitHub adapter.

Initial OpenMeld release configurations:

- `release-on-main.yml`: existing enum `scope`, trusted `ref=main`, exact
  `release_sha`. Follow the existing component planner. A Web/Core release is
  two sequential dispatches because this workflow does not accept a comma list.
- `cli-release.yml`: normal release path only, after the existing version
  preparation, channel checks, and release evidence are satisfied. Cloud
  deployment does not implicitly publish CLI.

Keep recovery-only workflows and arbitrary GitHub Release creation outside
this initial action surface. Preserve the current restriction on
`github.create_release` and raw provider proxies. API tokens and deployment
secrets remain in their current server/provider/GitHub owners.

Verify installation Actions write permission and repository selection. Return
a precise actionable error if access is absent; do not request broader
credentials or bypass GitHub protections.

### Exact run correlation and uncertain outcomes

Verify the API version used by the actual provider adapter against current
GitHub documentation and a captured response. Current GitHub documentation
for API version 2026-03-10 describes a 200 response containing
`workflow_run_id`, `run_url`, and `html_url`. Use the returned run identity
when supported; do not assume that every dispatch returns a legacy empty 204.

If the existing adapter still uses a response without run identity, establish
an exact correlation contract before claiming reliable tracking. Do not select
the latest run or match solely on workflow, time, or source SHA when concurrent
identical requests are possible. Upgrade the narrow adapter contract or add a
reviewed correlation input if required, with compatibility evidence.

Return operation identity, exact run identity/URL when known, immutable
release source, workflow control ref, and the dispatch result. Distinguish
workflow `head_sha` from an explicit product `release_sha`.

A stable operation ID protects retries of one intent; it must not permanently
forbid an intentionally requested later redeployment of the same source.
After a timeout or disconnect, reconcile the existing operation/provider
execution before another POST. If acceptance cannot be determined, preserve
an explicit unknown result and an actionable diagnostic path. Do not promise
exactly-once delivery across an external side effect without evidence, and do
not silently retry an ambiguous dispatch.

### Tracking and release ownership

Reuse the existing run/job reads and durable continuation mechanisms. GitHub
owns execution status; OpenMeld stores references and action evidence, not a
second deployment state machine. Recover the operation/run after conversation
compaction or restart without redispatching it. Keep polling bounded by normal
provider limits and report provider errors without erasing the run link.

The existing release workflows continue to own source validation, deployment
preflight, shared component leases, ordering admission, credentials, and
health checks. The Agent uses repository-owned release rules and evidence;
it does not replace them with a generic fixed order or infer that a merge
automatically authorizes a deployment.

## Acceptance conditions

- [ ] A connected, authorized Center Agent can start a new permitted workflow
  and return the exact run URL without a local shell or manual Run workflow step.
- [ ] A captured provider response proves permission, API version, request input,
  and run-correlation behavior; contract tests use that actual response shape.
- [ ] Native discovery and Code Mode expose the same validated inputs and write
  semantics, including actor and operation ID.
- [ ] Wrong repository/installation, unauthorized actor, unreviewed workflow,
  invalid inputs, and invalid OpenMeld release SHA are rejected before release
  mutation. GitHub Environment protection remains effective.
- [ ] Retrying the same operation does not dispatch twice; an accepted-but-lost
  response remains reconcilable or explicitly unknown. An intentional new
  redeployment has a distinct operation identity.
- [ ] Concurrent identical workflow/source requests cannot be misattributed by
  latest-run guessing; workflow control SHA and product release SHA remain distinct.
- [ ] A Web-then-Core scenario observes the first run's required success before
  starting the second; a failure or cancellation prevents automatic continuation.
- [ ] Existing rerun behavior, personal/Organization identity selection, and
  unrelated GitHub tools remain compatible.
- [ ] A real Center Agent conversation starts a harmless dedicated test workflow
  or an authorized staging release and reports its exact outcome after a resumed
  turn. Production smoke is performed only for an explicitly authorized release.
- [ ] Product smoke is reported separately from Actions health; missing browser
  or native-Mac evidence is not marked complete.
- [ ] Update the owning runtime/GitHub, shared-action, and release documentation,
  add a draft Changelog entry if required, and remove this plan when shipped.

## Implementation handoff

Start with a focused vertical slice: provider dispatch contract and captured
response, existing App action boundary, native tool registration, exact run
tracking, and the harmless/staging end-to-end acceptance. Expand to normal CLI
release only with its existing release prerequisites demonstrated.

Tests should target consequential boundaries: authority, immutable inputs,
duplicate/ambiguous submission, concurrent run identity, and ordered failure
handling. Broad UI changes, a release dashboard, a new scheduler, and a new
approval mechanism are not needed for this task.

This plan proposes no change to Wake execution, RuntimeCoordinator, Service
lifecycle, Space authority, or current release ownership. If implementation
requires changing an owning contract, document and review that change in the
same PR before treating the feature as complete.

## Source pointers

- [GitHub tools](../../services/remote-agent/agent-core/github-tools.ts)
- [Organization and Center Agent authority](../product/organizations-and-center-agent.md)
- [Remote Agent runtime and App boundaries](../product/remote-agent-runtime.md)
- [Shared contracts](../architecture/shared-contracts.md)
- [Production release](production-release.md)
- [Agent-native delivery](agent-native-delivery.md)
- [Scoped release workflow](../../.github/workflows/release-on-main.yml)
- [CLI release workflow](../../.github/workflows/cli-release.yml)
- [Official GitHub dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
