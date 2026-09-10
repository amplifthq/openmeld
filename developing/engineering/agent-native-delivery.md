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

## Daily Workflow

The same workflow applies to engineers, Codex, Claude Code, and other coding
agents. Run `pnpm install --frozen-lockfile` in each checkout to install dependencies
and Husky hooks. Keep `origin/main` available with `git fetch origin main`.

| Stage | Required work | Why |
| --- | --- | --- |
| Commit | The hook checks staged files with `lint-staged`. | Catch cheap errors while the change is small. |
| Push a development branch | The hook runs focused checks on the exact pushed commit and blocks failures. | Find problems before the merge queue. |
| Develop and review | Validate the behavior and affected consumers; add type, build, database, or integration checks where the changed boundary requires them. | A file selector cannot decide product risk. |
| Mark the PR ready | Sync current `main`, resolve conflicts, and validate the affected interactions. Standard FC starts automatically. | Certify the actual next merge. |
| Merge | Require current-base `OpenMeld Final Candidate` success for the unchanged candidate. | Prevent stale or mismatched green results. |
| Release | Follow [Production Release](production-release.md), then health and real-user smoke. | Merge success is not deployment or product success. |

Do not bypass hooks to ship a failed check. Diagnose with the smallest failing
command, fix the cause, and push again. Hooks are local feedback, not remotely
attested evidence; FC does not claim they ran or that every business test passed.

## Focused Checks Before Push

Inspect or run the shared local/draft entrypoint:

```sh
pnpm run verify:pr -- --feedback --plan
pnpm run verify:pr -- --feedback
```

It selects changed-file Biome checks, relevant docs/Changelog contracts,
adjacent Node tests, and related Vitest tests in directly changed workspaces.
Plain package test aliases retain their own config; unsupported runners use
the package's test command instead of silently skipping tests. Dependency builds
use Turbo's cache. Test commands run sequentially, Node test files run serially,
and related Vitest tests use at most two workers without file parallelism.
Every run uses a disposable `OPENMELD_HOME`.

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

Draft PR Feedback runs the same focused checks remotely against the full PR
diff. It is independent feedback, not permission to merge. Keep leaf PRs in
draft during development and batch preparation. Mark ready only when a green
FC would make merge the next action. New commits cancel superseded feedback
and FC runs for that PR.

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
- repository static contracts and control-code quality;
- database checks when database owner paths change; and
- deferred or strict local-component release readiness, selected by branch/path.

Standard FC does not repeat broad workspace unit or integration tests. This
keeps final merge latency separate from development feedback. Full confidence
is explicit when remaining risk justifies a whole-repository rerun. The printed
plan is the authority for selected/skipped commands, reasons, and durations:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan
```

A non-draft PR targeting `main` starts standard FC on opening, new commits,
reopening, or marking ready; no label is needed. To retry after diagnosing a
failure, or explicitly request full confidence:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- request --pr <number>
# Add --full only when the remaining risk warrants it.
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- status --pr <number>
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- wait --pr <number>
```

Use the current-main entrypoint, never candidate-owned package scripts.
GitHub Actions is the normal compute lane; the guarded local lane below is for
Actions outages or explicit control bootstrap. A failed check, missing evidence,
identity mismatch, or publication failure cannot become green. Local hook output
and draft feedback cannot substitute for the required FC status.

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
The narrow `Dev lifecycle` workflow additionally exercises process ownership
and resource arbitration on macOS, Linux and Windows when development scripts
change. It uses disposable processes, requires no cloud credentials, and does
not replace Final Candidate.

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
