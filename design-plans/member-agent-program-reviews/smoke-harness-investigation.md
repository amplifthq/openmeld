# Smoke round 1c · harness stalls — investigation

Scope: R1C-01 (every Codex task failed with `runtime.control_timeout`,
"codex app-server did not acknowledge config/read within 15000ms") and
R1C-09 (a Claude Code task stayed Working with no output; its process was
sampled in `__openat_nocancel`) from
`dev-tmp/member-agent-smoke/round-1c/report.md`. The question was whether the
MemberAgent program causes them.

Date: 2026-10-19. Machine: Felix's Mac (the same one that ran round 1c).
Lane state, `~/.openmeld` and the published lane were not touched.

## Verdict

**The program does not cause either stall.** The cause is in the environment,
and it is the same one the designer found in round 1b. Round 1c moved the
checkout out of `~/Desktop`, but only partly. The smoke checkout
`/Users/felix/openmeld-smoke/worktree` is a **linked git worktree of the
repository in `~/Desktop/work/openmeld`**. Its `.git` file points to:

```text
gitdir: /Users/felix/Desktop/work/openmeld/.git/worktrees/worktree1
```

Both test folders (`dev-tmp/member-agent-smoke/folder-one`, `folder-two`) are
inside that worktree. A harness started by the launchd-managed Service runs
with that folder as its working folder. When the harness reads the folder's
git metadata, it follows the pointer into `~/Desktop`, a macOS
privacy-protected folder. The launchd process has no grant for that folder,
and the `open` blocks. A foreground start inherits the terminal's grant and
does not block.

There is nothing to fix in program code. A product follow-up is proposed
below.

## Evidence

### 1. Logs (R1C-01)

`service-runtime-log.txt` shows the same sequence for all three Codex tasks
(dispatches `4bbb9be9…`, `2dee402b…`, `621a17df…`):

- `provider_process_spawned`, `processWorkingDirectoryKind: runtime_host`.
- `provider_first_stdout` at about 480 ms, which is the `initialize` reply.
- `provider_timeout_triggered` at about 15 490 ms.
- `SIGKILL`, then `runtime.control_timeout` with operation `config/read`.

For every task, `providerRuntimeWorkingDirectory` is
`/Users/felix/openmeld-smoke/worktree/dev-tmp/member-agent-smoke/folder-one`.
The owner and colleague tasks fail in the same way. This includes the colleague
task with a fresh execution-context lane, so neither the request chain nor the
colleague grant changes the outcome. Each local slot started at once
(`waitReason: none`), so 4e folder admission and slot scheduling are not
involved.

### 2. Reproduction of `config/read` by hand

The probe was a 40-line Node script. It spawns `codex app-server` (codex-cli
0.162.1, the same package entrypoint the Service uses, `CODEX_HOME` unset so
`~/.codex`) with its process cwd in `$HOME`, as the adapter does. It sends
`initialize`, then `initialized`, then
`config/read { cwd: <folder>, includeLayers: false }`. These are the exact
parameters from `CodexAppServerTransport.supportsSpaceToolPolicy`.

The launchd runs used a transient user job (`launchctl submit`; it was removed
after each run). The foreground runs came from the session's shell.

| Launch | `config/read` cwd | Git layout | Result |
| --- | --- | --- | --- |
| foreground | plain folder outside `~/Desktop` | none | ok, 117 ms |
| foreground | smoke `folder-one` | linked worktree, gitdir under `~/Desktop` | ok, 113 ms |
| launchd | plain folder outside `~/Desktop` | none | ok, 121 ms |
| launchd | standalone repository outside `~/Desktop` | `.git` directory | ok, 117 ms |
| launchd | linked worktree outside `~/Desktop` | gitdir outside `~/Desktop` | ok, 115 ms |
| launchd | smoke `folder-one` | linked worktree, gitdir under `~/Desktop` | **timeout** (20 s, twice) |
| launchd | smoke worktree root | linked worktree, gitdir under `~/Desktop` | **timeout** (20 s) |

A `sample` of the stalled native `codex` process (launchd run, smoke folder)
shows the request worker blocked here:

```text
codex_exec_server::regular_file::open_sync  (in codex)
  open  (in libsystem_kernel.dylib)
    __open  (in libsystem_kernel.dylib)
```

Only a gitdir under `~/Desktop` combined with a launchd start reproduces the
stall. This matches the existing note at
`runtime/adapters/codex/src/transport/codex-app-server-transport.ts:1960`
(`TODO(PR #225)`, added to `main` in `e5a80533b`, 2026-10-17): "The same
binary and workspace can reply when launched directly, yet time out after a
Service restart. Native samples show blocked file opens". That note predates
the program and is present on `origin/main`.

### 3. Program diff against `origin/main`

Merge base `60cb43e5a` against `origin/claude/member-agent-program` (`414ef4ed9`):

- `runtime/adapters/**`, `runtime/local-execution/**` and
  `clients/openmeld-cli/src/provider-hosts/**` are unchanged. The Codex
  spawn, the process cwd and the `config/read` parameters are the same as
  on `main`.
- `runtime/` changes only `runtime/local-service/src/local-execution-slots.ts`
  (4e folder-scoped scheduling). In the logs every task started without
  waiting.
- The changed CLI Service files are dispatch admission and folder
  resolution (Phase 2, 4e), prompt assembly (1e, 4e) and the folder-control
  frame (Phase 2). They choose *which* folder runs and *what* the prompt says.
  They do not change *how* the harness starts.
  `executionContextVersion` 6/7 only gates which assignment fields Core
  sends. 4e's `isGitRepositoryFolder` runs `lstat(<folder>/.git)` in the
  Service before admission. For `folder-one` this returns `ENOENT` at once,
  because the `.git` file is at the worktree root. The Service process
  itself never stalled: every task reached `runtime_started`.

### 4. Claude Code (R1C-09)

`claude-process-sample.txt` shows a Claude Code 2.1.301 process. Its parent is
`OpenMeld Service Binary Dev` (launchd). The main thread is blocked in
`openat$NOCANCEL → __openat_nocancel` for the whole sample, and the other
threads wait on it. Its working folder is `folder-two`, in the same linked
worktree, so the same gitdir pointer into `~/Desktop` applies. Claude Code reads
the working folder's git state when it starts. This is consistent with the
Codex mechanism. It was not proven separately for Claude, because a launchd
Claude run would need a real model turn. The proposed check below covers both
harnesses.

### 5. Collateral observation on this machine

During the investigation, `git` commands in every `~/Desktop/work/openmeld`
worktree began to hang. This includes commands from other Claude sessions.
`access()` on any file under `~/Desktop/work/openmeld/.git/worktrees/*`
blocked, while `.git/config` and paths outside `~/Desktop` did not. At the same
time, a launchd-started dev Update Worker whose binary sits in a
`~/Desktop/…/.claude/worktrees/keen-booth-0d071a/.turbo/…` lane (PID 24853,
parent `launchd`) had been blocked in `dyld __open` for 25 minutes. This is
round 1b's failure mode, and it is still active. The two may be linked through
the pending privacy decision. That was not proven. It belongs to another
session's lane and was left running. This report was committed from a clean
clone outside `~/Desktop` because of it.

## What to change

### For the next smoke round (environment, no code)

Use a checkout whose git metadata is also outside `~/Desktop`. Use a
standalone clone, for example
`git clone --branch claude/member-agent-program https://github.com/amplifthq/openmeld.git ~/openmeld-smoke/clone`,
not `git worktree add` from the `~/Desktop` repository. Keep the test folders
inside it. Before running scenarios, check that `.git` is a directory
(`test -d <checkout>/.git`). As an alternative, grant the dev Service binary
Desktop access. That changes privacy settings, so Felix has to decide.

### Product follow-up (pre-existing, not part of this program)

Real users run the production Service under launchd too. A working folder in
`~/Desktop`, `~/Documents`, `~/Downloads` or iCloud Drive, or a worktree whose
gitdir lives there, makes Codex fail after 15 s with a misleading control
timeout. Claude Code is worse: it can stay Working indefinitely. A proposed
follow-up for the Service and adapters:

1. Before launching a harness, resolve the working folder and, if present,
   its `.git` pointer (`gitdir`, `commondir`). If either lies in a
   TCC-protected location, test it with a bounded probe on a worker. A
   blocked or denied `open` should fail the task fast with a specific
   reason code (for example `computer_file_access.protected_folder`) and owner
   guidance ("Give OpenMeld access to Desktop in System Settings › Privacy &
   Security › Files and Folders, or choose a folder outside Desktop"). No
   timeout should look like a harness fault.
2. Replace `TODO(PR #225)` in `codex-app-server-transport.ts` with this
   finding and a link to the check.

This needs a Service and Web contract decision (reason code and copy) and
belongs on `main`, not in this program. No code was changed on this branch.

## Cleanup

- The transient launchd jobs `ai.openmeld.investigation.codex-config-read`
  were removed after each run, and their leftover `codex app-server`
  children were killed.
- Probe files are in `/Users/felix/openmeld-smoke/investigation/` (the script,
  outputs, a throwaway repository and its linked worktree). They hold no
  credentials. They can be deleted.

---

# Smoke round 2b · Codex `thread/start` timeout and lost folder choice

Scope: R2B-03 from `dev-tmp/member-agent-smoke/round-2b/report.md`. Every
Codex folder task failed with `runtime.thread_start_timeout` ("codex
app-server did not acknowledge thread/start within 90000ms"). The run used a
standalone clone (`/Users/felix/openmeld-smoke/clone`), plain test folders
(`/Users/felix/openmeld-smoke/folders/folder-one`, `folder-two`) and a
launchd Service that started normally. The report also notes that the task
chose folder-one but ran in folder-two.

Date: 2026-10-19. Same machine. `~/.openmeld` and the published lane were not
touched.

## Verdict

These are two separate causes.

1. **The `thread/start` timeout is environmental (harness and machine), not
   program code.** All three failed app-server processes stopped during Codex
   session start, at the point where Codex scans the user's skill folders. The
   one Codex run that succeeded reached the same step and reported
   `failed to scan skill path file:///Users/felix/.agents/skills/openclash-dnsfix: Interrupted system call (os error 4)`,
   then continued. That skill is a symlink into `~/Desktop`
   (`~/.agents/skills/openclash-dnsfix -> /Users/felix/Desktop/felix-projects/openclash-dnsfix`).
   On this machine, opening `~/Desktop` paths blocked during the morning of
   2026-10-19 (see round 1c, "Collateral observation"). The open either got
   interrupted (EINTR, success) or never returned (timeout). It does not block
   now, and the same requests no longer reproduce the timeout.
2. **The lost folder choice is a program bug (Phase 2), fixed on this
   branch.** Core removed the owner's own `folderId`, so the task ran in the
   default folder.

## Evidence for (1)

### Service and dispatch evidence

| Dispatch | Lane | Folder run | Result |
| --- | --- | --- | --- |
| `59324dcf` (plain request) | `agent-profile:` (no Execution Context) | folder-two | success, 24 s |
| `5cfc1f99` | `execution-context:` | folder-two | `runtime.thread_start_timeout` |
| `9d438e2d` | `execution-context:` | folder-two | `runtime.thread_start_timeout` |
| `8ab025f0` | `execution-context:` | folder-two | `runtime.thread_start_timeout` |

In each failure, `config/read` and `configRequirements/read` answered.
`thread/start` was sent and never acknowledged. No stderr appeared in 90 s.

### Codex's own logs (`~/.codex/logs_2.sqlite`, read-only)

Per app-server process, keyed by the PID that the Service logged at
`provider_process_spawned`:

| PID | Run | Last milestones |
| --- | --- | --- |
| 25809 | success | shell snapshot (+2 s) → skills cache cleared → **skill scan EINTR on `openclash-dnsfix`** (+6 s) → `mcp_manager_init` → `thread/started` → `turn/start` |
| 76328 | `5cfc1f99` | skills cache cleared → shell snapshot (+3 s) → nothing more on the request (plugin catalog at +29 s) |
| 7401 | `9d438e2d` | skills cache cleared → shell snapshot (+2 s) → nothing more |
| 70565 | `8ab025f0` | skills cache cleared → shell snapshot (+4 s) → nothing more |

Across all Codex processes since 01:00 UTC, the log has 42
`failed to scan skill path` entries. Every one of them names
`~/.agents/skills/openclash-dnsfix`, including Felix's foreground Codex
sessions around 09:30 local time. Opens of that `~/Desktop` target were
blocking machine-wide at the time.

### Reproduction by hand (now)

The probe follows the same method as round 1c, extended to `thread/start`.
It uses the Service's binary (ChatGPT.app `codex` 0.163.0-alpha) and the exact
Execution Context launch arguments, computed by the built adapter
(`buildCodexFileAccessBoundaryGlobalArgs`). Those arguments disable features
and add the `openmeld_computer_boundary` permission profile with `-a never`.
The `thread/start` parameters match the adapter: `approvalPolicy: "never"`,
`permissions`, `runtimeWorkspaceRoots: [folder]`, and `initialize` with
`experimentalApi`. Each probe ran from a transient launchd job.

| Launch | HOME / skills | Params | `thread/start` |
| --- | --- | --- | --- |
| foreground | real | legacy | ok, 314 ms |
| foreground | real | Execution Context | ok, 398 ms |
| launchd | real | legacy | ok, 458 ms |
| launchd | real | Execution Context | ok, 368 ms to 1.2 s |
| launchd | empty `.agents/skills` | Execution Context | ok, 2.9 s |
| launchd | only the `~/Desktop` skill symlink | Execution Context | ok, 373 ms |

None of the probes reproduces the timeout now. This matches the machine
state: `~/Desktop` opens no longer block, and the launchd-started dev Update
Worker that was stuck in `dyld __open` (round 1c) is gone. The Execution
Context parameters are not the cause. The Codex adapter, its launch arguments
and the Service launch path are identical to `origin/main`; the program
diff in `runtime/` touches only `local-execution-slots.ts`. Nothing in
Phase 2, 4e (`isolated_if_git`, admitted-folder pinning) or
`executionContextVersion` 7 runs inside the Codex process. Those tasks
started without waiting and ran `current` workspaces in a plain folder.

The proof is circumstantial. No process sample was taken during the failure,
so the stalled `open` was not observed directly. The ordering of the log
milestones, the EINTR on the same path in the successful run, and the
machine-wide `~/Desktop` stall are the basis for the verdict.

### What to do

- Next smoke round: remove or relocate symlinks into privacy-protected
  folders from `~/.agents/skills` (and `~/.codex/skills`), or run the round on
  a machine without them. Check first with
  `find ~/.agents/skills ~/.codex/skills -maxdepth 1 -type l -exec readlink {} \;`.
  This changes Felix's own setup, so it is Felix's decision.
- Product follow-up, pre-existing and outside this program (it extends round
  1c's proposal): a user's harness configuration can reach a protected folder
  even when the working folder is clean. A fixed 90 s timeout is the only
  signal today. The Service could sample the stuck harness or attach the last
  native log milestone to `runtime.thread_start_timeout`, so the failure names
  the step.

## Evidence for (2) and the fix

- The Space stored Felix's message for `5cfc1f99` with
  `contextSelections[<Codex Profile>] = { mode: "new", folderId: "05d2aabc-…" }`
  (Space Durable Object state, `space_signals`).
- The Execution Context that Core created for the same flow (context
  `804a821c-…`, dispatch `8ab025f0`) has `access: workspace`,
  `workspace: current`, `permissionSource: agent_settings` and **no
  `folderId`** (RuntimeTransportHub Durable Object state). Core removed the
  folder, and the Service ran the default folder-two.
- Cause: `readActiveProfileOwnerUserId`
  (`services/core/src/dispatch/application/accepted-dispatch-snapshot.ts`)
  looked up the requester with `AND organization_id = $2`. Human Profiles have
  `organization_id = NULL`. Other code queries them as
  `(profile_kind = 'human' OR organization_id = …)`, and the remote-agent
  fixtures insert them with `NULL`. The lookup therefore never found the
  owner's human Profile, and `applyFolderSelectionPolicy` treated the owner as
  "not the owner" and stripped every folder choice. This holds with the flag
  on (chain root) and off (one-hop author).
- Fix: a human Profile matches when its owner is a member of the
  Organization, as `readActiveRepresentedHumanSender` checks. Agent Profiles
  must belong to the Organization, as before. Colleagues and users who are not
  members still lose the folder.
- Test: `services/core/tests-node/folder-selection-owner.test.ts` runs
  against PostgreSQL. It keeps the owner's folder, keeps it for the owner's
  Agent in the Organization, and strips it for a colleague and for a human
  whose owner is not a member. It fails on the previous query
  (`expected { mode: 'new' } to deeply equal { folderId, mode: 'new' }`) and
  passes with the fix.

The selected source in the continuation attempt was a failed task with no
native checkpoint, so `execution_context.fork_checkpoint_unavailable` was the
expected rejection. That part of R2B-03 is a presentation gap (the menu offers
failed sources), not this bug.

## Checks

- `pnpm -r --filter './packages/**' run build`: pass.
- `pnpm exec tsc --noEmit -p services/core`: pass.
- `node tooling/postgresql/local.mjs run pnpm exec vitest run --config vitest.boundary.config.ts`
  on `folder-selection-owner`, `folder-selection-policy`,
  `remote-agent-delegated-requester` and `execution-context-workspace-default`:
  26 passed (local PostgreSQL only).

## Cleanup

- The transient launchd jobs (`ai.openmeld.investigation.codex-thread-start`)
  were removed after each run. Their `codex app-server` children were killed;
  ChatGPT.app's own app-server processes were left running.
- Probe files are in `/Users/felix/openmeld-smoke/investigation/`
  (`thread-start.mjs`, the computed launch arguments, temporary HOME
  folders). They hold no credentials. They can be deleted.
