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
   evaluation.
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

Do not ask unrelated agents to freeze `main`. If another operation genuinely
blocks this task, preserve the exact SHA and completed evidence, state the one
blocking fact, end the active turn, and resume from a deterministic callback or
new state change. Repeated polling is appropriate only for a short operation
that this same turn already started and must close.

## Final Candidate

The normal path uses GitHub-hosted compute:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- request --pr <number>
```

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
execution mode, conclusion, and publication errors. The schema owner is
`packages/schemas/src/schemas/ci/final-candidate.ts`.

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
compatible releases.

## Health And Real-User Smoke

Health proves component reachability. Release completion also needs the
smallest user-accessible smoke for the changed path through OpenMeld Web, the
published CLI, installed OpenMeld Service, or another supported product entry
point. Internal RPC, database inspection, and direct projections are diagnostic
evidence, not real-user smoke.

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

- Check or identity failure: keep the exact failure, fix the cause on a new
  commit, sync `main`, and create one new candidate.
- Hosted candidate unavailable: use the trusted local fallback; do not weaken
  status protection or invent success.
- Active production scope lease: inspect its owner, source, start, and expiry.
  Wait only for that scope. Recover an expired exact lease with a recorded
  reason after proving its owner stopped.
- Release, health, or smoke failure: preserve the source SHA and completed
  immutable stages, report the failed fact accurately, and follow the scoped
  recovery contract. Never silently continue from another commit.

## Development Infrastructure Feedback

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
