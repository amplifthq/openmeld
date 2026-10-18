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
