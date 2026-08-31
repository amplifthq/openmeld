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

## Outcome

Each coding agent owns its declared scope and may complete its own delivery
lifecycle:

```text
develop and run focused tests
  -> inspect the change and evidence required by the task
  -> commit and push one exact candidate
  -> sync current main
  -> run one Final Candidate
  -> merge the still-current candidate
  -> release only affected production scopes
  -> health check
  -> smallest real-user smoke for the changed path
```

This is not a central-coordinator process. CI/CD reports facts; the responsible
agent uses those facts, the task, and the relevant owner documents to decide
what to do. CI/CD does not choose business scope, mandate a reviewer, or ask
unrelated agents to wait.

## Facts That Must Stay True

1. Ordinary branch pushes do not trigger broad paid CI. An agent requests one
   Final Candidate only when one committed PR head is ready for final
   evaluation. Final Candidate is paid, potentially high-latency merge
   certification, not a development, debugging, or review-discovery loop. Use
   one practical test: if a green result would not make merge the next action,
   keep using the smallest focused or affected checks that prove the work.
2. Candidate evidence identifies one exact `head SHA + validation base SHA +
   tree SHA`, plus candidate kind (`pull-request` or `merge-group`). Evidence
   never transfers to another identity.
3. A selected-check failure, missing evidence, identity mismatch, or
   publication failure cannot become green.
4. A pull-request candidate begins on current `main`. If `main` advances later,
   the completed evidence remains truthful evidence for its original base; it
   is not evidence for the newer merge. Merge queue validates the exact
   merge-group when available. Otherwise, strict up-to-date protection requires
   a current-base candidate before merge.
5. Test selection follows changed risk. Unit, integration, database, contract,
   local-component, signing, migration, health, and smoke checks run only where
   their boundary makes them useful.
6. Merge, release, health, and smoke are separate facts. Do not report one as
   proof of another.
7. Production releases use one explicit 40-character first-parent `main` SHA.
   Same-scope releases serialize with `cancel-in-progress: false`; compatible
   scopes may run in parallel.
8. GitHub Actions is the normal Final Candidate compute lane. The guarded local
   lane is the fallback for quota, billing, or runner outages, not the normal
   way to move CI load onto a busy developer computer.

## Develop, Review, And Prepare

Use focused tests while developing. The responsible agent chooses the smallest
real checks that prove the change, performs the review required by the task,
and may ask for more confidence when the risk justifies it. No reviewer
identity, reviewer count, approval count, or specific review style is required
by CI/CD.

Inspect the transparent candidate plan at any time:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan
```

The plan prints changed paths, selected and skipped checks, reasons, and exact
commands. It is evidence for engineering judgment, not a command to merge or a
substitute for understanding the task. Add `--full` when uncertainty warrants
repository-wide checks.

Before requesting Final Candidate:

1. finish the scoped implementation, focused tests, and task-required review;
2. commit and push the exact tree;
3. fetch current `origin/main` and sync it into the branch;
4. resolve conflicts and rerun checks affected by the sync; and
5. confirm a clean worktree and an open, non-draft PR targeting `main`.

These are engineering facts, not an approval form. Final Candidate does not
require a waiting period, a fixed reviewer count, or permission from a central
coordinator. The responsible agent keeps the judgment and may request stronger
confidence when the actual risk warrants it.

Do not ask unrelated agents to freeze `main`. If another operation genuinely
blocks this task, preserve the exact SHA and completed evidence, state the one
blocking fact, end the active turn, and resume from a deterministic callback or
new state change. Repeated polling is appropriate only for a short operation
that this same turn already started and must close.

Silence is the default collaboration behavior. One pull request, branch, or
production scope has one execution owner. A non-owner must not monitor or
mutate its labels, candidate runs, commits, merge, release, or smoke merely to
be helpful. A status message does not transfer ownership; transfer is explicit,
names the exact object and remaining action, and is accepted by the new owner.

Send one direct coordination message only when a newly observed fact changes
another owner's next safe action: a real file overlap, competing mutation of
the same PR or production scope, an exact `main` or lease dependency, or a
safety failure. Address the actual owner, include the smallest actionable fact,
then continue independent work or stop. Do not broadcast, relay through a
coordinator, request an acknowledgement, poll the other task, take over its
work, or send routine progress. Send a completion callback only to a task that
explicitly depends on that outcome; otherwise stay silent.

Use the callback transport the two environments already support. Codex App may
use `send_message_to_thread`; other environments may use task messaging, a PR
comment, an authorized focused Space, or an operator handoff. The transport
carries one real dependency and never creates a central coordinator. Without
an available transport, preserve the facts and resume only after an external
state change.

## Final Candidate

The normal path uses GitHub-hosted compute:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- request --pr <number>
```

Observe that request without streaming a full workflow log into the agent
context:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- status --pr <number>
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- wait --pr <number>
```

`status` reads once. `wait` polls in the terminal process and prints only state
transitions plus the final exact status. Full logs stay in GitHub. A captured
GitHub job annotation distinguishes an Actions budget or billing refusal from a
candidate check failure and reports whether candidate checks ever started. A
later hosted budget refusal does not invalidate an existing successful exact
status for the same head.

Use `--full` only when the responsible agent wants full confidence. Standard
and full requests use distinct labels but publish the same required status:

```text
OpenMeld Final Candidate
```

The trusted current-main control plane validates the live PR identity, selects
checks, runs candidate code without write credentials, publishes the exact
result, and preserves schema-validated evidence plus complete redacted command
logs. Successful command output stays in logs; terminal output stays compact:
identity, plan, current check, result, duration, bounded failure tail, and
evidence path.

Canonical evidence includes exact identities, changed paths, risk tags,
selected and skipped checks with reasons, commands, durations, results,
execution mode, conclusion, publication errors, and whether a check executed
or reused an earlier exact input fingerprint. The schema owner is
`packages/schemas/src/schemas/ci/final-candidate.ts`.

Hosted Final Candidate may reuse deterministic affected workspace checks, unit
tests, and integration tests from an earlier completed run of the same PR and
branch when that exact check passed. Reuse requires the earlier validation base to be an ancestor of the
current base, identical changed paths, confidence, command, reason, runtime,
and exact Turborepo task IDs and task hashes. Checks and unit tests fingerprint
the changed workspaces; integration tests fingerprint the affected workspaces
and dependents that the real integration command executes. Trusted control
still rechecks the current candidate identity and records the prior exact
head/base/tree in new evidence. Missing, invalid, stale, differently scoped, or
unprovable evidence simply causes the check to run normally. Database,
release-ready, signing, deploy, health, and smoke evidence is never reused by
this optimization. This is compute reuse, not merge advice, approval, or a
manual bypass.

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
Before installing or executing candidate checks, it prints a bounded local
resource preflight: available disk and active OpenMeld dev stacks. Other stacks
are facts, not an approval rule. Only the critical one-GiB free-disk safety
floor blocks local execution; constrained-but-usable machines remain an agent
judgment. The preflight never stops another worktree.

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

## Release

After merge, follow `developing/engineering/production-release.md`. Plan the
exact merged SHA, release only affected scopes, and use the guarded hosted or
local entrypoint selected there. Git-backed scope leases serialize only the
same production scope; they do not block unrelated development, merges, or
compatible releases. A successful guarded local release publishes durable
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

## Development Infrastructure Feedback

Task collaboration uses focused, agent-chosen `[OpenMeld Dev]` Spaces only when
they help the actual work. Follow
[OpenMeld Development Collaboration](development-workflow.md#openmeld-development-collaboration)
for Space naming, CLI-only handoffs, optional membership and Wake, and native
environment callbacks. The feedback Space below has a different purpose.

Report reusable CI/CD, Wake testing, release, or agent-worker friction to the
non-interactive Space:

```text
OpenMeld CI/CD & Agent Workflow Feedback
https://openmeld.ai/o/amplift/spaces/fd628798c701754227a1ffcbf273e62dbaa5daa98f61b1804425b49057967fb6
```

Prefer `openmeld space send` with an authorized Human Profile; no Service,
Wake, or Agent membership is required. Start with `[bug]`, `[friction]`,
`[gap]`, `[feature]`, or `[shared-pattern]`, then state agent/model/session,
context, what happened, impact, and evidence in a few plain sentences. Never
include credentials or private user content. Report product-perspective Wake
friction and CI/CD delays that block otherwise complete work even when the
current task cannot afford to fix them.

## Change Checklist

A delivery-system change updates its implementation, real behavior tests, this
owner document, and affected routes in one PR. Delete retired commands,
workflows, scripts, tests, and instructions so agents cannot discover a second
process.
