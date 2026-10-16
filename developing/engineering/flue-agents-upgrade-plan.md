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

Status: DRAFT — research and migration preparation only.
Remove this plan when the upgrade ships or is abandoned; retain settled contracts
in the existing remote-agent owner document.

## Baseline and candidate

Research started on 2026-10-16 from public `origin/main`
`e9aebdf39f4f723bc2b9cccbc1c6a2ba44a0a5af`, including PR #203.
No dependency manifest, lockfile, runtime patch, or production state changes in
this initial research commit.

| Dependency | Current | Candidate | Coupling |
| --- | --- | --- | --- |
| `@flue/runtime`, `@flue/cli`, `@flue/vite` | 2.2.2 | 2.3.0 | Upgrade together; retain required runtime patch behavior. |
| Direct `agents` | 0.22.0 | 0.28.1 | Browser tools, types, and test consumers. |
| Agents resolved by `@flue/vite` | 0.20.1 | Still constrained to `^0.20.1` | Neither Flue 2.3.0 nor a direct Agents bump removes this separate resolution. |
| Direct `@earendil-works/pi-ai` | 0.87.1 | Select a compatible stable 1.x candidate | Flue 2.3.0 requires Pi AI and agent-core `^1.1.0`; registry latest was 1.3.0 at inspection. |

Recheck the registry before changing versions. `flue` is an unrelated npm
package; the relevant packages are scoped under `@flue`.
Do not force Agents 0.28.1 into Flue's `^0.20.1` range with an override merely
to deduplicate. Inspect the generated Worker and resolver ownership before
claiming that the Center Agent's base runtime has changed.

## Findings established so far

1. The current runtime patch is 2,024 lines across 13 distributed files.
   Chunk filenames change between releases. A fresh 2.3.0 tarball dry-run with
   the previously mapped chunk names still fails in
   `conversation-stream-store-CXrgv-b0.mjs` and `internal.d.mts`.
   This is a patch application result, not a semantic compatibility result.
2. Existing `flue-version-continuity.test.ts` loads an actual patched 2.0.3
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

- [ ] Generate synthetic queued, running, and terminal fixtures using the
  current patched 2.2.2 runtime. Record runtime version and patch hash.
- [ ] Include a completed tool with an observable execution count, pending
  delivery, and interrupted execution. Use the real runtime to create state.
- [ ] Record the existing focused test baseline before changing dependencies.

### 2. Port Flue and Pi as one change

- [ ] Audit each patch responsibility against upstream: abort/steering,
  settlement/recovery, terminal usage, retry, working context, and read-only
  submission projection. Delete a patch only when upstream behavior satisfies
  the same contract, with regression evidence.
- [ ] Resolve the two patch conflicts, align Pi, and regenerate the patch and
  lockfile from the selected packages. Review provider privacy guards.
- [ ] Check fresh and existing conversations, model switching, stream errors,
  cancellation, and failed preparation through the actual adapter boundaries.

### 3. Upgrade the direct Agents consumer

- [ ] Inspect old and new browser APIs and resolved peers. Keep Flue's separate
  Agents resolution explicit unless upstream supports a different version.
- [ ] Validate Browser Run session creation, tool execution, cleanup, and error
  handling; verify callbacks/schedules where our code uses those contracts.
- [ ] Compare built Worker dependencies and bundle size. Do not count unused
  upstream features as a benefit to OpenMeld.

### 4. Prove upgrade and recovery before Ready

- [ ] Load the patched 2.2.2 fixtures into the candidate and confirm completed
  tools are not replayed, queued work is not lost, and interrupted work has a
  correct terminal or resumable result.
- [ ] Test downgrade against candidate-written synthetic state. If unsupported,
  document a concrete drain/restore rollout instead of promising rollback.
- [ ] Run focused Node and workerd suites, Remote Agent typecheck and build,
  then a real isolated hosted-Agent path with visible result delivery.
- [ ] Complete independent review and current-base Final Candidate only after
  implementation is stable. Keep this PR Draft until these gaps are closed.

No merge, deployment, production data migration, or new runtime behavior is
part of this research-only commit. Better Auth and TypeScript are out of scope.

## Evidence and official references

Local inspection used package manifests, `pnpm-lock.yaml`, the installed patch,
the continuity test and fixture generator, and a fresh npm tarball patch check.
The patch check failed as described above; no upgrade tests are claimed passed.

- [Flue upstream](https://github.com/withastro/flue)
- [Flue runtime package](https://www.npmjs.com/package/@flue/runtime)
- [Flue Vite package](https://www.npmjs.com/package/@flue/vite)
- [Agents 0.28.1 release](https://github.com/cloudflare/agents/releases/tag/agents%400.28.1)
- [Agents 0.28.0 release](https://github.com/cloudflare/agents/releases/tag/agents%400.28.0)
