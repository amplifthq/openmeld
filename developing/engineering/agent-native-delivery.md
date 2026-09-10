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
  -> run one lightweight Final Candidate
  -> merge the still-current candidate
  -> release only affected production scopes
  -> health check
  -> smallest real-user smoke for the changed path
```

For a coordinated train of compatible changes, integrate the ready leaf
branches into one batch branch, sync `main` once, and run one Final Candidate
on the combined batch PR. Keep leaf PRs in draft while preparing the batch.
Leaf PRs keep their focused evidence but do not each pay for an immediately
stale Final Candidate or merge to `main` first. The
combined candidate is the merge unit and proves the interactions users will
actually receive.

Batch integration must also check directional release dependencies. For example,
Space invitations require Core and Auth receivers before the new CLI; follow
the staged order in `production-release.md`, not the default fleet order.

This is not a central-coordinator process. CI/CD reports facts; the responsible
agent uses those facts, the task, and the relevant owner documents to decide
what to do. CI/CD does not choose business scope, mandate a reviewer, or ask
unrelated agents to wait.

## Facts That Must Stay True

1. Standard Final Candidate starts automatically when a non-draft PR targeting
   `main` is opened, updated with new commits, reopened, or marked ready for
   review. Branches without a ready PR and draft PRs do not run it. Keep work
   in draft during development or batch preparation; marking it ready is the
   normal trigger and requires no label or special command. A newer candidate
   cancels the older run for that PR. Standard Final Candidate is bounded merge
   certification, not a second unit/integration test run and not a development,
   debugging, or review-discovery loop. Use
   one practical test: if a green result would not make merge the next action,
   keep using the smallest focused or affected checks that prove the work.
   When known predecessor pull requests still need to enter `main`, wait for
   that merge order instead of starting a paid run that cannot certify the
   eventual merge. Keep the branch moving with focused or affected checks,
   then sync current `main` once and run the one Final Candidate that can lead
   directly to merge. When two or more compatible ready changes share one
   delivery window, prefer one batch integration PR and one combined Final
   Candidate. If that candidate fails, use the leaf commit boundaries and the
   smallest failing command to locate the responsible change; do not pay the
   per-leaf cost in advance merely to make diagnosis easier.
2. Candidate evidence identifies one exact `head SHA + validation base SHA +
   tree SHA`, plus candidate kind (`pull-request` or `merge-group`). Evidence
   never transfers to another identity.
3. A selected-check failure, missing evidence, identity mismatch, or
   publication failure cannot become green.
4. A pull-request candidate begins on current `main`. If `main` advances later,
   the completed evidence remains truthful evidence for its original base; it
   is not evidence for the newer merge. Merge queue validates the exact
   merge-group when available. Otherwise, strict up-to-date protection requires
   a current-base candidate before merge. Call the completed old-base run
   prevalidation: it may still inform review or diagnosis, but it is not
   current-main merge evidence. When the branch reaches the front of its merge
   order, sync current `main` once and form one new exact-current-main
   candidate; do not rerun or relabel the old-base result as merge-valid.
5. Test selection follows changed risk. Focused, affected, and integration
   checks run while the responsible agent develops and reviews the change.
   Standard Final Candidate does not repeat broad workspace unit or integration
   lanes; it certifies exact identity, trusted control, repository contracts,
   and path-owned database or release readiness. Explicit full confidence is
   available when repository-wide reruns are worth their latency.
6. Merge, release, health, and smoke are separate facts. Do not report one as
   proof of another.
7. Production releases use one explicit 40-character first-parent `main` SHA.
   Same-scope releases serialize with `cancel-in-progress: false`; compatible
   scopes may run in parallel.
8. GitHub Actions is the normal Final Candidate compute lane. The guarded local
   lane is the fallback for quota, billing, or runner outages, not the normal
   way to move CI load onto a busy developer computer.

## Develop, Review, And Prepare

The scheduled model-catalog collector prepares one combined draft evidence PR
per complete scan, not delivery
candidates. Its twelve-hour collection, source contracts, and coding-agent
handoff are defined in
[Agent Profile Model Selection](../product/agent-model-selection.md#automatic-evidence-handoff).
It does not request Final Candidate or merge/release. The agent who explicitly
takes over its PR owns product decisions, missing compatibility evidence, real
validation, and the normal authorized lifecycle below. An open collector PR is
left untouched by later bot runs.

Use focused tests while developing. The responsible agent chooses the smallest
real checks that prove the change, performs the review required by the task,
and may ask for more confidence when the risk justifies it. No reviewer
identity, reviewer count, approval count, or specific review style is required
by CI/CD.

Broad affected and integration runs are agent-chosen development or review
evidence. PR Feedback also runs the existing affected check/unit lane on PR
creation and updates, including drafts, using read-only permissions and no
production secrets. It cancels superseded runs and is early defect feedback,
not exact Final Candidate certification. Documentation-only changes avoid
workspace tests. Integration and full-confidence runs remain deliberate.
Release-ready and Final Candidate are delivery evidence. Before the
first broad run, finish the review that
is reasonably likely to change product behavior, contracts, compatibility, or
scope, and settle its practical blockers. An earlier broad run is appropriate
when the responsible agent genuinely needs it to locate a cross-boundary bug;
call that a diagnostic run, run only the boundary that can answer the question,
and do not cascade into the remaining closeout gates yet.

At closeout, a real finding is evidence, not automatic scope. Fix it in the
current candidate when its user value is material and the correction remains
small, coherent with the same owner and contract, and unlikely to delay the
requested result or reopen broad risk. Also fix findings that block that result
or materially protect a common or high-harm, irreversible, security-, privacy-,
data-, or supported-compatibility path. Outside those mandatory cases, a finding
that introduces a separate owner, source of truth, contract, or user journey
defaults to a follow-up unless the current correction would otherwise be
incomplete or unsafe.

Preserve a deferred finding when it is useful enough to revisit. Record the
symptom, impact, available evidence, and reason for deferral in the repository's
appropriate issue or feedback system, or in authorized persistent task memory
when that is the durable surface available to future agents. Beyond the required
Agent Experience occurrence record below, do not create separate tracking work
for a trivial observation, and do not let recording reopen the current
candidate. This judgment does not require a new approval, checklist, ticket,
reviewer count, or meeting.

Inspect the transparent candidate plan at any time:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan
```

The plan prints changed paths, selected and skipped checks, reasons, and exact
commands. It is evidence for engineering judgment, not a command to merge or a
substitute for understanding the task. Standard plans must not select
`verify:pr`, `verify:pr:full`, or `test:integration:affected`; those broad lanes
belong to development/review or explicit full confidence. Add `--full` only
when uncertainty or material risk makes the repository-wide rerun worth its
latency.

Before marking a PR ready for automatic Final Candidate, or requesting a retry:

1. finish the scoped implementation, focused tests, and task-required review;
2. for a coordinated train, integrate every ready compatible leaf into the
   batch branch and freeze that combined scope;
3. fetch current `origin/main` and sync it into the candidate branch once;
4. resolve conflicts and rerun checks affected by the sync;
5. commit and push the exact single-PR or batch tree; and
6. confirm a clean worktree and mark the PR ready, targeting `main`.

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

The normal path uses GitHub-hosted compute automatically for ready PRs. Opening
a non-draft PR, pushing new commits to it, reopening it, or marking a draft PR
ready starts standard Final Candidate. Observe the existing run instead of
requesting another one after each push. Draft PRs intentionally have no FC
result and cannot merge until they are ready and pass validation.

The automatic triggers use GitHub's `pull_request_target` events and retain
the trusted current-main runner and credential isolation. Unrelated label
events neither run checks nor cancel an active candidate. Automatic runs use
standard confidence; an old full-confidence label does not make every later
push run the full repository gate.

Use the existing explicit request for a same-head retry, an already-open PR
that predates automatic triggering, or explicit `--full` confidence:

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

Use `--full` only when the responsible agent wants repository-wide confidence.
Standard requests remain intentionally lightweight; full requests may be slow
and must not become the default for ordinary pull requests. Standard and full
requests use distinct labels but publish the same required status:

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

The evidence engine retains exact-fingerprint reuse support for affected
workspace checks and integration checks selected by an older or specialized
plan. Standard Final Candidate no longer selects those broad lanes, and full
confidence intentionally runs its full repository gate. Trusted control still
rechecks current candidate identity. Database, release-ready, signing, deploy,
health, and smoke evidence is never reused. Reuse is compute optimization, not
merge advice, approval, or a manual bypass.

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
