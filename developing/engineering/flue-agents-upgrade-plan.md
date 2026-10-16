# Flue and Cloudflare Agents upgrade

## Agent Context

- Purpose: Define the evidence needed to upgrade the hosted runtime without
  losing accepted work, replaying completed tools, or weakening privacy.
- Read this when: Updating Flue, its Pi dependencies, or Cloudflare Agents.
- Update this when: The candidate versions, patch audit, or migration evidence change.
- Do not use this for: Production release authorization or a claim that the
  proposed versions have passed acceptance.
- Source of truth: This plan owns the pending upgrade decision. Runtime behavior
  remains owned by [Remote Agent Runtime](../product/remote-agent-runtime.md).

Status: DRAFT — Agents and Flue candidates implemented; local migration and rollback validated. No merge or deployment.
Remove this plan when the upgrade ships or is abandoned; retain settled contracts
in the existing remote-agent owner document.

## Baseline and candidate

Research started on 2026-10-16 from public `origin/main`
`e9aebdf39f4f723bc2b9cccbc1c6a2ba44a0a5af`, including PR #203.
The initial research commit changed no dependencies. The first implementation
batch upgraded direct Agents and its required MCP peers. The second batch
upgrades Flue and Pi with the migration evidence recorded below. No production changes.

| Dependency | Current | Candidate | Coupling |
| --- | --- | --- | --- |
| `@flue/runtime`, `@flue/cli`, `@flue/vite` | 2.2.2 | 2.3.0 | Upgrade together; retain required runtime patch behavior. |
| Direct `agents` | 0.22.0 | 0.28.1 | Browser tools, types, and test consumers. |
| Agents resolved by `@flue/vite` | 0.20.1 | Still constrained to `^0.20.1` | Neither Flue 2.3.0 nor a direct Agents bump removes this separate resolution. |
| Direct `@earendil-works/pi-ai` | 0.87.1 | 1.3.0 | Flue 2.3.0 requires Pi AI and agent-core `^1.1.0`; registry latest was 1.3.0 at inspection. |

Recheck the registry before changing versions. `flue` is an unrelated npm
package; the relevant packages are scoped under `@flue`.
Do not force Agents 0.28.1 into Flue's `^0.20.1` range with an override merely
to deduplicate. Inspect the generated Worker and resolver ownership before
claiming that the Center Agent's base runtime has changed.

## Findings established so far

1. The initial runtime patch was 2,024 lines across 13 distributed files.
   Chunk filenames change between releases. A fresh 2.3.0 tarball dry-run with
   the previously mapped chunk names initially failed in
   `conversation-stream-store-CXrgv-b0.mjs` and `internal.d.mts`.
   This is a patch application result, not a semantic compatibility result.
2. At the start, `flue-version-continuity.test.ts` loaded only an actual patched 2.0.3
   fixture. Keep that historical regression test, but it does not establish
   migration from the current patched 2.2.2 runtime. Use the existing
   `scripts/capture-flue-upgrade-fixture.mjs` as the starting point for current
   synthetic fixture capture, not production database exports.
3. The direct Agents runtime consumer includes `createBrowserTools` from
   `agents/browser/ai` in `flue-adapter/computer-workspace.ts`. Browser API and
   real Browser Run behavior need validation; schedule typechecking alone is
   insufficient. Agents 0.28 introduces new browser/lifecycle surfaces. Do not
   adopt them unless they replace a concrete current obligation.
4. Agents 0.28.1 declares MCP SDK 1.32.1 and MCP client/server 2.3.1 peers.
   Inspect the resolved peer graph and our actual imports before deciding
   which related packages must move. Pi 1.x also affects our model adapters,
   provider error handling, retries, and existing test providers.
5. A matching table definition or format version does not prove that queued
   work, active tools, or a rollback remains safe.

## Implementation order in this Draft PR

### 1. Capture the current behavior

- [x] Generate synthetic queued, running, and terminal fixtures using the
  current patched 2.2.2 runtime. Record runtime version and patch hash.
- [x] Include a completed tool with an observable execution count, pending
  delivery, and interrupted execution. Use the real runtime to create state.
- [x] Record the existing focused test baseline before changing dependencies.

### 2. Port Flue and Pi as one change

- [x] Audit each patch responsibility against upstream: abort/steering,
  settlement/recovery, terminal usage, retry, working context, and read-only
  submission projection. Delete a patch only when upstream behavior satisfies
  the same contract, with regression evidence.
- [x] Resolve the two patch conflicts, align Pi, and regenerate the patch and
  lockfile from the selected packages. Review provider privacy guards.
- [x] Check fresh and existing conversations, model switching, stream errors,
  cancellation, and failed preparation through the actual adapter boundaries.

### 3. Upgrade the direct Agents consumer

- [x] Inspect old and new browser APIs and resolved peers. Keep Flue's separate
  Agents resolution explicit unless upstream supports a different version.
- [x] Validate Browser Run session creation, tool execution, cleanup, and error
  handling; verify callbacks/schedules where our code uses those contracts.
- [x] Compare built Worker dependencies and bundle size. Do not count unused
  upstream features as a benefit to OpenMeld.

### 4. Prove upgrade and recovery before Ready

- [x] Load the patched 2.2.2 fixtures into the candidate and confirm completed
  tools are not replayed, queued work is not lost, and interrupted work has a
  correct terminal or resumable result.
- [x] Test downgrade against candidate-written synthetic state. If unsupported,
  document a concrete drain/restore rollout instead of promising rollback.
- [x] Run focused Node and workerd suites, Remote Agent typecheck and build,
  then a real isolated hosted-Agent path with visible result delivery.
- [ ] Complete independent review and current-base Final Candidate only after
  implementation is stable. Keep this PR Draft until these gaps are closed.

No merge, deployment, or production data migration is authorized. Better Auth
and TypeScript are out of scope.

## Evidence and official references

Local inspection used package manifests, `pnpm-lock.yaml`, the installed patch,
the continuity test and fixture generator, and a fresh npm tarball patch check.
The patch check failed as described above; no upgrade tests are claimed passed.

- [Flue upstream](https://github.com/withastro/flue)
- [Flue runtime package](https://www.npmjs.com/package/@flue/runtime)
- [Flue Vite package](https://www.npmjs.com/package/@flue/vite)
- [Agents 0.28.1 release](https://github.com/cloudflare/agents/releases/tag/agents%400.28.1)
- [Agents 0.28.0 release](https://github.com/cloudflare/agents/releases/tag/agents%400.28.0)


## First batch: direct Agents acceptance

The two independent local Grok 4.7 xhigh planning reviews agreed that direct
Agents is the smaller first batch. The browser factory still accepts the same
production options, so no application code change was needed.

- Direct `agents`: 0.22.0 to 0.28.1.
- Direct MCP client/server: 2.3.1; SDK: 1.32.1. These satisfy the new Agents
  required peers. A scoped package extension supplies Flue Vite 2.2.2 with its
  old MCP client/server 2.0.0 and SDK 1.30.0. Installed module resolution confirms
  the two Agents instances receive their respective versions. Reassess this
  extension when Flue's Agents dependency changes; do not widen its range.
- Main Worker bundle gzip grew from 2,292.89 kB to 2,486.72 kB in matched
  local builds (about 194 kB, 8.5%). This is a measured cost of retaining the
  two compatible MCP dependency contexts, not a performance improvement.
- The optional Agents Pi 1.x adapter is not used by this browser integration.
  Pi remains 0.87.1 for Flue. Its optional peer warning is disclosed, not hidden.
- Frozen install, 14-task typecheck graph and Remote Agent build passed.
  The final peer graph passed 48 tests covering Computer tool contracts,
  preview, actual callback alarms, Flue entrypoints and legacy continuity.
- Local workerd: six checks passed and three Computer command checks failed.
  The same three failures reproduce with pre-upgrade dependencies. They are
  baseline failures, not passing checks or suppressed assertions.
- A disposable local Worker used the same browser factory options as
  `AgentComputer`, with the real development Browser binding. Old and new
  Agents both created a browser target and evaluated `21 * 2` to `42`.
  The upgraded one-shot path also issued session DELETE after successful
  execution and after an intentional execution error. This tests the SDK
  execution seam, not the full signed-in Space-to-Computer authorization path.

Required MCP peers are resolved without warning suppression. Existing workspace
peer warnings outside this integration are not a claim of full dependency
compatibility. This PR remains Draft; no release is implied.

## Flue preparation after the Agents batch

A local adaptation of the existing fixture generator ran against patched
2.2.2 and captured ten real synthetic runtime tables, fifteen submissions, and
one executed lookup. Its guard confirmed simultaneous running and queued
submissions. No production data was used. The second batch below loads this fixture under 2.3.0 and verifies rollback.
The original 2.0.3 fixture remains intact; the 2.2.2 snapshot and capture
instructions are checked in alongside it.

## Second batch: Flue 2.3.0 and Pi 1.3.0

All three Flue packages move together. Direct Pi AI and Flue's Pi agent-core
resolve to 1.3.0. The Flue Vite package extension moves to 2.3.0 and keeps its
internal Agents 0.20.1 MCP peers separate from direct Agents 0.28.1.

The runtime patch changes from 2,024 to 2,010 lines, still across 13 files.
Chunk names are remapped. The only behavior removed from the patch is the
pre-finish-hook rerender, now present natively in 2.3.0. The rejected type-export
hunk was a changed neighboring import; `AgentSubmissionProjection` remains
exported. Abort, exact-submission steering, read-only projection, preparation
recovery, settlement, usage, stream retry and working-context patches remain.
No application runtime source or durable class migration is changed.

### Evidence on 2026-10-16

- Before upgrade, patched 2.2.2 recovered both the old 2.0.3 fixture and the new
  actual 2.2.2 fixture. The latter has one completed tool, thirteen completed
  requests, one running request, one queued request and a format-3 checkpoint.
- Patched 2.3.0 recovered both fixtures. The cross-process verifier then ran
  **2.2.2 state -> 2.3.0 writes and interrupted work -> 2.2.2 recovery**. It read
  results from both versions, recovered pending requests once, and continued
  the same conversation without the original tool. Each process loads its own
  runtime's Pi dependency. Both persisted-store markers remain 1 and fold
  checkpoint markers remain 3; behavioral replay, not just markers, is tested.
- Focused Node suites: 53 runtime/recovery tests, 38 Cloudflare dispatch/model
  continuity/usage tests, 162 provider/privacy/context tests, and 13 checkpoint/retained-context recovery tests, 2 interactive finish-hook tests, and 9 catalog/steering tests passed (277 total).
  The catalog loop ran with disposable PostgreSQL and verified revoked authority
  is rejected; the first direct invocation correctly refused to use an unisolated database.
- Related typecheck graph: 28 tasks passed. Remote Agent build passed.
- Three actual built-worker local smoke tests passed: Core-to-Remote capability
  negotiation, native Computer file/isolate RPC, and ACK flow control.
- Full workerd suite: 26 passed, 5 failed. Three Computer launch/Stop failures
  were already reproduced on the old graph during the Agents batch. The two
  execution-metadata destination-guard failures were also reproduced on the
  old 2.2.2 dependency worktree. No assertions or destination guards relaxed.
- Main Worker gzip: 2,474.07 kB, versus 2,486.72 kB after the Agents-only batch.

These checks use disposable local state and synthetic providers. They do not
certify a hosted rollout or live provider credentials. A production release
must still use the normal candidate and rollout checks. Keep this PR Draft;
merging and deployment are not authorized in this task.

Two local Grok 4.7 xhigh reviewers completed independent patch/migration
reviews and reported no blocking findings. The primary agent separately
reviewed the patch delta, baseline failures and actual replay evidence.
Hosted rollout remains outside this local acceptance scope.
