# Windows Computer Connection Design

## Agent Context

- Purpose: Propose a self-contained Windows Computer connection and Agent execution path shared by Web, CLI, and Desktop.
- Read this when: Implementing or reviewing Windows managed installation, process supervision, Desktop connection reuse, or native acceptance.
- Update this when: A design decision is accepted, a feasibility gate changes, or implementation supplies native evidence.
- Do not use this for: Current production behavior, release authorization, or a claim that the unresolved task-host timeout has been diagnosed.
- Source of truth: This proposal owns the proposed Windows work only; existing product, Service, transport, and delivery owner documents remain authoritative until changed with implementation.

Status: IN PROGRESS. Implementation authorized on 2026-09-23, starting from main `d2b3ba43b773786cb658db55aef1b60598be15c8`. Native carrier acceptance is the first gate; subsequent installation and client work must not precede that evidence. No release or production entrypoint switch is authorized.

Remove this document after accepted decisions have moved into the scoped owner documents and the migration and acceptance evidence are recorded in the implementation PR.

## Intended outcome

A person authorizes this Windows user's Computer once. OpenMeld can then ask the selected local Agent to do permitted work and return a visible result, without an open terminal or Desktop window. Installing Desktop later reuses that Computer and Service after account verification. Installing Desktop first invokes the same connection operation.

Connection binds an account, stable device identity, local installation/lane, and authorized capabilities. It is not arbitrary remote shell access, a second account identity, or a promise that every installed Agent can execute every task. Cloud authorization and RuntimeCoordinator remain the execution authority. A live connection, a usable controller, and a successful Wake are separate facts.

No user-installed Node, npm, Bun, compiler, WSL, administrator account, or Developer Mode is a prerequisite for OpenMeld itself. Individual third-party Agents may still have their own installation, login, runtime, and sandbox requirements; those belong to controller capability review and are never hidden by a Computer-connected badge.

## Findings that constrain the design

- Web explicitly selects npm on Windows; Desktop's Windows tool acquisition also requires external Node/npm. Both can converge on managed artifacts.
- Binary production currently builds only `darwin-arm64`. The publisher pins Bun 1.3.14. That version's own executable documentation already lists Windows x64, ARM64, and `--windows-hide-console`; current upstream stable observed during this review was 1.4.2. Neither documentation nor a version change proves our SDKs work in a compiled Windows executable.
- Task Scheduler currently uses the user's interactive token, ordinary privileges, no execution deadline, and a bounded restart policy. This matches the personal workstation scope.
- Service startup currently runs Task Scheduler -> generated C# task host -> PowerShell -> Node/Service. The host is compiled on the user's computer. Agent process Job handling also starts PowerShell and compiles C# at runtime.
- Existing Job handling already assigns the child to its Job atomically during process creation and verifies parent incarnation. Preserve those guarantees when replacing its delivery mechanism.
- Existing Windows credentials use current-user DPAPI. Preserve the account/endpoint scope and ciphertext compatibility; do not introduce a parallel credential store.
- Existing managed installation uses POSIX-style symlink switching, while downloaded binary signature verification is macOS-specific. Adding a Windows compiler target alone is insufficient.
- Desktop already has Windows packaging/update foundations and account-checked connection reuse. Code presence is not a signed package, upgrade, or physical Windows acceptance result.
- The exit-0/exit-7 task-host timeout remains unresolved. Removing that wrapper is an architectural simplification, not proof of its original failure mechanism.

## Decisions

### 1. Keep a per-user workstation agent, not a privileged system service

Use Task Scheduler 2.0 with the current user's interactive token and least privilege. Register under SID plus lane identity, run at sign-in, tolerate temporary offline state, prevent duplicate instances, and use bounded failure restart. The existing lifecycle owner distinguishes an explicit stop from a crash; scheduler observations cannot override desired state or a live execution lease.

Default availability is while the user is signed in and the machine is awake. Locking or disconnecting remote control is not the same as signing out; RDP/session policy and sleep can still make execution unavailable. Sign-out/reboot invalidates process ownership, not the stable Computer identity. Concurrent Windows sessions must not create a second execution owner. Do not promise screen automation while locked or logged out.

SCM/LocalSystem is not the default: it moves execution away from the person's session, Agent credentials, and desktop. S4U is not a password-free substitute for this requirement. MSIX/StartupTask is a packaging alternative, not a prerequisite for standalone CLI installation or a complete crash-supervision policy. Do not add a second autostart mechanism alongside Task Scheduler. A future unattended server product is a separate runtime, not a flag that silently elevates personal Computers.

### 2. Ship a managed bundle with distinct console and background entries

Prefer the existing shared TypeScript runtime compiled into Windows executables:

- A console CLI for human commands and structured Desktop control.
- A Windows-subsystem background entry for the existing Service runner and private Execution Host roles.
- One narrowly scoped, prebuilt native Windows helper only for APIs the runtime cannot safely provide: existing atomic Job ownership/process launch, task registration/control, and current-user DPAPI access as needed. It is not a new daemon, cloud protocol, or execution authority.

Task Scheduler launches the verified background entry directly. It must remain alive for its supervised role, report real exit status, initialize its own bounded/rotated logging, and run without an intermediate PowerShell/C# log-copy host. Console-free subsystem selection does not automatically prevent child windows; child creation must use the existing explicit native launch contract.

The helper replaces runtime compilation; ship it in the same versioned, signed bundle. Prefer a small statically linked Win32 executable with a fixed versioned protocol, not a framework-dependent executable requiring users to install another runtime. Port only existing necessary native behavior. Do not introduce Bun FFI or Node ABI-specific addons unless they demonstrably reduce the total artifact and maintenance burden. Shared policy remains in TypeScript.

PowerShell 5.1 remains a supported, readable initial bootstrap environment. It may perform bounded acquisition work; it is not a persistent Service carrier or an interpreter for every Agent turn. No PowerShell 7 installation is required.

Before committing to Bun as the Windows carrier, exercise the actual bundled entry, private Host IPC, SQLite reader, vendor SDK streams, and child process behavior on native x64 before proceeding; ARM64 requires a separate native acceptance before it is advertised. Compare the pinned version with the current stable version only where concrete compatibility warrants it. If a necessary SDK cannot work, select a bundled supported Node runtime instead and document the specific blocker. Do not ship two automatic carrier fallbacks or expose this choice to users. Self-contained installation, not a one-file executable, is the product contract.

### 3. Preserve the existing connector and execution ownership

```text
Web / Desktop / CLI -> the same Prepare and setup contracts
                               |
                  managed install + account grant
                               |
Task Scheduler -> Service connector <-> cloud RuntimeCoordinator
                         |
                  private Execution Host
                         |
              controller adapter -> local Agent
```

The connector owns transport/reconnect; the Host owns local slots, provider operations, approvals, and the durable result outbox. Reconnecting never launches a duplicate turn. Host loss closes new admission until quiescence is established; a Job cleanup receipt does not prove that external side effects never happened. RuntimeCoordinator still owns final outcomes and safe reconciliation.

Use structured executable/argv/cwd/env values, with one Windows quoting boundary. Prefer actual native executables or known script entries over repeated `.cmd`/PowerShell reparsing. Keep compatibility for real installed Agent wrappers at their adapter boundary. Large prompts and credentials use inherited IPC/stdin, not command lines, task XML, or logs. Do not infer Node from a compiled CLI's `process.execPath` when launching a third-party Node script.

Preserve atomic Job assignment, explicit inherited-handle lists, and parent PID plus creation identity. Graceful cancellation comes first; bounded forced cleanup targets only the admitted process Job and returns actual drain evidence. A Job is process-lifetime containment, not a file/network security sandbox. Provider-specific sandbox and approval requirements remain independent capability checks. ConPTY is only for a controller that genuinely requires terminal semantics, not a default wrapper around SDK/JSON protocols.

### 4. One installation and update owner for every entrance

Web bootstrap and Desktop acquire the same signed release manifest and bundle. The CLI's managed installer owns validation, activation, migration, account admission, and Service registration. Desktop does not maintain another version registry or background runtime; its own Electron update remains a separate GUI update.

Keep existing user data, device IDs, account grants, DPAPI entropy, task identity, and lane boundaries. Do not move `~/.openmeld` simply to improve directory aesthetics. Versioned executable artifacts may use a per-user application directory, but their location is resolved by the same existing installation owner. Tests use disposable `OPENMELD_HOME` and unique registrations.

Install updates side by side. Verify transport hashes, platform/architecture, Authenticode trust and publisher identity before activation. The publisher signs before computing final hashes. A manifest hash alone does not establish publisher trust; Authenticode alone does not guarantee the absence of SmartScreen or enterprise policy prompts.

Avoid privileged symlinks and overwriting running executables. A stable signed console launcher, if required for PATH, resolves the one active installation record; Task Scheduler points to the exact versioned background entry. The registration is not a second desired-version database: it is reconciled from the installer-owned active record under the lifecycle lock.

Download/verify first, close new admission, drain accepted work using the existing stop/update contract, switch the active installation and task registration as a recoverable transaction, start, and verify account/device/contract alignment. Preserve the previous version and a bounded activation journal until success. Rollback is allowed only after proven local quiescence and compatible state; never automatically roll back over unconfirmed Host work. Normal long-running work has no invented total deadline.

Keep the existing maintenance action only for its distinct repair/update responsibility; do not introduce another continuously running watchdog. Its one-shot program comes from the same bundle and is directly registered as well.

### 5. Three entrances, one connection result

For the first implementation, use the current setup endpoint and grants with a readable PowerShell invocation. Preserve nested quoting, Unicode, correct exit codes, and terminal behavior through a real PowerShell 5.1 test. Do not add a short-link credential exchange merely to save characters.

A download-and-run signed installer can later be the novice-facing Web action, beside a command option. It invokes the same setup operation and browser/device authorization. Do not place reusable account tokens in download URLs or depend on third-party deep-link interception being impossible.

Desktop-first: sign in, choose Connect, acquire missing managed tools, invoke the same account-checked setup, and observe completion. Web-first: Desktop signs into the same account, reads the existing connection-review projection, and reuses the same Computer and Service. No implicit cross-account adoption, duplicate enrollment, or automatic restart of an explicitly stopped Service. Desktop login and CLI credentials remain independently scoped.

UI shows the next meaningful action: installation, account confirmation, connecting, connected, or a specific repair need. Diagnostics retain installation, scheduler, process, cloud connection, controller, and Wake evidence separately. Registration success is never connection success; connection success is never every-Agent readiness. Align platform tab typography and preserve the Beta badge as secondary text.

## Validation and release design

| Layer | Runs where | What it proves |
| --- | --- | --- |
| Shared contracts and transitions | Developer Mac / existing fast CI | authorization, account/lane fencing, version selection, idempotency, migration plans, and controller protocol contracts |
| Windows native artifact acceptance | GitHub Windows runner | actual compiled artifacts, PowerShell 5.1 bootstrap, console subsystem, native argv, Job cleanup, output drain, DPAPI round trips, task read/write/migration, failed update recovery |
| Clean-user artifact acceptance | Standard-user Windows VM/session | no external Node/npm/Bun/compiler, no elevation/Developer Mode, real PATH and permissions, install/reinstall and existing identity reuse |
| Desktop/session acceptance | Disposable interactive Windows VM, then one real user path | browser return, existing/new connection, GUI exit independence, sign-out/sign-in, reboot, sleep/resume, locked/RDP-disconnected behavior, native controller permissions |
| Production artifact acceptance | Guarded release lane | exact signed bytes, publisher and architecture, update manifest, old-to-new transition, channel visibility, and approved real-user outcome |

Build tooling may use Node/Bun/SDKs; the consumption job must execute only the packaged product with external developer runtimes unavailable. A restricted PATH is a useful test, not proof that no hidden absolute-path dependency exists. Include a clean standard-user VM image for that contract. Hosted runners have installed software and privileged contexts; never equate their green result with an ordinary user's session or corporate endpoint policy.

Use pinned runner families and record actual image version, shell/runtime versions, source SHA, attempt, artifact hashes, and process-start identities. Test each advertised architecture natively; do not infer ARM64 support from x64 emulation or cross-compilation. Keep the supported OS matrix explicit rather than claiming every Windows release.

Extend the existing Windows workflow by owned paths. Cross-platform policy tests do not need Windows. Windows carrier, installer, native helper, SDK, or packaging changes select the native artifact matrix. Ordinary Web view edits need the focused Web checks; they do not justify a full Windows reinstall. Runtime/toolchain changes select the broader matrix once.

Run the representative exit-code, large concurrent stdout/stderr, early exit, inherited-handle, and forced-cleanup cases through the real native process boundary. Keep each functional deadline independent of observer setup, and collect diagnostics externally before fixture-owned cleanup. Do not fix the old A test by increasing its deadline or silently excluding its behavioral contract when the old wrapper is retired.

Interactive/reboot tests belong on an ephemeral or resettable VM with a test account and no production credentials. Persistent self-hosted machines must not execute untrusted fork PRs. Before provisioning new infrastructure, exercise a bounded acceptance batch on the user's authorized UU-connected Windows machine with disposable state. Never turn it into a persistent runner without separate authorization.

Keep human Windows acceptance small and risk-selected: initial release, updater/identity/session changes, and a new runtime or supported architecture need it. Ordinary shared logic changes reuse the proven harness and require a new interactive smoke only when they touch that boundary. No claim that all Windows smoke can disappear.

Release order: compatible manifest/receiver support first, signed Windows artifacts second, public Web/CLI/desktop acquisition advertisement after channel verification, then Desktop promotion after its artifact acceptance. Use one existing trusted publisher to assemble the multi-platform manifest; parallel builders must not independently overwrite the stable pointer. Do not change global CLI/Service floors until every required platform artifact is available. Preserve npm compatibility for existing installations and an explicit developer path without keeping it as an invisible production fallback.

## Implementation sequence and decision gates

1. **Bounded carrier proof:** build console and background entries for native Windows; verify real Host IPC, SQLite and a representative controller protocol, no console, and no external runtime. Record whether pinned Bun suffices or a measured upgrade is needed. No production installer switch yet.
2. **Managed Windows installation:** extend the shared artifact schema, validation, signature checks, side-by-side installation, activation and rollback. Prove a fresh standard-user installation and an old npm/task migration without identity reset.
3. **Direct supervision and Agent launch:** register the background entry directly, replace runtime-compiled native Job operations with the prebuilt helper, retain DPAPI compatibility and all lifecycle fences. Preserve a narrow old-task reader until the documented support boundary retires it; do not retain two active launch mechanisms for one installation.
4. **Web and Desktop convergence:** readable bootstrap and consistent tabs; both acquire the same bundle, use the same setup/status contracts, and reuse a verified existing connection. Preserve account mismatch, stopped-Service, and unsupported-controller outcomes.
5. **One exact candidate and release handoff:** normal hooks, risk-selected artifact/session evidence, Contract Impact Audit, current-base Final Candidate, and a reviewed release plan. Merge, deployment, publication and production smoke remain distinct authorizations.

Implementation uses the isolated `windows-native-connection` worktree and `codex/windows-native-connection` branch. Keep the PR draft, commit coherent batches, and record source SHA, run attempt, and artifact evidence here. No merge, deployment, or publication is authorized.

## Native implementation evidence

Draft PR: https://github.com/amplifthq/openmeld/pull/1267. Production acquisition remains unchanged. No merge, release, deployment, or colleague-machine acceptance has occurred.

- Build gate, run [35873923417, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35873923417), PR head `5d92b5a24c2d974b6ddf1bd8d548af0fc4ff5eff`, actual checkout `cf781f15b1a817fd5b09107818d2c4c339c6ce64`: compilation exposed an unconditional macOS Keychain asset dependency. Platform import isolation corrected it. The separate legacy contract job reproduced exit-0 `ETIMEDOUT` and cleanup `EBUSY`; exit 7 passed. This did not establish the old timeout's root cause.
- Runtime gate, run [35875675281, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35875675281), PR head `effa643d815ad73b907899549c656daf0093a585`, actual checkout `89a50b47400917a6f20d01d1e3e73b3df665682e`: both Windows executables built. Three real Host initialization/account-transition/IPC/drain cases passed. Full Service acceptance did not run its loop because fixture installation state was missing. Direct Host rejection returned the intended error but its test incorrectly treated an AppData directory outside the product lane as product state. Both are fixture corrections, not product repairs.
- That runtime gate also rejected the background executable's PE subsystem: it was console (`3`), not GUI (`2`). SQLite/SDK execution was therefore not reached. [Unsigned artifacts and fixture logs](https://github.com/amplifthq/openmeld/actions/runs/35875675281/artifacts/10759455048) have limited Actions retention; these conclusions and exact identities remain in this tracked record. Runner: Windows Server 2025, image `windows-2025-vs2026` / `20260907.229.1`; Node `24.14.0`, Bun `1.3.14`.
- Bun 1.3.14's [Windows compile path](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/standalone_graph/StandaloneModuleGraph.zig#L836-L874) returns before the later `hide_console` handling. Bun 1.4.2 [applies the subsystem change before writing the PE image](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/standalone_graph/StandaloneModuleGraph.rs#L2049-L2055). The Windows-only toolchain moves to 1.4.2 for this concrete reason; macOS publication is unchanged. The builder rejects incorrect subsystem bytes instead of patching them or trusting the flag alone. New native verification remains required.
- Local evidence: six build contract tests, CLI TypeScript, four source Host integration cases, and normal push checks (1,373 related unit tests) passed. The real SDK exchanged a request/result with the typed protocol fixture on macOS using disposable state. Cross-compilation and that fixture check are not native Windows acceptance, a real authenticated Agent task, or a Computer-connected claim.
- Runtime gate, run [35877379216, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35877379216), PR head `98c8671dd900c5828d6d353562f6967058eb712c`, actual checkout `63ddde50a42ae4418a16a5b4c78b2636cb103e31`: Bun 1.4.2 produced the correct console/GUI subsystem bytes. All five actual Service/Host cases passed, including Service-to-Host update readiness and graceful shutdown with system-only PATH. The separate component harness reached its 45-second deadline without any child output; its PowerShell-based cleanup also reached the existing 15-second limit. This supplies no SQLite/SDK execution result. The next fixture preserves the normal OS environment while retaining disposable user state and system-only PATH, and records entry stages. This is a test-environment comparison, not a proven product fix or an increased deadline. [Exact unsigned artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35877379216/artifacts/10759282117).
- Runtime gate, run [35878870134, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35878870134), PR head `1cba4521da53d805649a9e50e5501750694c49ed`, actual checkout `aa92d4f2e1b3717022a11cad6987da71aa8067f7`: all five Service/Host cases passed again. The component supervisor now exited promptly with `openmeld.windows_process.failed: 123`, before the compiled component entry marker. Cleanup completed. This narrows the observed failure to a native launch operation, not SQLite or an Agent result; it does not prove the earlier timeout's cause. The existing native process test now also exercises a Unicode/space working directory, and native Win32 errors retain their fixed operation label without printing request data. [Exact unsigned artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35878870134/artifacts/10759214467).
- Runtime gate, run [35880251442, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35880251442), PR head `00e0ae3cfd433894fb0068cc80f7d028e0eddc48`, actual checkout `31714e464616a4fd32c0c4f82a6cd40a59f67bb6` (base advanced to `168ac9ece49a3cbf8078fdd7d9026067b245c5f8`): Service/Host 5/5 passed. The existing Node Job case also passed with a Unicode/space working directory. The separate component and drain operations failed with generic Win32 error 123, not a fixed label from the native API helper. Its redirected `TEMP/TMP` remains a distinguishing condition. The next comparison isolates that condition in the existing native Job case while keeping the compiled component's Unicode workspace. Fixed phase labels now distinguish request decoding, helper compilation, launch, and drain without emitting exception messages. This is not a waiver of the temporary-directory contract. Legacy task-host exit 0 passed; exit 7 hit `ETIMEDOUT` plus `EBUSY`. [Exact unsigned artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35880251442/artifacts/10761091326).

- Carrier feasibility, run [35881984525, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35881984525), PR head `4a1dfaefe594ccb91a6dd77de9b9fa88d3c0e689`, actual checkout `3aeda46abe4d92f14346d2efeaf5da97d4799364`: the native artifact job passed. The compiled entry ran its read-only SQLite query and real Claude SDK protocol exchange from a Unicode/space workspace, and all five actual Service/Host cases passed. This establishes carrier feasibility with system-only PATH; the SDK peer does not perform model inference. [Exact unsigned artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35881984525/artifacts/10760874087).
- The same run's separate process contract job failed when the existing Job case also redirected `TEMP/TMP` into its Unicode/space directory. The final cleanup assertion obscured the initial error; the case now preserves both failures. This is a required regression check, not a waived fixture. The planned prebuilt native process helper is advanced before installer work, retaining the existing Win32 Job implementation and replacing runtime compilation and PowerShell-based identity reads. A more specific explanation of the old temporary-directory error still requires evidence; successful replacement alone will not prove it.

- Prebuilt helper, run [35883739779, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35883739779), head `6fc1bed146627b4d562fc091ff3656326f28952c`, checkout `44850134c8794c5cb6901fdbaca8f666f53b596f`: native process contracts passed, including Unicode `TEMP/TMP`, exit codes, streams, owner death and Job cleanup. Compiled SQLite and Claude SDK protocol acceptance passed. Service/Host acceptance was 4/5: the source-aliased test could not locate the package's helper before launching the Service. The helper resolver now addresses the shared `dist/windows` output from both source and packaged entrypoints. That directory is also retained and hashed by the npm Service bundle, unlike CLI-only `dist/native`. npm artifact admission rejects a missing helper. [Unsigned artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35883739779/artifacts/10761503220). The entire run failed; the package-path correction still requires native acceptance.

- Helper packaging correction, run [35885974471, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35885974471), head `8d8532f063d2950c31fb928f4a03e16af2d836be`, checkout `ae1d703b184324f780afab1975c95bb57fa59a7b`: both native artifacts and native contracts passed. All five actual Service/Host cases, compiled SQLite, and Claude SDK protocol exchange passed with the prebuilt helper. [Unsigned artifacts and evidence](https://github.com/amplifthq/openmeld/actions/runs/35885974471/artifacts/10763097057). The legacy task-host cases passed in this run only; this does not establish their earlier timeout's cause or prove it repaired.
- Official controller acceptance, run [35887761917, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35887761917), head `2561656496db660df9b16c773fda1f2890d9d498`, checkout `8fecb7335a86a4f403db53281adf9e5837883cce`: both jobs passed. The compiled production adapter completed `initialize`, `account/read`, and owned shutdown against official Windows Codex `0.153.4` with system-only PATH and fresh `CODEX_HOME`. The result was unauthenticated as expected. Service/Host remained 5/5. This proves real vendor-process communication, without credentials, a model turn, or a claim of authenticated Agent task acceptance. [Unsigned artifacts and evidence](https://github.com/amplifthq/openmeld/actions/runs/35887761917/artifacts/10763527758).
- Importing that run's [small helper artifact](https://github.com/amplifthq/openmeld/actions/runs/35887761917/artifacts/10763014952) on Mac correctly rejected its source fingerprint, exposing a build portability defect: the recorded source hash exactly matched local source converted to Windows CRLF. The source fingerprint now canonicalizes text line endings; executable hashes remain byte-exact. The focused check covers CRLF equivalence and rejects actual source/byte changes. A new Windows-produced manifest is required; the old manifest is not edited to bypass verification.

- Artifact acquisition gate, run [35890886448, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35890886448), head `c769b16e072e47d97adfd7cc54dbf8bc6fd3a428`, checkout `534b524ff0259ac17f1de091b76eca8dc2a4aa71`: native artifacts passed, including all five Service/Host cases, SQLite, and the official Codex protocol. The [source-matched helper](https://github.com/amplifthq/openmeld/actions/runs/35890886448/artifacts/10765521292) imported successfully on Mac (SHA-256 `71e8a21130541c8e457f0db17cf7b06f9d49af3656fcb2d0653c276681653afe`, 1,217,024 bytes), proving the corrected cross-platform handoff. [Full unsigned artifact evidence](https://github.com/amplifthq/openmeld/actions/runs/35890886448/artifacts/10765346496). **The overall run failed:** both legacy task-host exit cases timed out at 30 seconds and cleanup reported `EBUSY`. Subsequent Desktop/Authenticode checks were skipped, so this run does not validate the new companion signature acquisition. Independent later checks now run after a successful package build even when a prior test fails; failures still fail the job.
- Installation groundwork normalizes Node's `win32` into the existing `windows-x64` release key for CLI, Service selection, and builds. The existing manifest integration test now exercises actual native platform selection, including a separate Windows Service artifact.
- The next bounded native gate exercises a thin console launcher from the existing signed helper bytes: one installer-owned version record, native argv forwarding, inherited streams, exact child exit status, and replacement while an older invocation remains alive. It introduces no connection or update authority and is not yet installed by product entrypoints. Windows must prove the running-image rename behavior before the installer uses it. Interrupted activation recovery and maintenance reconciliation remain part of the subsequent installation gate.
- Launcher gate, run [35893013334, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35893013334), head `4cdfb317990e3670a3d093498c6b4c3a7f5302a1`, checkout `655a4203941bcd8262a9f9f8bdafb957638792b8`: native launcher handoff passed, including empty/Unicode/quoted arguments, inherited stdout/stderr, exit 7, and a new invocation while the old image remained alive. SQLite and official Codex protocol also passed. Native contracts, including new companion Authenticode acceptance, passed. **The overall run failed:** actual Service startup exited during the existing PowerShell/CIM process inventory; four other Host cases passed. Its logged error omitted the child exit metadata. The next change preserves duration, code, signal and killed state, without changing the 10-second inventory limit or asserting a cold-start cause. [Unsigned artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35893013334/artifacts/10765853317).
- The installer batch now reuses the shared install lock and semver arbitration with complete immutable Windows directories and one activation record. Existing command discovery reads that same record; existing maintenance repairs an interrupted launcher swap. No new watchdog is introduced. Mac filesystem checks cover failed companion acquisition, immutable-version rejection and interrupted-launcher repair. The next Windows gate adds actual compiled `install-self`, repeat installation, repair through the exact versioned CLI, and kernel-backed whole-bundle pruning while a fixture still runs. Native pruning and installed-product behavior are pending, not inferred from Mac filesystem tests. Windows PATH registration, selected GUI Service preparation, direct task supervision and client acquisition remain subsequent work.

- Installation gate, run [35895813263, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35895813263), head `6c6d891c3d25dc51893ad699ad4ffbb2f39c4fa7`, checkout `1ce4a55438d5bb5bd94a5ddd25a48a1b53ba5600`: **both jobs failed**. The live-image cleanup case reached the native helper but failed with `UnauthorizedAccessException` before the installer case. A read handle is insufficient to establish that an executable image can be removed; the next correction requests write access without writing, acquiring every companion before deletion. Actual `install-self` acceptance remains pending. Separately, Service process inventory now proved it was killed at its 10-second deadline (`10118ms`, `SIGTERM`, `killed=true`); four other Host cases passed. The next inventory change requests only the three consumed CIM properties and records fixed query stages, retaining the same deadline. Legacy task-host exit 0 again timed out with `EBUSY`; later independent Desktop/signature checks passed. [Artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35895813263/artifacts/10766454920).

- Command activation gate, run [35898111397, attempt 1](https://github.com/amplifthq/openmeld/actions/runs/35898111397), head `1ea9ef6c1458bd8be92817c6f330a074e4e70d08`, checkout `0645525e89308575588736d0f64e2cfcb794f6e3`: the actual Service/Host cases passed 5/5 with the narrowed CIM property query. This one pass does not prove every inventory delay repaired. **The artifact job failed earlier at PATH preservation:** both native activation calls returned expected receipts, but the resulting value differed from the synthetic expected PATH. The harness did not retain those compared values, so the precise mismatch is not established. It now retains only synthetic values on failure and constructs Unicode independently of PowerShell 5.1 script encoding. The helper preserves the already-qualified input path instead of allowing `GetFullPath` to rewrite a short profile path. Launcher cleanup and actual installation were not reached. [Artifacts and logs](https://github.com/amplifthq/openmeld/actions/runs/35898111397/artifacts/10768840348).

The carrier and helper have Service feasibility evidence, but the latest required gate is failing. Installation/upgrade recovery, cross-platform production artifact assembly, direct task supervision, Web/Desktop convergence, and ordinary-user Windows acceptance are not complete. The old task-host timeout remains independent and unresolved.

The artifact acquisition batch moved the existing Desktop Authenticode check
into the shared artifact owner and adds Windows publisher/helper metadata to
the CLI/Service release schema. The old Desktop-local implementation is removed.
Mac manifest fields remain unchanged; old clients ignore the additive Windows
fields, and no Windows channel is published by this change. New Windows binary
consumers reject missing publisher/helper metadata. Account, device, Runtime
Transport, Prepare, Wake and Skills contracts are unchanged by this artifact
contract addition. Companion acquisition and activation still need integration
and native verification before the Windows entrypoint can be released.
Companion acquisition is now connected to the existing CLI upgrade, Service
artifact preparation, and Desktop bootstrap paths. It reuses the bounded
download/integrity policy, requires the same artifact origin and Authenticode
publisher, and writes only into the caller's disposable preparation directory.
Managed Windows activation and the Desktop Windows entrypoint remain pending.
The Windows command activation batch writes only current-user `Environment\\Path`,
preserving unrelated entries and the original registry value kind. It uses the
existing command activation lock, excludes custom `OPENMELD_HOME` and development
lanes, and does not require elevation. Native acceptance changes and restores
only the ephemeral hosted runner's user value, proving repeat activation and
literal/expandable PATH preservation. This new gate is pending.

The selected Windows Service now requires its own x64 GUI artifact and signed
companion. One local bundle fingerprint covers both files; the existing update
job, inventory, and account-admission contracts retain that one fingerprint.
Start and repair resolve the active Service instead of deriving its executable
from the CLI version. Maintenance uses an independently copied, verified pair
under the existing bundle store, keyed by that fingerprint. Existing retention
also protects binary pending updates and reads Windows worker references from
the registered task. Whole-bundle Windows cleanup protects mapped old workers;
unrecognized directories remain untouched. Mac filesystem acceptance proves
that a complete maintenance copy survives removal of its original Service and
detects companion corruption; it does not prove native worker self-upgrade or
Task Scheduler replacement. Direct task supervision remains the next batch.

## References

- [Product model](../product/product-model.md), [Service owner](local-openmeld-service.md), [transport owner](agent-transport-contract.md), [Desktop owner](../clients/desktop.md), [CLI release](../engineering/cli-binary-release.md), [delivery](../engineering/agent-native-delivery.md).
- [Task Scheduler security contexts](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks) and [logon types](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_logon_type).
- [Windows interactive services](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services).
- [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [atomic process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute), and [process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).
- [Current-user DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) and [signature verification](https://learn.microsoft.com/en-us/windows/win32/seccrypto/using-signtool-to-verify-a-file-signature).
- [Bun 1.3.14 executable documentation](https://github.com/oven-sh/bun/blob/bun-v1.3.14/docs/bundler/executables.mdx) and [current executable documentation](https://bun.sh/docs/bundler/executables).
- [Microsoft Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) and [the .NET 10 release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json) supporting the self-contained helper and pinned SDK 10.0.401.
- [GitHub-hosted runner contract](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
