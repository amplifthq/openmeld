# Windows Service runtime alignment follow-up

## Agent Context

- Purpose: Preserve the Windows 0.3.226 failure evidence and the bounded alignment repair.
- Read this when: Validating PR #1350 or coordinating its real-machine acceptance.
- Update this when: Native validation, publication, or production acceptance changes the evidence.
- Do not use this for: Claiming a healthy production connection from unit tests or CI alone.
- Source of truth: The linked native run, exact source commits, and observed Windows product behavior.

Status: Native validation passed; publication and real-machine acceptance are pending.
Remove this report after production acceptance and remaining limitations are preserved in the PR and stable owner documentation.

## Production evidence

The manually initiated public Windows 0.3.226 setup on September 27 did not
complete. At 16:35:01 Asia/Taipei, lifecycle verification still reported
`multiple_active_owners,runtime_bundle_mismatch`; its update receipt subsequently
entered `needs_help`. By 16:42, setup child processes had exited and the Service
was not running. The manual terminal's final exit code was not captured.

Windows-native observation showed a system-task-started Service and its child
using the same 0.3.226 bundle. Post-exit task, active bundle and contract records
agreed. Those observations do not establish the runtime inventory fields at the
failure instant. An old bundle directory and an exited execution-host owner
record alone do not explain either anomaly.

## Reproduced defects

Two deterministic checks against main `5059f67bcc710c0d6087c615091ccbc4a96bd88e`
failed before the corresponding fixes:

1. Command entry extraction accepts a Service bundle path with forward slashes
   but returns null for the same quoted path with Windows backslashes. A missing
   extracted path triggers `runtime_bundle_mismatch` even if the file exists.
2. A fresh running lease identifies a PID as system-managed, but a direct or
   unknown path classification for that same PID adds a second lifecycle owner.
   The result is a false `multiple_active_owners` classification.

Normalize only path recognition, preserving the original path returned to
filesystem callers. Give the fresh system-managed lease precedence over the
same PID's path heuristic, matching the existing direct-runtime precedence.
A separate direct PID remains a separate owner; no ownership check is disabled.

These are proven code defects consistent with the production symptoms, not proof
that they explain every failure in the recorded attempt. Native artifact and
public-entry smoke remain necessary before claiming Windows connection works.

## Validation and contract impact

The three focused command-path, owner-snapshot and process-inventory suites pass
(50 cases) on macOS after the fixes. This proves deterministic logic only.
The existing Windows compatibility workflow now runs those suites natively too.
The misleading macOS-specific startup progress text is made platform-neutral.

[Windows compatibility run 36308599160, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/36308599160)
passed both native jobs on `6b01bcb7f248b785087d0be12834ce81363343be`.
The run preserves native evidence and unsigned artifacts. The preceding run
36308149951 passed the new regressions but exposed an existing pointer-path
fixture assuming the POSIX executable name; it now selects `openmeld.exe` on
Windows. Its superseded job is not a pass. CLI typecheck and deferred
release-ready verification also passed locally.

No HTTP, WebSocket, schema, persisted-state format, authentication, credential,
or update-channel contract changes. Existing CLI, Service, Core, Gateway and Web
remain wire-compatible. The local-service owner document explicitly preserves
one lifecycle owner for one verified system-managed PID and independent evidence
for other PIDs. This change does not violate that architecture boundary.

Production acceptance remains: one fresh public Web command completes, the
Computer remains connected after the terminal closes, then the downloaded
Desktop reuses that identity. Fresh-machine acceptance is separate from this
previously installed machine's upgrade path. Unsigned-preview policy remains a
separate Windows acceptance constraint.
