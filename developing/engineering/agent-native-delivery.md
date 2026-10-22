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

For one PR or a compatible batch:

1. Stabilize the scope and run focused checks. Use one integrated
   [Final Candidate](#final-candidate) for compatible changes. Pin the pre-merge
   base and the final product SHA.
2. [Merge](#merge) against current main. If a merge result is uncertain, read the
   remote PR state before retrying.
3. Release the merged SHA with
   `pnpm run deploy -- --scope <auto|names> --lane <local|github|auto>` from
   [production release](production-release.md). It orders components and stops
   at the first failed health check. Rerun the same command to resume; every
   component step is idempotent.
4. Reuse the release command's health results; run real-user smoke for the
   changed paths. Report what shipped, what was actually tested, and any
   remaining failure or uncertainty.

Include Desktop or OpenConnector when the requested scope or changed behavior
requires their own release. Their publication owners are linked from
[production release](production-release.md).

## Daily Workflow

The same workflow applies to engineers, Codex, Claude Code, and other coding
agents. Run `pnpm install --frozen-lockfile` in each checkout to install dependencies
and Husky hooks. Keep `origin/main` available with `git fetch origin main`.

| Stage | Required work | Why |
| --- | --- | --- |
| Commit | The hook checks staged files with `lint-staged`. | Catch cheap errors while the change is small. |
| Push a development branch | The hook runs strict release checks only for `main` and non-branch refs; ordinary pushes stay fast. | Avoid repeating development tests on every push. |
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
Recheck identity and cleanliness after success. Deletions need no tests.

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
- local-component release readiness when the CLI, Service, Skills, or their
  policy changes.

Standard FC does not repeat broad workspace unit or integration tests; owners
run focused tests before Ready, and full confidence is explicit when remaining
risk justifies a whole-repository rerun. Release and CI script changes get
their exact diff and control identity checked; dependency and task-graph
controls still select the wider static repository contracts. The printed plan
is the authority for selected/skipped commands, reasons, and durations:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan
```

Trusted control installs only the shared evidence parser's production
dependencies. Candidate dependencies stay isolated and complete for the
selected checks: documentation-only plans install root tooling without native
rebuilds; signed CLI Skills, release readiness, and executable changes keep the
workspace install. The trusted plan decides this for both PRs and merge groups.

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
fail-closed, and the isolated command wrapper forces a trusted `script-shell`
so a candidate `.npmrc` cannot rewrite how later `pnpm run` checks execute.
Those pull requests use the documented local explicit bootstrap. Trusted
current-main control classifies that case before candidate dependencies or
validation run, so the `Final Candidate Runner` check is skipped instead of
showing a product-test failure, and the required `OpenMeld Final Candidate`
status names the control refuse and the bootstrap path.
[GitHub treats a skipped check as non-blocking](https://docs.github.com/en/pull-requests/reference/status-checks),
so the Runner is not the merge authority: only the separate commit status is
required, and it stays failed until the exact candidate passes the protected
local bootstrap. Any ordinary test, build, runner, classifier, or publisher
failure remains a failure and cannot publish green.

A non-draft PR targeting `main` starts standard FC on opening, new commits,
reopening, or marking ready; no label is needed. To retry after diagnosing a
failure, or explicitly request full confidence:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- request --pr <number>
# Add --full only when the remaining risk warrants it.
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- status --pr <number>
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- wait --pr <number>
```

Use `wait` instead of polling `gh pr checks`. Automatic runs publish no
pending status; an explicit `request` marks the head pending until it reports.

Fork and same-repository candidates run on `pull_request` with read-only job
permissions and no production environment or secrets; the run title names the
exact PR, head, confidence, and base. A separate `workflow_run` result workflow
runs trusted default-branch code once the source run completes. Its read-only
verifier binds the exact source run, attempt, PR, head, tree, and base through
GitHub, requires that base to be part of current `main`, then recomputes the
control disposition and validation plan before accepting evidence. It reads
candidate source as immutable Git objects, treats artifacts as data, and never
runs candidate scripts. A separate status writer rechecks the live head and the
latest run without checking out code or downloading artifacts. A finished
result stays bound to its exact head, base, and tree: `main` advancing later
does not turn it red, because merge queue or strict up-to-date protection owns
freshness at merge time. Changes to either workflow require the protected
local bootstrap. Workflow approval for first-time contributors remains a GitHub
repository policy, separate from PR review approval.

CodeQL uses `.github/workflows/codeql.yml` so fork PRs and merge groups
receive the same required `Analyze (javascript-typescript)` check as
repository branches. Keep GitHub's default setup disabled; it excludes fork PRs
and blocks uploads from advanced workflows. The workflow scans without
installing dependencies or running repository build scripts. The pull request
scan gates queue admission and the `main` push scan covers the merged result,
so a merge group reports the required check without repeating the 9-15 minute
full scan. A finding that only the combination of queued changes introduces
can surface only in a later completed `main` scan; a newer `main` push cancels
an in-progress one, and the weekly schedule also covers `main`.

Use the current-main entrypoint, never candidate-owned package scripts. GitHub
Actions is the normal compute lane; the guarded local lane below is for Actions
outages or explicit control bootstrap. A failed check, missing evidence,
identity mismatch, or publication failure cannot become green.

For a batch, integrate compatible ready leaf changes, sync `main` once, validate
the combined interactions, and run one FC on the batch PR. Do not pay for leaf
FCs that will immediately become stale. Preserve directional release order: for
example, new Space-invitation Core/Auth receivers must precede the new CLI.
Evidence stays valid for its original base: when `main` advances, merge queue
validates the merge group, so do not sync a green candidate only to refresh
its base (strict protection alone needs one sync). Do not freeze unrelated work.

## Evidence And Ownership

The trusted current-main controller runs candidate code without write credentials
and publishes schema-validated evidence: identities, selected/skipped checks,
commands, results, durations, execution mode, and bounded failure details.
Full command logs remain in the evidence artifact. The schema owner is
`packages/schemas/src/schemas/ci/final-candidate.ts`.

Existing trusted task-input reuse remains available to specialized affected
plans; standard FC no longer selects those broad tasks. Full confidence executes
its full gate. Database/release readiness and deployment/health/smoke results are
never reused. A green FC proves only its recorded selected checks.

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
FC runs owned by this PR and exact head. It waits for the source workflow and
the separate completed-event result workflow for that source run and attempt.
An empty result list means the event may still be pending; it is not completion.
The result workflow name carries the source run ID, attempt, and event so the
handoff can wait automatically without guessing from elapsed time or green checks.
An unverifiable owner, API failure, three-minute cancellation timeout, or
twenty-minute result timeout blocks local publication. This prevents an older
hosted failure from overwriting local certification without hiding failures or
trusting a previous green status. After a timeout, inspect the named source and
result workflows before retrying. Runs from before result names were introduced
need a new hosted request before local takeover.
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

Merge queue owns freshness for `main`: a pull request queues after its own
checks pass, so a green candidate on an older base needs no sync.
`merge-group-final-candidate.yml` (the required `OpenMeld Final Candidate`
check) validates GitHub's exact merge-group commit; CodeQL reports its required
check there without rescanning. Branch protection requires
merge queue (method `merge`, build concurrency 1, one to five pull requests per
group, only non-failing pull requests, 60-minute status check timeout) with
"Require branches to be up to date" off; until then strict up-to-date owns
freshness. Never turn both off. Current-main control validates a group whose FC
control matches `main`. A group with control drift runs under its own control
only if it is built on the `main` tip, its second parent is the queued pull
request's live head with a successful FC status naming it (the bootstrap
above), and each drifted control equals that head's and was changed by it.

Do not create a manual substitute queue, release owner, global `main` freeze,
or polling loop; they serialize independent work without adding merge evidence.

## Merge

The project merge contract requires:

- changes through a pull request;
- exact `OpenMeld Final Candidate` success;
- merge queue validation or server-enforced strict up-to-date protection; and
- compliance with live GitHub rules, including the authenticated actor's
  configured review exemptions.

Do not pin the status to the GitHub Actions app because the guarded local
fallback publishes the same context. Additional review follows the user's
request and the live rules applicable to the authenticated actor. Do not
hard-code a zero approval count: a ruleset can require approval by default
while allowing named actors to merge through a pull request without it.

Immediately before merge, re-read the live head, evidence identity, status,
mergeability, and active Ruleset. If the head changed, create a new candidate.
If only `main` changed, let merge queue validate the new merge group; sync and
run one new candidate only while strict up-to-date protection is the freshness
owner. Do not rerun completed checks merely to produce ceremonial evidence.

Before reporting an approval blocker, distinguish the PR's default review
state from the current actor's effective permission. `REVIEW_REQUIRED`,
`BLOCKED`, and a refusal from ordinary `gh pr merge` are not sufficient proof
that the authenticated actor needs another reviewer. Check:

```sh
gh api user --jq '{login,id}'
gh api repos/<owner>/<repo>/rules/branches/main
# Include inherited rulesets when checking the current actor's permission.
gh api 'repos/<owner>/<repo>/rulesets/<ruleset-id>?includes_parents=true'
```

Inspect `current_user_can_bypass`, `bypass_actors`, and `bypass_mode` in each
applicable ruleset, plus any separate branch protection. The branch rules
summary alone does not establish actor exemptions. A repository admin role
alone also does not establish an exemption. Missing permission evidence is
unknown, not proof that an exemption was removed. For a suspected policy
change, inspect the source repository or organization's ruleset `/history` and
`/history/<version-id>` endpoints before claiming who changed it or what changed.

When the user has authorized the merge, the current actor has an existing
exemption covering the unmet review requirement, and all other project and
GitHub requirements are satisfied, use that permission without asking the user
for approval again. If ordinary `gh pr merge` refuses on that review state,
the CLI's `--admin` option can exercise the existing exemption. This does not
change the ruleset or add permissions. Never use it to skip failed or pending
validation, stale Final Candidate evidence, an unresolved conflict, a required
merge queue, or review explicitly requested by the user. Do not edit rules or
add bypass actors to complete a merge task.

The review exemption must not bypass a separate server-enforced freshness rule.
`--match-head-commit` pins only the PR head, not the base or merge tree. A local
base check cannot replace strict up-to-date protection or a merge queue because
another merge can advance `main` between the check and the merge. If the
exemption would also bypass freshness protection, do not use this CLI path;
use the protected merge queue or report the missing atomic merge protection.

From an isolated worktree, merge the remote pull request without coupling that
operation to local branch deletion:

```sh
gh pr merge <pr-number> --merge --match-head-commit <verified-head-sha>
# Only for the verified review-exemption case described above:
gh pr merge <pr-number> --merge --admin --match-head-commit <verified-head-sha>
# With merge queue required, merge only enqueues; confirm after the group passes:
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

After merge, release the exact merged SHA through
[production release](production-release.md), affected components only.
The unified deploy command dispatches cloud and CLI through their own top-level
GitHub entrypoints, preserving the CLI's existing npm Trusted Publisher identity.
`concurrency: production-<name>` with `cancel-in-progress: false` serializes
one component at a time without blocking development, merges, or other
components. The platform records what is live: Worker `RELEASE_SHA`, the
renderer source meta tag, and npm `gitHead`.

A changed CLI, OpenMeld Service, or bundled Skills needs the explicit
`available` or `required` decision and reason in
`release/local-components-policy.json`, written in the feature PR after the
Contract Impact Audit. Publication refuses a changed component without one.

## Health And Real-User Smoke

Health proves component reachability. Release completion also needs the
smallest user-accessible smoke for the changed path through OpenMeld Web, the
published CLI, installed OpenMeld Service, or another supported product entry
point. Internal RPC, database inspection, and direct projections are diagnostic
evidence, not real-user smoke.

One recorded success of the exact changed path is enough. Repeat only when the
task requires another case, the product state changed, a new deployment
occurred, or the first smoke failed.

Report these facts separately:

```text
Merged PR and merge SHA
Release SHA, components, and lane
Workflow run or local output
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
- Release or health failure: GitHub stops dependent components; independent
  website and docs jobs still run. The local lane stops at the first failure.
  Report the failure and follow [recovery](production-release.md#recovery).
  Never continue from another commit.
- npm late: the CLI release stays incomplete. Rerun the same SHA; it resumes
  without republishing, as in
  [npm submission and availability](production-release.md#npm-submission-and-availability).

## Agent Experience Feedback

Task collaboration uses focused, agent-chosen `[OpenMeld Dev]` Spaces only when
they help the actual work. Follow
[OpenMeld Development Collaboration](development-workflow.md#openmeld-development-collaboration)
for Space naming, CLI-only handoffs, optional membership and Wake, and native
environment callbacks. The feedback Space below is for confirmed product
problems that need another owner, not an occurrence log or repair progress feed.

Record only firsthand OpenMeld product bugs or experience gaps that remain
confirmed in current `origin/main`, that you will not take on, and that have no
existing repair owner. Use the non-interactive Space:

```text
[Agent Experience] OpenMeld CLI, Service & Workflow Feedback
https://app.openmeld.ai/spaces/5020df25e3a4a1ae0e292b664ca0f3726eaa0ec1cc1ceacc5cd18d7eaa6cb378
```

### Check eligibility before posting

All three conditions must hold:

1. **Confirmed current-origin product problem.** Refresh `origin/main` and
   record its commit. Use relevant source evidence or a safe isolated
   reproduction to confirm the observed bug or experience gap still exists.
   Identify the affected product surface, expected behavior, and concrete user
   impact. A failure notice alone does not establish a product defect. If the
   evidence is insufficient, keep investigating in the task instead of posting.
2. **You will not take on the repair.** If you intend to investigate and fix it,
   keep the evidence and progress in your task and PR. Do not first post a
   temporary occurrence record to the feedback Space. This applies before you
   create a branch or PR, during implementation, and while awaiting review or
   release. If you later leave a confirmed problem unresolved without an owner,
   check eligibility again and report it as a handoff.
3. **No existing repair or duplicate report.** Check relevant open and merged
   PRs, known active tasks, and a bounded recent Space history. Inspect actual
   scope and repair evidence. A similar PR title or Activity status does not
   prove coverage or ownership. Another Agent or developer who explicitly owns
   the repair counts even without a PR. Keep additional evidence with that task
   or PR. Do not post duplicate reports or repair progress to the feedback
   Space. For an existing unowned Space report, add material new evidence in its
   thread instead of creating another top-level report.

Cloud, Web, Desktop, CLI, and Service product behavior can qualify. Problems
confined to a development branch, staging, fixtures, internal build, CI/CD,
release, or validation tooling stay in the owning task, PR, or issue. An
isolated reproduction may prove a current-origin product defect; it does not
prove that production runs the same code. State those facts separately. Never
reproduce a dangerous fault in production just to qualify for this Space.

Expected permission, input, quota, and upstream failures are not product bugs
when OpenMeld handles them correctly. Concrete mishandling, such as lost
results or a false success state, can qualify. Exclude speculative causes,
abstract feature wishes, and repair or acceptance progress updates.

### Fixed problems and new evidence

Do not treat an already-fixed problem as pending feedback. This includes a fix
in an owning task or PR and a fix merged into `origin/main`, whether deployed
or not. Deployment lag does not create a new unresolved report. Keep release
status and observations from older installations with the owning task or PR.

A claim that a problem was fixed does not override new evidence. If the problem
still reproduces on fresh `origin/main`, record the checked commit, reproduction,
and claimed fix in the owning task first. Distinguish an incomplete fix, a
regression after the fix, and a separate new problem. A repeated symptom from
an older branch or undeployed version does not establish a recurrence.
Apply all eligibility checks again before posting. If a repair owner remains,
keep the new evidence with that owner. Otherwise, use the existing report's
thread for the same unresolved problem. Create a new report only for a distinct
problem or a confirmed recurrence after resolution, and link the prior report
or fix when available.

### One report per unresolved problem

Outside a dispatch-owned runtime, use Felix's authorized Human Profile directly
after the checks above. No Service startup, Wake, or Agent membership is
required. Recording requests a handoff; it does not authorize another Agent to
implement a fix. Preserve existing reports as history; this rule does not
authorize deleting them.

Start with `[bug]`, `[friction]`, or `[gap]`. Identify the actual Agent, model
when known, session or thread ID, UTC time, product environment/version, task,
expected and observed behavior, concrete impact, brief non-sensitive evidence,
the checked origin commit, and why the problem needs another owner. Keep the
report brief and continue the main task unless the problem is a real blocker.
Never include credentials, secrets, private
transcripts, or unrelated user content.

Inside a dispatch-owned runtime, `openmeld space send` is intentionally blocked,
including with a Human Profile. For an eligible problem, hand off brief,
non-sensitive evidence through the current task's supplied Space Action
`report_progress` tool when available, or include it in the normal final
`reply`. State that feedback has not been submitted. These actions remain bound
to the current task's Space and Agent identity; do not clear the runtime guard
or switch identities to run the direct command.

An authorized reporter outside that runtime can recheck eligibility and submit
the report with Felix's Human Profile. Until that happens, keep the evidence in
the current task and do not claim a feedback post. A structured-action receipt
does not prove publication in the feedback Space. The separate
`openmeld feedback` command submits a Feedback Issue to a Feedback Inbox; it
does not replace this Space handoff.

Outside a dispatch-owned runtime, use this direct command template:

```bash
openmeld space send 5020df25e3a4a1ae0e292b664ca0f3726eaa0ec1cc1ceacc5cd18d7eaa6cb378 \
  --profile 02325896-2cf8-4fa9-bd49-185db194dc8b \
  --stdin --view agent <<'EOF'
[friction] <short title>
Reporter: <agent and model>
Session: <session or thread ID>
Observed: <UTC timestamp>
Product: <affected product surface and observed environment/version>
Origin: <fresh origin/main commit and evidence that the problem remains>
Context: <real task and command or workflow>
Expected: <expected result>
Observed behavior: <what happened>
Impact: <time, tokens, correctness, or user impact>
Evidence: <non-sensitive IDs, timings, or exact error>
Ownership: <why I will not take this on; relevant repair/duplicate checks>
Status: confirmed unresolved problem; needs another owner
EOF
```

The former `OpenMeld CI/CD & Agent Workflow Feedback` Space remains historical;
use this Space only for new reports that pass all eligibility checks above.

## Change Checklist

A delivery-system change updates its implementation, real behavior tests, this
owner document, and affected routes in one PR. Delete retired commands,
workflows, scripts, tests, and instructions so agents cannot discover a second
process.
