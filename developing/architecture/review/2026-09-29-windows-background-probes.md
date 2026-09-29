# Windows background controller probe console regression

## Confirmed cause

The published 0.3.231 GUI Service carrier could create a visible Windows
Terminal window when its controller-inventory path directly launched Codex
app-server. `probeCodexAppServer` omitted `windowsHide`; piped stdio and the
parent's GUI subsystem did not prevent a child console.

The fix applies the existing hiding option to the five direct, noninteractive
controller-status and session-inventory launches in three owner modules. The
native Job helper already uses `CREATE_NO_WINDOW`. Interactive CLI launchers,
Service identity, lifecycle, scheduling, and process ownership are unchanged.

## Real-machine evidence

All times below are 2026-09-29, Asia/Taipei (UTC+08:00).

- Source inspected: `c2772ed0d8665df1550ce64516535fc1507e4b29`.
- Published GUI carrier: OpenMeld 0.3.231, PE subsystem 2, SHA-256
  `b4118222f7509557fd394e9369e52f20c54679631b7a201568750efc401b5bf6`.
  The release manifest did not expose a source SHA; carrier identity and source
  inspection are separate evidence.
- Bun 1.4.2 GUI fixture, no parent console, identical piped PowerShell child:
  16:08:55–58 without hiding produced visible 1168-by-624 terminal events;
  16:08:59–16:09:02 with hiding produced no corresponding show events or visible
  child snapshots. Both children exited successfully.
- 16:19:31: the published GUI carrier (PID 32688) ran `agents show codex` in a
  fresh temporary `OPENMELD_HOME`, with Service auto-install and startup upgrade
  disabled. No real credentials were copied.
- 16:19:41.323: that carrier directly launched Codex app-server PID 34452.
  At 16:19:41.337 its conhost PID 16744 appeared. At 16:19:41.591 a new visible
  Windows Terminal window appeared (host PID 30460, session 1,
  `CASCADIA_HOSTING_WINDOW_CLASS`, 1168 by 624). The exact HWND was not retained.
- 16:19:46: the command exited 0 without stderr. Earlier helper-mediated Codex
  launches in the same GUI command had no corresponding visible show event.
- Real Service PID 32064 and Execution Host PID 30580 remained running; their
  task registrations were unchanged.

This confirms one product flash path. It does not attribute every historical
flash to that path. Process timing alone, or the absence of `-WindowStyle
Hidden` in PowerShell arguments, is not proof of a visible window.

The Windows evidence is retained in thread
`01a0d946-0580-7bb1-8082-6747eb6f15d6`, including
`openmeld_black_console_root_cause_2026-09-29.md`,
`openmeld_isolated_agents_probe_2026-09-29.jsonl`, and
`openmeld_ab_bun_window_results_verified_2026-09-29.jsonl`.
Agent Experience occurrence: `85ebe44c-1b44-494a-945e-71febc9bf371`.

## Regression boundary

The native acceptance executable runs as a GUI application. A console-subsystem
witness reports the OS's `GetConsoleWindow` result. An unhidden positive control
must allocate a console. The real inventory and session-discovery functions
then launch that witness, which refuses a console and otherwise forwards stdio
to the pinned official Codex. Successful unauthenticated account and empty
session responses prove that suppressing the console preserves the protocol.
This test uses an isolated home, no provider login, and no model inference.

## Contract impact and release boundary

Only local process presentation changes. CLI commands, Service transport,
schemas, Prepare, Wake, Space actions, diagnostic payloads, and local identity
remain compatible in both rollout directions. No contract or minimum-version
bump is required; a later release can make the local component available.
The correction satisfies the existing console-free background behavior and
does not violate the local Service architecture's ownership or readiness rules.

Merge is not deployment. Publication and post-release Windows production smoke
belong to the next authorized release train.
