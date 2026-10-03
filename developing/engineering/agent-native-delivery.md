# Agent-Native Delivery

## Agent Context

- Purpose: Define the single delivery contract from development through exact
  validation, merge, release, health, smoke, evidence, and recovery.
- Read this when: You are preparing, validating, merging, or releasing a pull
  request.
- Update this when: Candidate identity, validation policy, merge protection,
  release serialization, evidence, or recovery behavior changes.
- Do not use this for: Product behavior, component deployment commands, raw CI
  implementation details, or rules about who must review a change.
- Source of truth: This file owns the end-to-end agent-native delivery contract
  for this repository.

## Merge and Release Task

Use this path for one PR or a compatible batch. If already merged, recover the
pre-merge `main` commit and final product SHA, then start at step 3. Keep one
compact record of what remains; follow the linked sections only for the
branches used.

1. Identify the requested PRs, their dependency order, and the `main` commit
   before the first merge. For compatible ready changes, use [one integrated
   Final Candidate](#final-candidate) instead of repeating the same broad checks
   on each leaf. For a batch crossing release scopes, run
   `pnpm run release:plan -- --base <pre-merge-sha>` on the integrated candidate
   to inspect the changed paths and deployment order without scanning hosted
   history. Decide intended versions for artifacts in scope. Stable local-component
   source, its compatibility floor, and its stamp may share one PR and one Final
   Candidate. A separate release PR is useful when the product change already
   merged. Restamp after any later source change.
   Resolve Core/Service version-floor changes and the
   [Windows helper source](production-release.md#cli-release) before paying for
   the final candidate or stamping a release manifest.
   Branch names do not grant release permission; the actual
   manifest diff selects strict artifact verification.
2. [Merge](#merge) against current `main`. If a merge command fails or returns
   an uncertain result, read the remote PR's `state` and `mergeCommit` before
   retrying. Pin the integrated product SHA; a later release-only version
   commit has its own publication SHA. Keep unrelated newer commits outside
   this release.
3. For a multi-scope batch or an unknown deployment backlog, run
   `pnpm run release:status -- --ref <product-sha> --change-base <pre-merge-sha>`
   once for the initial plan. When the next release scope is already known, go
   straight to its guarded preflight: it reads the same deployment history and
   checks that scope's prerequisites. Do not run a separate global status scan
   before it. Guarded release commands recheck before publication.
   Do not repeat the full history scan after each stage; use that stage's
   workflow result, release receipt, and health evidence to track completion.
   When every planned stage has those receipts, do not rescan solely to close
   the task; rescan for missing, changed, or conflicting evidence.
   If unrelated commits landed between separate merges, plan those ranges
   separately instead of attributing them to this batch.
   It covers Database, cloud, and CLI; read current-change scopes separately
   from historical backlog. [Assess Desktop](production-release.md#desktop-release-coverage)
   for the same range, and [assess OpenConnector](production-release.md#openconnector-release)
   when that external source or its production configuration is in the batch.
   A zero pending-scope result does not close these separate rows. Resolve the
   Desktop platforms, signed release versus internal preview, and available
   native build environment before starting those builds, using the Desktop
   owner rules. This is lane selection, not an extra approval. Once the
   exact source is pinned, start independent native artifact builds while cloud
   stages run; promotion still waits for its own provenance and dependencies.
4. [Release](#release) each affected component through its owner workflow,
   respecting the planner's dependency order. If Core is selected and shared
   schema or Service inputs changed, run the read-only
   `pnpm release:local-components plan --next` before launching a multi-scope
   workflow that includes Core. Choose the supported Core/CLI path from that
   result, including receiver-first deployment with the current CLI projection
   when needed. This avoids discovering an unstamped Service only after earlier
   cloud stages have completed. Independent builds and deploys can still run
   alongside release preparation once their source and lane are known.
   Use one low-frequency workflow wait; read logs when
   state changes or fails instead of polling unchanged output. Record each
   component and supported Desktop platform as
   released, pending, excluded with a concrete
   reason, or unknown when evidence cannot be read. Promotion and [installed
   A-to-B acceptance](../clients/desktop.md#installed-a-to-b-release-acceptance)
   are separate Desktop states.
5. Finish with [health and the smallest real-user smoke](#health-and-real-user-smoke)
   for changed paths. Report the product and any release-only source SHA,
   component evidence, pending acceptance, and unknowns. A published component
   does not complete the batch while another affected row is unresolved.

## Daily Workflow

The same workflow applies to engineers, Codex, Claude Code, and other coding
agents. Run `pnpm install --frozen-lockfile` in each checkout to install dependencies
and Husky hooks. Keep `origin/main` available with `git fetch origin main`.

Reserve `codex/release-*` branches for artifact release preparation: their pushes
run strict release verification. Use an ordinary `codex/*` name for CI or release
workflow improvements; those changes do not themselves publish artifacts.

| Stage | Required work | Why |
| --- | --- | --- |
| Commit | The hook checks staged files with `lint-staged`. | Catch cheap errors while the change is small. |
| Push a development branch | The hook checks protected release refs; ordinary pushes stay fast. | Avoid repeating development tests on every push. |
| Develop and review | Validate the behavior and affected consumers; add type, build, database, or integration checks where the changed boundary requires them. Trigger native Windows acceptance only when the change affects Windows behavior. | A file selector cannot decide product risk. |
| Mark the PR ready | Sync current `main`, resolve conflicts, and validate the affected interactions. Standard FC starts automatically. | Certify the actual next merge. |
| Merge | Require current-base `OpenMeld Final Candidate` success for the unchanged candidate. | Prevent stale or mismatched green results. |
| Release | Follow [Production Release](production-release.md), then health and real-user smoke. | Merge success is not deployment or product success. |

For a macOS Desktop production release, the release owner runs the thin native
A-to-B smoke from [Desktop](../clients/desktop.md#installed-a-to-b-release-acceptance)
on the local release Mac. GitHub Actions is not a substitute for the installed
A, Launch Services, Squirrel/MacUpdater, and automatic relaunch boundary. Use the
expanded Desktop acceptance only when that release changes a high-risk updater,
packaging/signing, identity, or restart lifecycle boundary.

The native Windows compatibility and internal preview workflows are explicit
diagnostics, not required PR checks. Ordinary Web or shared-schema PRs do not
wait for them. Dispatch the relevant workflow only when the change affects
Windows behavior or when preparing a Windows release, and verify the run's SHA.

Do not bypass hooks to ship a failed check. Diagnose with the smallest failing
command, fix the cause, and push again. Hooks are local feedback, not remotely
attested evidence; FC does not claim they ran or that every business test passed.

## Link Completed Fixes To Their Issues

Before handing off a PR, agents should explicitly map each fully resolved issue
to the implemented behavior and its validation. Put one `Fixes #123` or
`Closes #123` line per resolved issue in the **PR description**, and verify that
GitHub lists those issues as linked for automatic closure. GitHub processes
these closing keywords when the PR merges into the repository's default branch;
a PR comment alone does not establish automatic closure. Comments may explain
the issue-to-fix mapping, but must not replace the description's closing links.

Only use closing keywords when the PR covers the issue's complete acceptance
scope. For partial fixes, deferred work, or related issues, use a plain reference
such as `Related to #123` and state what remains. Recheck this mapping whenever
the PR scope changes so implemented fixes do not leave forgotten open issues,
and unrelated or unfinished work is not closed accidentally. Keep merge-based
closure separate from any claim that the change has reached production.

See [GitHub's issue-linking contract](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

## Focused Checks Before Push

Inspect the local feedback plan, then run it when its selected checks match the risk:

```sh
pnpm run verify:pr -- --feedback --plan
```

It selects changed-file Biome checks, relevant docs/Changelog contracts,
adjacent Node tests, and changed or adjacent Vitest tests in directly changed
workspaces. Run `pnpm run verify:pr -- --feedback` for that plan, or run just the
relevant owner commands when the change needs a different boundary. It no longer
turns one shared component into a whole Web test sweep. The Agent still checks
affected consumers when the adjacent tests do not cover them.
Worker TypeScript changes also run the existing Worker-safe Zod import guard
before package checks; its owner defines the runtime roots for both lanes.
Plain package runners are left to the Agent's risk-based choice; the feedback
helper does not turn one changed file into a whole package test suite. Vitest
source tests build dependencies only. Dependency builds use Turbo's cache. Test
commands run sequentially, Node test files run serially,
and selected Vitest tests use at most two workers without file parallelism.
Every run uses a disposable `OPENMELD_HOME`.

Focused Vitest execution discovers the selected files through the changed
workspace's existing `vitest*.config` contracts, including unit and integration
configs. It preserves the unit script's CLI environment override and runs only
the selected specifications. A selected file excluded by every config, or
missing from the completed results, fails feedback even when a config allows
no tests. Explicit test/platform skips and intentional multi-project ownership
retain their package-defined meaning; they are not omitted-file failures.

Workers pools need their own runtime limits. Gateway tests share one runtime
and module cache, clear global/environment stubs, and retain per-test storage
isolation; Vitest's worker count alone does not bound that pool.
The package test command runs four sequential shards to release cached modules
between groups. A failed shard stops the command.

The push hook requires the checked-out, clean tree to match every pushed commit.
An ordinary follow-up push checks the diff from the remote branch's previous
commit; a first push or rewritten/unavailable history checks the branch against
locally fetched `origin/main`. Missing base history is an error: fetch it.
Recheck identity and cleanliness after success. Deletions need no tests;
protected release pushes retain strict release verification.

Run the planned feedback command against `origin/main` when its selection fits
the complete PR diff before Ready. This is a local, owner-selected check, not
an automatic push hook or hosted job on every Draft push. Keep leaf PRs in draft
during development and batch preparation. Mark ready only after validating
affected behavior and when a green FC would make merge the next action. New
commits cancel superseded FC runs for that PR.

Focused selection is deliberately incomplete: a deleted import, a shared
contract, a dependency change, or platform-specific behavior may need additional
validation. The owner must cover affected consumers before marking ready; use
`verify:pr` for affected type/code checks and unit tests, and
`test:integration:affected` for changed cross-service, persistence, or runtime
boundaries. These are risk-selected work, not mandatory whole-repository reruns
on every push. Never turn an empty related-test selection into a claim of full
coverage. Do not start several broad runs on the same workstation at once.

## Final Candidate

FC certifies one exact `head SHA + base SHA + tree SHA`. Standard FC retains:

- current-main ancestry and live PR identity;
- trusted control entrypoints and complete, matching results;
- static contracts for changed owners and control-code quality when control changes;
- database checks when database owner paths change; and
- deferred or strict local-component release readiness, selected by the manifest diff.

Standard FC does not repeat broad workspace unit or integration tests. This
keeps final merge latency separate from development feedback. Full confidence
is explicit when remaining risk justifies a whole-repository rerun. The printed
plan is the authority for selected/skipped commands, reasons, and durations:

Release and CI script changes use focused owner tests before Ready; standard FC
checks their exact diff and control identity without rerunning every repository
workflow test. Dependency and task-graph controls still select the wider static
repository contracts.

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan
```

When local resource admission cannot safely start a production client build,
the existing manual Deep Confidence workflow can run only the required client
artifacts on an isolated hosted runner:

```sh
gh workflow run deep-confidence.yml --ref <candidate-branch> \
  -f scope=release-artifacts -f artifact_scopes=web,desktop
```

Choose `web` or `desktop` when only that artifact is needed. This mode skips
the broad diagnostic jobs, runs the same exact-source renderer/prerender and
Workerd SSR entrypoints, and retains their source/input/output receipts. It
uses read-only repository access and no production credentials. Match the run's
head SHA to the candidate; these checks do not replace FC or deployed smoke.

For same-run Web artifact handoff acceptance, use the read-only two-job mode:

```sh
gh workflow run deep-confidence.yml --ref <candidate-branch> -f scope=artifact-handoff
```

The parent builds and checks a real Web artifact with Workerd SSR. A separate
runner downloads the immutable snapshot, verifies/restores it, and repeats the
artifact preflight with `reused: true` and an unchanged output hash. It also
requires rejection of a wrong-source receipt, corrupted receipt/snapshot, and
diagnostic evidence presented to the Production verifier. The harness binds
its actual Deep Confidence identity through the admission test adapter; it
does not impersonate or widen Production's main-only workflow identity.
Both jobs retain JSON evidence and use read-only repository access, disposable
OpenMeld state, and no Production environment, credentials, deploy or publisher.
This proves that transport and reuse path, not production rollout duration,
component deployment, CLI/Desktop publication, or Product Smoke.

Trusted control installs only the shared evidence parser's production
dependencies. The result publisher does not restore the full development store;
restoring that cache costs more than installing its small runtime. Candidate
dependencies stay isolated and complete for the selected checks. Hosted
documentation-only plans install root tooling without native rebuilds; signed
CLI Skills, release readiness, and executable changes keep the workspace install.
The trusted plan makes this decision for both PRs and merge groups. This changes
neither validation coverage nor candidate credential isolation.

Hosted `trusted-control-entrypoints` compares the current-main control
projection, not every workspace or lockfile byte. The isolated installer
consumes the candidate lockfile with `--frozen-lockfile --ignore-scripts` and
rebuilds only native dependencies from the trusted `pnpm-workspace.yaml`
allowlist. A catalog or override that only changes resolved JavaScript packages
is not control drift. Changes to Final Candidate workflows, trusted
entrypoints, install wrappers, project `.npmrc`, `package.json`
`packageManager` or scripts, the Turbo task graph, or workspace fields that
change what native code may run (`allowBuilds`, `onlyBuiltDependencies`,
`patchedDependencies`, and equivalents, including the referenced patch files)
still refuse hosted certification. Native-build and patch settings are parsed
fail-closed, including valid flow-style and complex-key YAML. The isolated
command wrapper also forces a trusted `script-shell` so a candidate `.npmrc`
cannot rewrite how later `pnpm run` checks execute. Those pull requests use
the documented local explicit bootstrap. When that refuse happens, the
required `OpenMeld Final Candidate` status names the control refuse and the
bootstrap path. Trusted current-main control classifies that case before
candidate dependencies or validation run, so the `Final Candidate Runner`
check is skipped instead of showing a product-test failure. Its check output
explains that protected local validation is required and links back to this
fallback. [GitHub treats a skipped check as non-blocking](https://docs.github.com/en/pull-requests/reference/status-checks),
so the Runner is not the merge authority: the repository ruleset requires only the separate
`OpenMeld Final Candidate` commit status, which remains failed until the exact
candidate passes the protected local bootstrap. Any ordinary test, build,
runner, classifier, or publisher failure remains a failure and cannot publish
green. This changes the presentation of an expected trust refusal without
creating a second delivery process or weakening the merge gate.

A non-draft PR targeting `main` starts standard FC on opening, new commits,
reopening, or marking ready; no label is needed. To retry after diagnosing a
failure, or explicitly request full confidence:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- request --pr <number>
# Add --full only when the remaining risk warrants it.
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- status --pr <number>
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- wait --pr <number>
```

Use `wait` for the pending Final Candidate instead of repeatedly polling
`gh pr checks` for the same unchanged run.

Use the current-main entrypoint, never candidate-owned package scripts.
GitHub Actions is the normal compute lane; the guarded local lane below is for
Actions outages or explicit control bootstrap. A failed check, missing evidence,
identity mismatch, or publication failure cannot become green. Local focused
checks cannot substitute for the required FC status.

For a batch, integrate compatible ready leaf changes, sync `main` once, validate
the combined interactions, and run one FC on the batch PR. Do not pay for leaf
FCs that will immediately become stale. Preserve directional release order: for
example, new Space-invitation Core/Auth receivers must precede the new CLI.
If `main` advances, old evidence remains valid only for its original base;
merge queue must validate the new group, or strict up-to-date protection requires
syncing and validating the new candidate. Do not freeze unrelated work.

## Evidence And Ownership

The trusted current-main controller runs candidate code without write credentials
and publishes schema-validated evidence: identities, selected/skipped checks,
commands, results, durations, execution mode, and bounded failure details.
Full command logs remain in the evidence artifact. The schema owner is
`packages/schemas/src/schemas/ci/final-candidate.ts`.

Existing trusted task-input reuse remains available to specialized affected
plans; standard FC no longer selects those broad tasks. Full confidence executes
its full gate. Database/release readiness and deployment/health/smoke results are
never reused. The same-run Production train artifact handoff in
[Production Release](production-release.md) verifies parent admission evidence
and, for Web, the actual snapshot bytes; it does not reuse FC, deployment,
reconciliation or smoke evidence. A green FC proves only its recorded selected
checks.

Each task owns its implementation, risk assessment, and authorized delivery.
CI does not require a reviewer count, central coordinator, waiting period, or
unrelated tasks to stop. Fix findings that block the user result or protect a
material security, privacy, data, or compatibility boundary; record separable
follow-ups without reopening an otherwise complete candidate.

Do not monitor or mutate another task's PR, runs, or releases without ownership.
Send a focused handoff only when a real overlap, dependency, or safety failure
changes that owner's next action. Routine status broadcasts are unnecessary.
Model-catalog collector PRs remain draft evidence until an owner takes them over;
see [Agent Profile Model Selection](../product/agent-model-selection.md#automatic-evidence-handoff).

### Actions-unavailable fallback

When hosted Actions is unavailable, run the same policy locally:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- local --pr <number>
```

This lane fetches live `main`, reads the live PR, executes trusted current-main
control against the candidate, rechecks identity after validation, posts the
evidence comment, and publishes the same status. It requires an authenticated
`gh` session and fails closed when GitHub or network evidence is unavailable.
Before local checks and again before final publication, it cancels active hosted
FC runs owned by this PR and exact head, then waits for the entire workflow,
including its publisher, to complete. Cancellation acceptance is not completion.
An unverifiable owner, API failure, or three-minute handoff timeout blocks local
publication. This prevents an older hosted failure from overwriting local
certification without hiding failures or trusting a previous green status.
After a handoff timeout, wait until that exact hosted workflow has completed,
including its publisher, then rerun the same unchanged candidate command.
Do not extend ownership assumptions from an accepted cancellation or publish
the local status manually.
Later explicit hosted requests are new validations, not permanently suppressed.
The first hop fetches depth-one main metadata into an isolated temporary Git
repository, using blob filtering and a sparse checkout of `scripts/` to load
control code on demand. It does not import shallow boundaries or sparse settings
into the candidate repository, or download unrelated product files and history. The bootstrap and
candidate runner still refresh main and verify ancestry using the candidate's
complete history. Repository-local network policy cannot influence the isolated
control fetch, and a failed fetch cannot fall back to cached control code.
Before installing or executing candidate checks, it prints a bounded local
resource preflight: available disk, measured memory and pressure, and active
OpenMeld dev process trees. Other stacks
are facts, not an approval rule. Only the critical one-GiB free-disk safety
floor blocks local execution; constrained-but-usable machines remain an agent
judgment. The preflight never stops another worktree.

The local development commands it invokes may wait for shared worktree
capacity as described in
[Resource Discipline](development-workflow.md#resource-discipline). Waiting
affects execution timing, not candidate identity or validation requirements.
The preflight reports macOS warning and critical pressure separately; both
remain informational here. Development admission owns the quiet-swap observation
for warning-pressure starts, and broad local builds still wait for normal pressure.
When process ownership or resource arbitration changes, dispatch the narrow
`Dev lifecycle` workflow to exercise it on macOS, Linux, and Windows. It uses
disposable processes and no cloud credentials. Ordinary `scripts/dev` edits do
not start three optional platform jobs or delay Final Candidate.

```sh
gh workflow run dev-lifecycle.yml --ref <candidate-branch>
```

A Final Candidate control-plane change cannot certify itself through a
candidate-owned entrypoint. When current `main` lacks the new control, inspect
the control diff and use the explicit local-only bootstrap:

```sh
git show <reviewed-control-sha>:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- local --pr <number> \
  --bootstrap-control-sha <exact-candidate-head> \
  --bootstrap-reason "<why current-main control cannot own this run>"
```

Bootstrap records the exact trust escalation and reason. It does not create a
review requirement or a second delivery process.

### Merge queue

Use merge queue only when the repository's live GitHub plan and Ruleset expose
it. GitHub then creates an exact merge-group commit from current `main` and the
queued changes, and the same `OpenMeld Final Candidate` policy validates that
merge tree. If the repository cannot use merge queue, strict up-to-date branch
protection is the freshness owner.

Do not create a manual substitute queue, release owner, global `main` freeze,
or polling loop. Those mechanisms serialize independent work without adding
merge evidence.

## Merge

Repository protection for `main` requires:

- changes through a pull request;
- exact `OpenMeld Final Candidate` success;
- merge queue validation or strict up-to-date protection; and
- human approval count zero.

Do not pin the status to the GitHub Actions app because the guarded local
fallback publishes the same context. Review beyond the responsible agent's own
evaluation is required only when the task explicitly asks for it.

Immediately before merge, re-read the live head, evidence identity, status,
mergeability, and active Ruleset. If the head changed, create a new candidate.
If only `main` changed, let merge queue validate the new merge group or sync and
run one new current-base candidate. Do not rerun completed checks merely to
produce ceremonial evidence.

From an isolated worktree, merge the remote pull request without coupling that
operation to local branch deletion:

```sh
gh pr merge <pr-number> --merge
gh pr view <pr-number> --json state,mergedAt,mergeCommit
```

Do not pass `--delete-branch` to the merge command. GitHub can merge the pull
request successfully and then report a local cleanup failure when `main` is
checked out in another worktree, making a successful remote merge look failed.
Treat cleanup as a separate step after the remote merged state and merge commit
are proven. An agent's own task-created temporary worktree may be retired as
normal closeout once no acceptance, review, or release depends on it; follow
Resource Discipline in `development-workflow.md`. Pre-existing and other
owners' worktrees, and branch deletion, still require explicit authorization.
Stop unnecessary runtime resources even while an unmerged PR remains open.

## Release

After merge, follow `developing/engineering/production-release.md`. Plan the
exact merged SHA, release only affected scopes, and use the guarded hosted or
local entrypoint selected there. Git-backed scope leases serialize only the
same production scope; they do not block unrelated development, merges, or
compatible releases. Hosted same-scope releases use `cancel-in-progress: false`;
new requests must not cancel an active deployment. A successful guarded local release publishes durable
per-scope evidence refs that record its exact first-parent `main` source and
completion time before releasing those leases. `release:status` combines that
evidence with hosted release jobs; operators do not have to remember ephemeral
workstation-only overrides.

When the exact release includes changed CLI, OpenMeld Service, or bundled
skills, run the local-component plan and supply the explicit policy and reason
required by `production-release.md`. Delivery tooling exposes the changed
components, versions, floors, and missing decisions; it does not guess
`available`, choose `required`, or replace the responsible agent's Contract
Impact Audit.

## Health And Real-User Smoke

Health proves component reachability. Release completion also needs the
smallest user-accessible smoke for the changed path through OpenMeld Web, the
published CLI, installed OpenMeld Service, or another supported product entry
point. Internal RPC, database inspection, and direct projections are diagnostic
evidence, not real-user smoke.

One successful smoke of the exact changed path is sufficient after its visible
result and required trace or diagnostic receipt are recorded. Stop there unless
the task explicitly requires another case, the product state changed, a new
deployment occurred, or the first smoke exposed a failure. Repeating the same
unchanged success is not stronger evidence and must not delay delivery.

Report these facts separately:

```text
Merged PR and merge SHA
Release source SHA and affected scope
Deployed version or workflow evidence
Health result
Real-user smoke entry point and visible result
Anything not run, with reason
```

## Failure And Recovery

- Check or identity failure: keep the exact failure and classify it before
  spending another candidate run. Reproduce deterministic code or test failures
  with the smallest useful local command, batch the known fixes, sync `main`,
  and create one new candidate only after the branch is again ready to merge.
  Retry the same SHA unchanged only when the evidence points to runner,
  platform, network, or genuinely flaky-test failure.
- Hosted candidate unavailable: use `status` or `wait` to preserve the exact
  GitHub reason. The trusted local fallback remains available; do not relabel
  the unchanged head repeatedly, weaken status protection, or invent success.
- Active production scope lease: inspect its owner, source, start, and expiry.
  Wait only for that scope. Recover an expired exact lease with a recorded
  reason after proving its owner stopped.
- Release, health, or smoke failure: preserve the source SHA and completed
  immutable stages, report the failed fact accurately, and follow the scoped
  recovery contract. Never silently continue from another commit.
- npm acceptance is not package availability. A release waiting for npm remains
  incomplete, with its original submission evidence preserved across runners.
  Resume verification without resubmitting an accepted or uncertain publish;
  follow the npm recovery boundary in `production-release.md`.

For CLI publication, source builds and registry version existence do not prove
that an npm user can install the release. The release owner must validate and
publish the same portable tarball, as defined in
[npm submission and availability](production-release.md#npm-submission-and-availability).
Windows compatibility CI also consumes that artifact and exercises the generated
PowerShell bootstrap; signed-in computer and Wake acceptance remain separate.

## Agent Experience Occurrence Feedback

Task collaboration uses focused, agent-chosen `[OpenMeld Dev]` Spaces only when
they help the actual work. Follow
[OpenMeld Development Collaboration](development-workflow.md#openmeld-development-collaboration)
for Space naming, CLI-only handoffs, optional membership and Wake, and native
environment callbacks. The occurrence log below has a different purpose.

Record every firsthand problem an Agent encounters while using or developing
any OpenMeld product surface, App, client, Service, runtime, integration, or
delivery path. This includes Web, Desktop, CLI, Spaces, Agents, Center Agent,
Inbox, Projects, Documents, Agent Activity, Remote Agent, connected Apps,
Staging, developer workflows, CI/CD, Wake testing, release, validation, and
agent-worker behavior. Use the non-interactive Space:

```text
[Agent Experience] OpenMeld CLI, Service & Workflow Feedback
https://openmeld.ai/o/amplift/spaces/5020df25e3a4a1ae0e292b664ca0f3726eaa0ec1cc1ceacc5cd18d7eaa6cb378
```

Use Felix's authorized Human Profile directly; no Service, Wake, history read,
duplicate search, or Agent membership is required. Every Agent records what it
personally encountered even when another Agent may have reported the same
symptom. Repeated reports are frequency evidence. Recording does not authorize
or require an immediate fix.

Start with `[bug]`, `[friction]`, `[gap]`, `[feature]`, or `[shared-pattern]`.
Identify the actual Agent, model when known, session or thread ID, UTC time,
context, expected and observed behavior, impact, non-sensitive evidence, and
current status. Keep the report brief and continue the main task unless the
problem is a real blocker. Never include credentials, secrets, private
transcripts, or unrelated user content.

Use this direct command template:

```bash
openmeld space send 5020df25e3a4a1ae0e292b664ca0f3726eaa0ec1cc1ceacc5cd18d7eaa6cb378 \
  --profile 02325896-2cf8-4fa9-bd49-185db194dc8b \
  --stdin --view agent <<'EOF'
[friction] <short title>
Reporter: <agent and model>
Session: <session or thread ID>
Observed: <UTC timestamp>
Context: <command or workflow>
Expected: <expected result>
Observed behavior: <what happened>
Impact: <time, tokens, correctness, or user impact>
Evidence: <non-sensitive IDs, timings, or exact error>
Status: recorded only; not fixed by this report
EOF
```

The former `OpenMeld CI/CD & Agent Workflow Feedback` Space remains historical;
use this occurrence log for new reports so Agents have one current destination.

## Change Checklist

A delivery-system change updates its implementation, real behavior tests, this
owner document, and affected routes in one PR. Delete retired commands,
workflows, scripts, tests, and instructions so agents cannot discover a second
process.
