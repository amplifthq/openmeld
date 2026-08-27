# Agent-Native Delivery

## Agent Context

- Purpose: Define the single delivery contract for autonomous coding agents,
  from iterative development through final-candidate validation, merge,
  production release, health, real-user smoke, evidence, and recovery.
- Read this when: You are developing, opening or reviewing a pull request,
  deciding whether a candidate is mergeable, using the no-Actions fallback,
  releasing production, or handing delivery evidence to another agent.
- Update this when: Candidate identity, validation policy, GitHub status
  publication, merge protection, release concurrency, release lanes, health,
  smoke, evidence validity, or recovery behavior changes.
- Do not use this for: Product semantics, component-specific deployment
  commands, architecture ownership, test implementation details, or raw run
  logs. Follow the scoped owner links in this document for those details.
- Source of truth: This file owns the end-to-end agent-native delivery contract
  for this repository.

## Outcome

Every coding agent is an engineering owner inside its declared scope. It can
independently complete this lifecycle without a central coordinator or a human
code-reading gate:

```text
develop locally
  -> inspect the exact candidate plan
  -> run one explicit Final Candidate gate
  -> inspect code and evidence as the task requires
  -> evaluate merge readiness
  -> merge the still-current candidate
  -> release only affected production scopes
  -> component health
  -> smallest real-user smoke for the changed path
  -> report each fact separately
```

GitHub is shared infrastructure for immutable identity, cross-machine evidence,
conflict detection, merge protection, credentials, release logs, and
per-component serialization. It is not a reason to run paid compute after every
development push, and Actions quota is not delivery authority.

## Non-Negotiable Invariants

1. Ordinary branch pushes do not run remote CI and do not repeat broad local
   validation. Agents may push intermediate commits freely.
2. A Final Candidate is explicit. Request it only after the agent believes one
   committed PR head is ready for final merge evaluation.
3. Candidate evidence identifies one exact `head SHA + base SHA + tree SHA`.
   Any change to one of those facts invalidates the evidence.
4. Current `main` must equal the recorded base and must be an ancestor of the
   candidate head both before and after validation. A green run does not survive
   base drift.
5. A real selected-check failure blocks that candidate. The runner stops, records
   the failed command, and publishes failure. It never converts uncertainty,
   missing evidence, or unavailable GitHub state into green.
6. Unit tests stay in the normal executable-code path because they have
   independent defect-finding value. Integration, database, contract, and
   local-component checks are selected when the changed boundary makes them
   relevant. Signing, notarization, migrations, release readiness, component
   health, and real-user smoke remain release protections.
7. Merge, release, health, and smoke are separate facts. A successful candidate
   is not a merge. A merge is not a release. A deployment log is not health. A
   health response is not real-user smoke.
8. Production releases use one immutable first-parent `main` SHA. Never release
   a PR side-branch head or silently switch to a newer `main` during a run.
9. Same-scope production releases serialize and never cancel a running deploy.
   Contract-compatible scopes may run in parallel.
10. There is no self-hosted runner requirement and no low hard budget that may
    block delivery. Billing alerts and usage reports are informational.

## Candidate Identity And Evidence

The Final Candidate engine prints and records:

- repository and PR number;
- exact head, base, and tree SHAs;
- branch and changed paths;
- confidence level and risk tags;
- every selected check, reason, and exact command;
- every skipped check and reason;
- command duration and pass/fail result;
- complete redacted stdout/stderr in separate per-check command logs;
- a bounded, redacted stdout/stderr tail and the original spawn error for a
  failed command;
- execution mode (`remote` or `local`);
- candidate conclusion, error context, and any status/comment publication
  failure as separate facts.

`packages/schemas/src/schemas/ci/final-candidate.ts` is the canonical Zod v4
contract for JSON evidence and the GitHub PR facts it consumes. Producers,
artifact consumers, local comments, and the hosted publisher runtime-parse that
contract. Reuse is allowed only when candidate validation succeeded,
publication has no recorded failure, and all three identity fields still match.
Evidence is invalid for another SHA, another base, another tree, an unresolved
candidate, a dirty worktree, or incomplete shared publication.

The shared required status context is:

```text
OpenMeld Final Candidate
```

The hosted workflow and guarded local fallback both publish this context. The
status is a compact merge fact; the workflow summary, artifact, or local PR
comment carries the inspectable evidence.

Normal terminal output stays compact: the exact plan, current check, result,
duration, bounded failure tails, evidence path, and command-log location. It
does not replay successful command output into an agent's context. Hosted runs
upload the complete redacted per-check logs with the canonical evidence; local
runs store them beside the evidence file.

## Development And Planning

Use focused tests while developing. Choose them as an engineer based on the
behavior being changed; do not wait for GitHub to tell you what to run.
The responsible agent decides how to structure its local development loop,
focused tests, self-review, and any external review the task calls for. CI/CD
does not prescribe those development choices; Final Candidate states only the
technical facts required for one exact merge candidate.

Inspect the candidate policy at any time:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan
```

The first shell program comes from the cached trusted `origin/main` Git object;
it fetches live `main` before loading a detached current-main bootstrap and
control copy. No candidate-owned package script or bootstrap runs before that
boundary. The fetch names the clean HTTPS or explicit local origin directly,
removes inherited Git trace and curl diagnostics, and forces credential
redaction before Git can use the workstation credential helper. Planning is
read-only.
It shows uncommitted paths and the commands a committed candidate would select.
Run any listed lower-level command directly when a failure needs isolation. Add
`--full` when the risk or uncertainty justifies repository-wide checks, unit
tests, and integration tests.

Before requesting a candidate:

1. finish the scoped implementation and behavior tests;
2. commit the exact tree and push it;
3. fetch current `origin/main`;
4. merge or rebase current `main` into the branch so that exact base is an
   ancestor of the candidate head;
5. resolve conflicts and rerun focused local checks;
6. ensure the worktree is clean and the PR is open, non-draft, and targets
   `main`.

## Development Infrastructure Feedback

OpenMeld maintains one organization-wide, non-interactive feedback Space for
CI/CD, release tooling, OpenCode Worker collaboration, and reusable multi-agent
development infrastructure:

```text
OpenMeld CI/CD & Agent Workflow Feedback
https://openmeld.ai/o/amplift/spaces/fd628798c701754227a1ffcbf273e62dbaa5daa98f61b1804425b49057967fb6
```

This Space is a lightweight dropbox, not a work handoff or support chat. Local
Agents should prefer the public CLI and may use an authorized owner Human
Profile. A direct Space message does not require OpenMeld Service, a Wake, or a
new Agent Profile membership. Do not run `space add-me` only to submit feedback.
The Center Agent may record the same concise infrastructure observations when
it encounters them.

```sh
openmeld space send \
  fd628798c701754227a1ffcbf273e62dbaa5daa98f61b1804425b49057967fb6 \
  --profile <authorized-human-profile-id> \
  --stdin
```

Start each report with one primary label:

- `[bug]`: infrastructure behavior is incorrect or broken;
- `[friction]`: the flow works but is slow, wasteful, confusing, or unpleasant;
- `[gap]`: a common development situation is unsupported;
- `[feature]`: one concrete improvement would help many Agents;
- `[shared-pattern]`: a proven reusable method should become shared
  infrastructure.

Then keep the report short and factual:

```text
[label]
Agent: <Codex, OpenCode, Center Agent, or another agent>
Model: <exact model when known>
Session: <provider session ID when available>
Context: <what the Agent was trying to do>
Feedback: <what happened, in plain language>
Impact: <time, cost, confidence, reliability, or concurrency impact>
Evidence: <exact error, command, duration, PR, or screenshot when useful>
Suggested change: <optional>
```

Report general infrastructure opportunities, not task-specific preferences.
Search recent messages before repeating an issue. Never include credentials,
secrets, private transcripts, or unrelated user data.

## Normal Remote Final Candidate

The normal cross-machine path is one explicit GitHub-hosted request:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- request --pr <number>
```

The trusted command first validates the local head against the live PR and current
`main`, then prints the authoritative hosted plan from that exact trusted base
with execution mode `remote`. It resets the two candidate request labels and
adds `final-candidate`. Add `--full` to the command to request
`final-candidate-full`. The label is the immutable confidence input: the hosted
runner executes standard for the first label and full for the second, so a plan
cannot promise full while the workflow runs standard.

The workflow:

- uses `pull_request_target` only to load the workflow and publisher code from
  trusted current `main`; the candidate job still receives read-only
  permissions, no secrets, and checks out the exact untrusted head explicitly;
- does not run on PR open, reopen, synchronize, ready-for-review, or ordinary
  push events;
- gives unrelated or draft label events unique ignored concurrency groups, so
  they publish no Final Candidate status and cannot cancel a legitimate
  standard or full request for the same pull request;
- checks out trusted control and the exact PR head into separate roots with
  checkout credentials disabled on an ephemeral GitHub-hosted runner;
- installs candidate dependencies with lifecycle scripts and candidate-owned
  pnpm hooks disabled, then rebuilds only dependency packages approved by the
  trusted current-main `allowBuilds` policy. Candidate root lifecycle scripts
  remain disabled, while required native packages still build with dedicated
  home, cache, store, modules, and virtual-store paths;
- runs selected candidate commands through a clean environment that omits
  GitHub credentials and Actions command-file variables;
- separates the read-only candidate runner from small pending/final publisher
  jobs;
- calls the same candidate engine as the local fallback;
- validates live PR head, live PR base, current remote `main`, ancestry, and
  worktree cleanliness before and after checks;
- publishes `OpenMeld Final Candidate` on the exact head;
- preserves the JSON evidence, complete redacted command logs, and a readable
  job summary in one artifact.

The runner job has read-only repository and PR permissions. Its selected check
subprocesses receive no `GH_TOKEN`, `GITHUB_TOKEN`, or status-write credential.
Only publisher jobs receive `statuses: write`; before publishing they re-read
the live PR, current `main`, exact tree, GitHub-owned candidate job result,
confidence, and schema-validated evidence. A candidate-produced artifact cannot
turn a failed, canceled, or skipped GitHub job green. The final publisher
executes only the publisher and schema implementation from the exact
already-trusted current base SHA, never code from the candidate head. GitHub
event strings enter shell steps through
quoted environment variables, never direct expression interpolation. If the
pending job, publisher checkout, setup, install, artifact download, or validator
fails after pending publication, a checkout-independent fail-safe finalizer
publishes failure for the same exact head instead of leaving a permanent
pending status.

A later push has a different head SHA and therefore has no valid status. A later
`main` commit makes the branch out of date; sync it and request a new candidate.

## Actions-Unavailable Local Fallback

Actions quota, runner outage, or a repository billing block must not prevent
validation, merge, or release. Run the same engine locally:

```sh
git show origin/main:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- local --pr <number>
```

This is a fallback only. When GitHub Actions is available, use the normal
hosted request so shared CI compute carries the final gate instead of competing
with concurrent coding agents for workstation CPU, memory, and disk.

This is not a manual claim of success. The command fetches live `main`, reads the
live PR, creates a detached control worktree from current `main`, and runs that
trusted control against the candidate worktree. It enforces the same exact
identity and cleanliness rules, runs the same risk-selected commands, checks
live state again, writes local JSON evidence, posts a readable PR evidence
comment, and publishes the same commit status. The success status is the final
fallible publication, so an evidence-comment failure cannot leave a false green.

The local lane requires an authenticated `gh` session with permission to read
the PR, post its evidence comment, and create a commit status. Missing access or
network evidence fails closed. No GitHub Actions runner is used.

A pull request that changes the Final Candidate control plane cannot silently
certify itself with candidate-owned policy. Current-main control rejects that
drift. When current `main` does not yet contain the control plane, or an
intentional control-plane change itself must be validated, use the explicit,
local-only bootstrap after inspecting the exact control diff:

```sh
git show <reviewed-control-sha>:scripts/ci/trusted-final-candidate.sh | \
  bash -s -- local --pr <number> \
  --bootstrap-control-sha <exact-candidate-head> \
  --bootstrap-reason "<why current-main control cannot own this run>"
```

Bootstrap requires the exact candidate head, records `explicit-bootstrap` and
the reason in canonical evidence, and cannot request a hosted run. This is a
visible trust escalation for the responsible agent or user to evaluate; it does
not require another agent, reviewer identity, approval count, or hidden process.

## Review Support And Merge

Final Candidate evidence supports review without prescribing who performs it.
The responsible agent may use it for self-review, the user may request a
separate coding agent, or another authorized review process may consume it.
CI/CD requires no additional reviewer, reviewer identity, reviewer count, or
approval record. As the task requires, merge evaluation can inspect:

- the diff and affected owner documents;
- architectural and contract risk;
- selected and skipped validation with reasons;
- failed or unavailable evidence;
- whether `main` or the PR head changed after validation;
- required release scopes and post-release smoke.

Any authorized reviewer may run focused commands, the trusted plan command,
`--full`, or Deep Confidence. A status description without its underlying
evidence does not prove merge readiness.

Repository protection for `main` must require:

- changes through a pull request;
- the `OpenMeld Final Candidate` status;
- the branch to be up to date with `main` before merge;
- no human approval count.

Do not pin the required context to the GitHub Actions app because the guarded
local fallback must be able to satisfy the same status when Actions is
unavailable. Agents with write access are trusted engineering principals; the
exact evidence remains required, while review beyond the responsible agent's
own evaluation is required only when the task explicitly calls for it.

If the repository later enables merge queue, it must first provide an equivalent
Final Candidate check for the exact merge-group SHA. Until then, the up-to-date
branch rule is the base-drift authority; do not enable a queue that waits for a
check this workflow cannot produce.

Immediately before merge, re-read live PR head, base, status, and mergeability.
If the head or base differs from the evidence, stop and create a new candidate.

## Deep Confidence

`.github/workflows/deep-confidence.yml` remains manual. Use it when uncertainty
or blast radius justifies exhaustive diagnostics, including broad Worker or CLI
integration coverage. It is not scheduled, required for ordinary candidates,
or a substitute for the exact Final Candidate status.

Deep Confidence evidence is additive. It never makes a failed or stale Final
Candidate mergeable.

## Production Release

Read `developing/engineering/production-release.md` for scope selection,
component ordering, migrations, CLI publication, credentials, concrete health
commands, and recovery mechanics. This document owns the lifecycle contract:

1. Release only scopes affected by the merged change and its contract rollout.
2. GitHub-hosted scoped release is the normal cross-machine lane because it
   provides centralized credentials, immutable checkout, observable logs, and
   production concurrency locks.
3. `Scoped Production Release` is deploy-only. Plan locally with
   `pnpm run release:plan`; do not pay for a hosted preview that changes nothing.
4. CLI GitHub release is publication-only. Complete candidate and local release
   readiness before dispatch; the publication job still performs its mandatory
   signing, signature verification, notarization, immutable artifact, channel,
   tag, and Core projection gates.
5. Every release uses an explicit 40-character first-parent `main` SHA and an
   explicit selected scope. Later `main` commits belong to another release.
6. Each production component owns a stable concurrency group with `queue: max`
   and `cancel-in-progress: false`, plus the same Git-backed shared scope lease
   used by local fallback. The queue retains up to GitHub's supported maximum
   instead of replacing an earlier waiting release. The atomic remote ref
   records scope, owner, source SHA, start, and expiry. Different component
   groups may proceed in parallel when the release plan proves mixed-version
   compatibility.
7. Never cancel a running production deploy to prefer a newer candidate. A
   not-yet-started same-scope run may be canceled only when evidence proves a
   later queued SHA safely supersedes it, no required intermediate migration or
   receiver-first step is lost, and no immutable publication depends on it.
8. When Actions is unavailable, use the guarded local release lane from a clean,
   dedicated worktree at the approved `main` SHA. The local lane runs the same
   scope planner, preflight, deploy, health, and release evidence boundaries; it
   is a formal fallback, not an emergency bypass. It must acquire the same
   shared scope lease as hosted release before the first production mutation.

The standard hosted Core preflight runs the production CLI channel
compatibility gate from the current-main control checkout, with the exact
release source as its working directory. A missing trusted control path or a
nonzero channel gate result blocks deployment before the Core Worker is built.

## Health And Real-User Smoke

Component automation performs the cheap health check owned by
`production-release.md`. That proves deployment visibility or reachability for
the selected component only.

Release completion evidence includes the smallest user-accessible smoke that
covers the changed path after health passes. Use OpenMeld Web, the published
CLI, installed OpenMeld Service, or another real product entrypoint. Internal
HTTP/RPC calls, database edits, worker inspection, or direct projection changes
are diagnostics, not real-user smoke.

Record separately:

```text
Merged PR and merge SHA
Approved release source SHA
Released scope and workflow or local command
Actual deployed version/SHA evidence per component
Health result per component
Real-user smoke entrypoint, scenario, and visible outcome
Anything not run, with reason
```

Do not collapse those lines into “deployed successfully.”

## Failure And Recovery

- Candidate check failure: keep its command and error, fix the cause, commit a
  new head, sync current `main`, and create a new candidate.
- Candidate state drift: do not reuse green checks. Sync the branch and rerun.
- Actions unavailable: use the trusted current-main local command; do not
  weaken the required status or invent a success comment.
- Hosted release unavailable: use the guarded local lane at the same approved
  `main` SHA. Do not call raw deploy or publish commands.
- Scope lease held: inspect the printed owner, source, start, and expiry. Wait
  while active. After expiry, recover only the exact lease SHA with a recorded
  reason after proving its owner stopped; then rerun the guarded release. A
  stale owner cannot delete a newer lease because acquisition, release, and
  recovery all use Git compare-and-swap.
- Release failure: preserve completed immutable stages, component logs, and the
  original source SHA. Follow the component recovery rules in
  `production-release.md`; never restart with a different commit silently.
- Health failure: the release is not healthy. Diagnose or roll back before
  claiming completion.
- Smoke failure: report the production bug and release facts separately, fix it
  on a new PR, and use the same lifecycle for the hotfix.

## Change Checklist

Any change to this delivery system must update in one PR:

- the candidate policy or release implementation;
- behavior tests that prove triggers, identity, failure, and concurrency;
- GitHub workflow files;
- this owner document;
- router or scoped implementation references that changed.

Never disable an existing gate in one change and add its replacement later.
Delete retired workflow names, actions, scripts, tests, and instructions so
agents cannot discover a second stale delivery system.
