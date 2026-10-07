# Windows Native CI Evidence

## Agent Context

- Purpose: Preserve the bounded setup-test repair and task-host investigation evidence.
- Read this when: Reviewing the native setup budget or deciding whether the task host needs a product fix.
- Update this when: This scoped Windows run is assessed or the remaining task-host question is closed.
- Do not use this for: Product release approval, real-user smoke, or permission to rerun CI.
- Source of truth: The exact commits, run attempt, fixture artifacts, and limitations below.

Status: B validated; A evidence attempt failed before fixture execution. Draft delivery only.

Remove when the setup-test change ships and the task-host investigation is closed;
git history and the associated PR retain this evidence.

## Scope and source identity

- Baseline main: `cbfcf35a2f077651a3c60fe51b57449ca4d7e5c3`.
- Refreshed main: `839cc89c80346767e78f6f8c821b2e1913c4b0e7`. Its intervening changes do not change either relevant test/product source, the Windows workflow, lockfile, or Node version file.
- Formal B commit: `293744d0fad8e3c01d9c8549de7f8b95ccb9c6dd`, branch `codex/windows-native-test-budget`.
- Temporary A diagnostic commit: `d63a0a4801fa137c8bff0b30ba216f7431ec1cae`, branch `codex/windows-task-host-evidence`. It descends from the exact B commit. Its observer, fixture driver, and manual workflow changes are excluded from the formal PR.
- [Controlled Windows run 35752998509](https://github.com/amplifthq/openmeld/actions/runs/35752998509), attempt **1**, manual dispatch of that diagnostic commit. Exactly one manual task was dispatched; no rerun or cancellation was requested.
- The manual evidence job excludes system-task migration, Service operations, production credentials, and real-user smoke. PR #1206 and #1232 branches were not changed.

## B: functional budget

The ten existing tests in `clients/web/src/lib/setup-bootstrap-script.windows.test.ts`
validate setup behavior through real Windows PowerShell 5.1 and disposable command
fixtures. They are functional checks, not a five-second startup performance promise.
The previous inherited 5,000 ms Vitest budget covered fixture preparation, the
blocking child invocation, result reading, cleanup, and assertions, although the
child already had a 30,000 ms deadline. The historical 12,996 ms failure was a
whole-test duration, not a measured PowerShell startup duration.

The formal change sets only this suite to 40,000 ms, retaining the child's
30,000 ms limit and every original exit-code, error-description, argument, stderr,
and command-call assertion. It adds preparation/process/read/cleanup timing output;
the process phase includes the entire child invocation, not just process creation.
No global test timeout, retry, product installer, or product timeout changes.
A child reaching its existing deadline still produces an error and fails the test;
the larger outer budget does not turn that error into success. The synchronous
call still relies on its process deadline while JavaScript is blocked.

Native result: **10/10 passed** in the controlled run. The catalog failure case
took **6,743 ms** by Vitest and preserved all its functional assertions, including
exit 7. Its helper timing was:

| Phase | Milliseconds |
| --- | ---: |
| Prepare | 2.747 |
| Entire child invocation | 6,735.301 |
| Read recorded calls | 0.394 |
| Cleanup | 0.951 |
| Helper total | 6,739.423 |

The other nine cases took 359-571 ms each. The first case would exceed the former
5,000 ms budget even though its assertions passed. This supports the local
functional-budget correction; it does not isolate PowerShell startup from script
execution or explain the historical 12,996 ms run.

Checkout logging and `source.json` both identify the diagnostic SHA above. The
runner image was `windows-2025-vs2026 / 20260907.229.1`, Node `24.14.0`, and Vitest
`3.2.4`. The observer recorded Windows PowerShell `5.1.26100.33296`, CLR
`4.0.30319.42000`, and mscorlib `4.8.9337.0` on the same runner.

## A: unchanged implementation, external observation

The temporary fixture imports and compiles the unmodified task-host source and
uses the existing PowerShell action generator and original Node stdout/stderr,
environment, argument, and exit-code payload. Each spawn keeps its 30,000 ms
deadline. The bound is three exit 0/7 pairs, with no next pair after an error.

An independent Windows PowerShell process starts WMI process start/stop tracing
before each host launch. Only the fixture host's descendants are retained. It
records log-size changes and copies fixture logs. At approximately 23 seconds it
attempts thread wait-state snapshots and serialized thread/handle/private writable
memory minidumps of still-running, verified fixture process generations. Installed
CDB is used offline if present, with a 15-second bound per dump; no debugger is
installed. Evidence is saved before cleanup. Cleanup uses verified PID/start-time
pairs from this fixture tree, never process-name termination.

There are no product stage markers or changes to log copying. WMI observation,
periodic log reads, a clean fixture environment, and a fresh host per case can
affect timing; passing under observation would not prove the historical failure
fixed. Presence of both payloads in a log alone does not prove both asynchronous
copy operations have finished.

**No valid A reproduction result was obtained.** The first case failed at
`Observer not ready` before the call to `spawnSync(host, ...)`. The observer did
not become ready within the diagnostic driver's 20-second preparation window.
The whole diagnostic test took 63,544 ms, including host compilation, readiness
waiting, and cleanup; there is no phase measurement attributing all of that time
to observer startup or WMI initialization.

The artifact contains the eventual observer runtime record (observer PID `3996`,
test-worker PID `1820`) and its ready file, but empty process-event, capture-error,
and cleanup lists. There is no fixture outcome, task-host/child PID history,
fixture output, thread snapshot, or dump. The observer subsequently exited and
fixture-directory cleanup completed; runner teardown lists no terminated orphan.
Neither exit 0 nor exit 7 was actually launched. This is a diagnostic-harness
failure, **not** a reproduced task-host timeout and **not** evidence that the task
host passed. No second dispatch was made.

Consequently this run neither confirms nor excludes the proposed .NET log-lock
cycle, slow startup, output-drain waiting, or another product wait. It does not
establish whether A and B share a runner-level cause, and supplies no basis for a
product fix. Keep the task-host/log-copy implementation and its 30-second test
deadline unchanged. If further A evidence is authorized separately, first make
the external observer's readiness observable on Windows before launching a
fixture; do not interpret a wider diagnostic setup allowance as an A timeout fix.

## Local validation and delivery boundary

- `pnpm install --frozen-lockfile` completed in the isolated checkout.
- Existing Web tests: **39 passed**, native Windows tests **10 skipped** on macOS.
- The one-off native evidence test was collected successfully and skipped on macOS.
- Biome, `git diff --check`, YAML syntax validation, normal commit hooks, and normal pre-push checks passed for the code commits. The push checks included the selected dependency builds and related tests; macOS skips are not native acceptance.
- The formal PR contains the localized test change and this sanitized report only. No product behavior or architecture-owner rule changes; no product changelog is needed for this test-only repair.
- No merge, deployment, publication, production-state operation, or real-user product smoke was performed.

Raw evidence: [artifact 10706757509](https://github.com/amplifthq/openmeld/actions/runs/35752998509/artifacts/10706757509),
including `b-tests.log`, `a-tests.log`, `source.json`, and the first observer's
runtime/empty event records. It expires on **2026-12-21**. The identifying
measurements and limitations above remain in git and the PR after expiration.
The overall manual run is **failed because the A observer preparation failed**;
its B native-test step passed. Do not summarize this as an entirely green run.
