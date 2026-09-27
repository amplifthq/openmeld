# Windows startup observation timing

## Native evidence

The 0.3.227 Windows preview was built from
`5816ed7f1ca9554e63dfe3c0c85ff5fef8acd759`. The observed public Web connection
failed on September 27, 2026. Times below use UTC+08.

The Windows task `01a0d946-0580-7bb1-8082-6747eb6f15d6` ran one newly generated
setup command after two independent observers had acknowledged readiness and
written their first samples. It did not reset state, run repair, disable
security controls, or test Desktop.

| Time | Observation |
| --- | --- |
| 22:29:48 | Terminal connected to Web. |
| 22:33:42.788 | Service PID 18612 started through Task Scheduler. |
| 22:34:10.853–10.877 | Runtime lease still absent. |
| 22:34:12.368–12.451 | Lease present for PID 18612, managed by `windows-service`, `updatedAt=14:34:12.108Z`, heartbeat null. |
| 22:34:13.977–14.375 | Execution Host PID 24392 observed, parent PID 18612. |
| 22:34:19.929–19.966 | Same lease, still no heartbeat. |
| 22:34:21.411 | `wait_running` failed after 38,452 ms. |
| 22:34:21.431–21.534 | Lease heartbeat first observed, `heartbeatAt=14:34:19.044Z`. |

The timeout reported `runtime=running, reason=unknown, managerRunning=true`
together with `runtime_stale,manager_running_without_runtime,multiple_active_owners`.
Process samples around the failure contained one `service run` and its
`service execution-host` child. They do not support sustained duplicate Services;
the 2–4 second process sampling interval cannot exclude a shorter transient.

The initial lease was fresh even without a heartbeat: the existing reader uses
`updatedAt` until the first heartbeat, with a three-minute freshness threshold.
Therefore null heartbeat alone cannot explain this failure. The observer does
not prove which lease version the startup evaluator read.

The contract had already advanced from 0.3.226 to 0.3.227 before this start.
After failure its desired state became stopped; no old-version rollback was
observed. After the operator-owned setup was interrupted, Service and Host
remained alive, and the product status command reported running with no anomalies.
Web still reported incomplete setup. Local health is not completed connection.

Original evidence remains in the Windows task workspace:
`C:/Users/camil/Documents/Codex/2026-09-25/windows-openmeld-openmeld-windows-web-computer/`:

- `openmeld-0.3.227-observed-connection-report-2026-09-27.md`
- `openmeld-observation-20260927-222628.fast.jsonl`
- `openmeld-observation-20260927-222628.slow.jsonl`
- `wait-running-window-redacted.json`

This tracked report preserves the necessary evidence if the workstation files
are unavailable. No credentials or complete process command lines are included.

## Reproduced defect and correction

On base `08554ade8`, inventory reads the lease before awaiting process enumeration,
bundle integrity hashing and OS manager queries. A Service that publishes its
lease during those operations is still classified using the earlier missing
lease. On timeout, a separate newer runtime read is combined with the older
inventory's anomalies. These are two observations, not a coherent verdict.

A deterministic isolated integration test changes the real lease file while the
manager query is in flight. Before the correction, both transitions fail:
an arriving lease is classified stale, and a removed lease is classified running.
No sleeps, public servers, system registration or real user state are needed.

Inventory now rereads the lease after the expensive observations before deriving
runtime, ownership and anomalies. The first read only selects the controller.
Timeout reporting uses the inventory that actually failed readiness, removes
two redundant late queries, and records only safe PID/ownership and lease
freshness fields. It does not serialize process arguments.

This is an observation-order correction, not an atomic OS snapshot guarantee.
Existing startup budgets, bundle integrity, owner separation, runtime contract
checks and readiness predicates are unchanged. Real duplicate owners remain
blocking. This correction matches the observed failure mechanism, but a passing
real Windows Web setup is still required to prove the complete user outcome.

## Contract and release impact

The change affects local CLI/Service lifecycle observation and error evidence.
It introduces no persisted or wire schema, account migration, runtime epoch,
permission change, or cloud dependency. Old and new Core/Gateway/Web can continue
setup, Wake, Space actions and diagnostics with either local version. Existing
healthy Services remain supported; this is an available local-component update,
not a required compatibility-floor change. Release stamping is deferred.

The change complies with the local Service owner document: full inventory still
owns local lifecycle checks, and local health is never promoted into Core-owned
Wakeability or Web setup completion.

## Local validation

- Inventory arrival/removal regressions: both failed before the correction;
  the full inventory suite now passes (27 tests).
- Lifecycle alignment integration: 16 tests pass, including real bundle drift
  rejection. Owner classification and startup failure diagnostics: 25 tests pass.
- CLI type checking passes after rebuilding current-main workspace dependencies.
- Deferred release-ready verification passes against base `08554ade8`; it
  rebuilds the packaged CLI and leaves release metadata unchanged.
- One additional binary-bundle staging test fails with `binary manifest is
  missing a verified signing identity`. The same test fails unchanged in the
  released `5816ed7f1ca9554e63dfe3c0c85ff5fef8acd759` checkout. It does not reach
  the modified inventory code. This existing signing-fixture failure is not
  hidden, relaxed, or treated as passing.

Native candidate verification and a new published-version Windows Web connection
remain separate acceptance steps. No production success is claimed here.
