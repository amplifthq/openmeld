# Official CLI Skill revision 5 smoke

## Agent Context

- Purpose: Record the practical comparison and validation boundary for the official Skill rewrite.
- Read this when: Reviewing revision 5 or deciding what its smoke establishes.
- Update this when: This candidate receives materially different evidence.
- Do not use this for: Production execution proof, release authorization, or a statistical model benchmark.
- Source of truth: These candidate observations; the [delivery owner](../../engineering/official-cli-skill.md) retains the publication and installation contract.
- Removal condition: Remove when revision 5 is delivered or superseded; Git and the PR retain the evidence.

Status: IN REVIEW. Source and signed assets are prepared; no production delivery occurred.

## Candidate

[PR #1473](https://github.com/amplifthq/openmeld/pull/1473) compares the previous
signed revision 4 with revision 5 authored against main
`4dfe744b7133768ae0bf36c0d3bd5ed9d43f99cb`. Candidate content was frozen at
`2c3ece8badade903e2aad50a0842ed2c3ff8d859` before the behavioral comparison
finished and was not tuned to its answers.

Revision 5 requires CLI 0.3.237. Its eight Markdown files contain about 7,190
words versus 10,179 across revision 4's six files, a 29% reduction despite the
additional resource workflows. The entry remains a short task router, with
relative links to details. Its portable `name`/`description` discovery and
progressive disclosure follow the official
[Codex Skills guidance](https://learn.chatgpt.com/docs/build-skills) and
[Claude Code Skills guidance](https://code.claude.com/docs/en/skills).
No new hooks, native permissions, or agent configuration are required.

For each bundle, SHA-256 covers sorted relative Markdown paths, a NUL byte,
and exact file bytes:

- Revision 4: `40ddf22f50183787b028d5f21cc982b2db4743ff512bc27de5bdc56ca5c504f2`
- Revision 5: `e0097f3df6b72f27ba773ce7167e8553682102dfb905f06675e80a4979370ba4`

## Matched native method

An independent evaluator wrote six realistic cases and their scoring rubric
from public contracts before reading either guide. The author did not read the
rubric during candidate writing or execution. Each variant received the same
task, files, fixed follow-up observations, permissions, and time budget in a
fresh native session. Launch order alternated. The scorer received neutral
variant labels, actual commands, responses, artifacts, and discovery evidence;
the mapping was withheld until scores were frozen.

- Runtime: the installed app's Codex CLI 0.159.0-alpha.12.1, using the same
  inherited `gpt-6-astra` model and `xhigh` reasoning for both variants.
- Discovery: only the selected complete `openmeld-cli` bundle was copied into
  the native workspace Skill directory. It appeared in the native catalog;
  prompts neither pasted nor explicitly invoked it. No repository instructions,
  rubric, alternative guide, or previous session was visible.
- Isolation: fresh workspace and `OPENMELD_HOME`; model shell network denied;
  user-home and runtime-auth directories denied; writes confined to the
  workspace. Canary reads/writes and a controlled loopback server verified the
  sandbox boundary. No user-global Skill or Service configuration was changed.
- Scope: models performed local tasks and prepared exact public commands for
  external work. Frozen follow-up cards were explicitly scenario data, never
  fabricated successful tool calls. Neither variant could inspect an installed
  OpenMeld executable; proposed commands were checked afterward against the same
  real published CLI.
- Budget: 300 seconds per turn, at most two native processes concurrently.
  All 14 sessions and 24 turns completed without runtime errors or timeouts.
  After the paired fixture correction below, 12 sessions and 20 turns form the
  six scored pairs. Temporary native authentication files were removed.

The original sharing/Wake case accidentally supplied an Agent ID without the
required `agt_` prefix. The evaluator confirmed the schema error independently;
only that prefix changed, and both variants reran with the same frozen guide.
The original pair remains superseded evidence, not a Skill failure. The
corrected fixture digest is
`1302a2d90c0d7e792bcea7e42da3cc908c1f9c67926254993495721c03afc16a`;
the unchanged frozen rubric digest is
`03f8e764b74e115cb62a4db33d9fb2a1d1466bb549d6b588c2d256878b176351`.

Blinding had one disclosed limitation: a mixed shell command exited nonzero
after reading Skill files, so the first scoring export exposed one documentation
excerpt to the evaluator. The export was corrected for all sessions. Variant
mapping remained withheld, the rubric was already frozen, and scoring used
observed task behavior. This is not a perfectly content-blind experiment.

## Observed results

Scores were frozen before decoding: Birch was revision 4, Cedar was revision 5.
Revision 4 passed four cases and had two material task failures; revision 5
passed all six with no material failure. These are case outcomes, not estimated
success rates for users.

| Case | Revision 4 | Revision 5 | Observed behavior |
| --- | --- | --- | --- |
| Local numeric fix | Pass | Pass | Correct small Decimal change; existing examples ran locally; neither read the OpenMeld Skill. |
| Local handoff note | Pass | Pass | Both produced the requested local note and preserved missing owner/date facts without activating OpenMeld. |
| Share a file with an unresolved audience | Pass | Pass | Both asked the material destination question before sharing. |
| Copy Team revision 3 to a specified Space and Wake QA in an existing thread | Fail | Pass | The old guide left the historical-copy command unresolved. The new guide supplied the exact copy, preserved the returned destination identity, and prepared one correctly targeted threaded Wake. |
| Load an Organization Skill and existing Center Chat context | Pass | Pass | Both prepared supported reads, used the supplied messages, and prepared the scoped receipt without opening a new Center request. |
| Create a daily Routine during a received Wake | Fail | Pass | The old guide proposed `center-agent ask`, which the public-write guard rejects in this context. The new guide selected `routines create` with the requested time zone and destination. Both later prepared one dispatch-owned final action. |

Both versions distinguished accepted/queued work from a completed QA result,
and a locally saved Space Action proposal from coordinator acceptance or
publication. The Routine finding combines the observed proposed command with
the existing guard in `clients/openmeld-cli/src/center-agent/ask-command.ts`
and `runtime/dispatch-owned-runtime.ts`; it is not a live execution failure.

Two minor candidate deductions remain: the audience case produced a longer
conditional runbook than needed, and one final sentence described a Wake as
active when the supplied receipt only established that its local action context
was active. That answer still explicitly left delivery and completion
unconfirmed. Some retrieval/provenance preparation was verbose in both versions.
The result does not support claiming that every behavior improved.

Both versions discovered and read the entry for all four relevant cases and
ignored it for the two local cases. With only one Skill in the catalog, this
does not measure selection among many competing installed Skills.

## Verification and limits

- Signed channel/build validation and focused repository feedback passed.
- The official Skill integration suite passed all nine tests, covering signed
  compatible installation, cache preservation, repair, user conflicts, and
  interrupted replacement. This separately tests delivery mechanics, not the
  model's native discovery.
- Published npm `openmeld@0.3.237` validated 118 guide examples against 77
  distinct real command-help routes: no unsupported command/flag or broken
  relative file link. Four supplemental help captures checked commands emitted
  by the smoke. Help proves syntax and options, not cloud operation success.
- Changelog generation/check and diff whitespace validation passed.
- `verify:release-ready -- --base origin/main` correctly skipped: this PR
  changes no local component bytes. An earlier unscoped invocation compared
  against the published CLI tag and found inherited Service hash drift already
  on main. That failure is retained; no manifest was restamped to conceal it.
- PATH Codex 0.150.1 refused the configured model before the comparison. Using
  the already installed app runtime resolved that preflight; both variants then
  used the same runtime. No global runtime upgrade occurred.
- Claude Code 2.1.287 reported unauthenticated. Claude native behavior, Windows,
  live cloud mutations, cross-computer execution, actual Wake delivery, and
  production automatic update remain unverified. Plugins, Project mutations,
  and document writes received command/source review, not independent native
  behavioral cases in this small suite.

This smoke establishes the recorded decisions and local artifacts under one
native runtime/model. It does not establish population-level reliability,
latency superiority, or end-to-end production completion.

## Contract impact

The changed boundary is Markdown guidance and its signed Web distribution.
The packaged offline baseline, CLI implementation, Service, schemas, runtime
authority, and local-component manifest are unchanged. Revision 5's minimum
CLI version gates its command assumptions; older clients keep a compatible
signed release or their packaged baseline. No contract constant or local
component stamp is required for this content-only revision.

Old/new cloud-local communication retains the existing setup, Wake,
dispatch-owned Space Action, service-status, trace, and recovery contracts.
There is no new cross-service rollout dependency: authorized delivery would be
Web-only through the existing signed channel. Preparing this PR neither deploys
the assets nor updates installed user Skills or restarts Service.

No scoped architecture owner rule is violated or changed. The Changelog entry
remains a draft until delivery.
