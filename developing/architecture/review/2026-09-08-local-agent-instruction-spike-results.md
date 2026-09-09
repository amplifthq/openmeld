# Local Agent Instruction Spike Results

## Agent Context

- Purpose: Record the local evidence and selected instruction changes from the September 8 investigation.
- Read this when: Reviewing the local candidate or deciding whether to expand native instruction/tool integration.
- Update this when: Remaining smoke evidence changes or the candidate is superseded.
- Do not use this for: Production acceptance, release authorization, or certification of all local harnesses.
- Source of truth: This review owns experiment observations only; Local Service and transport owner documents retain runtime authority.

Status: Selected local candidate validated; not committed or released. Remove after durable decisions are incorporated and the change is delivered or superseded.

Follow-up: The subsequently authorized Staging run synchronized to `ff41a6cdf` and exercised four models through real Space tasks. See [Staging smoke results](2026-09-08-local-agent-instructions-staging-smoke.md) for the newer candidate and observed tool-discovery correction. The baseline and versions below describe the earlier local experiments.

## Scope and decision

Worktree: `codex/local-agent-instructions-v2`, based on freshly fetched `origin/main` at `7ba073872`. The existing working directory's unrelated changes were preserved. No commit, push, or deployment was requested.

The experiments justify targeted improvements to the existing content owner, not replacing all instructions or migrating production from MCP to Dynamic Tools. Existing carriers, model settings, permission modes, conversation identity, privacy/language rules, raw replies, status/silence, and publication authority remain in place.

Selected changes:

1. One short Wake workflow in the stable instruction layer and complete fallback. User/Guide/attachment/history text retains its task-data provenance. Ordinary native user input does not duplicate that workflow.
2. Completion requires the actual permitted action and inspection of its result. Acknowledgement means a recorded proposal, not publication. A confirmed rejection before recording can follow tool correction guidance; an unknown outcome must not trigger another action, including an error-report reply.
3. Suggested send-target lines omit the acting Agent. The complete member projection remains unchanged for independent validation. Plain replies omit extra targets; incoming activation targets are not outgoing handoffs.
4. Generated context-reading commands use the existing quoted `OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH` entry instead of relying on a shell's PATH. Human-facing maintenance commands retain their lane command.

## Codex protocol experiments

Installed Codex: `0.150.1`. Tests launched the real `codex app-server` with experimental API negotiation, a disposable working directory, read-only sandbox, and synthetic tasks. They used the existing authenticated account and created new test threads; no pre-existing user conversation was resumed or edited. This differs from the proposed temporary-CODEX_HOME setup: the tested threads reside in the normal local Codex session store and may appear in history. Global provider configuration was not edited.

Marker outcomes are behavioral observations paired with actual request fields; they are not a claim that model self-report establishes instruction hierarchy.

| Case | Observed result | Consequence |
| --- | --- | --- |
| New thread with developer marker ALPHA | ALPHA | Creation-time carrier works in this version. |
| Loaded resume with marker BETA | ALPHA | Do not rely on resume to replace stable instructions. |
| Cold process resume with marker GAMMA | ALPHA | Same restriction after reopening. |
| Custom collaboration marker DELTA, next turn omits mode | DELTA in both turns | A per-turn request field is not automatically turn-scoped. |
| Custom Plan marker, then explicit null Plan instructions | PLAN_CUSTOM, then STABLE | Explicit null removed the custom marker in this probe; this is not certification of every native Plan behavior. |
| Return to Default with null instructions | STABLE | No production mode override was adopted. |
| Fork with FORK_CUSTOM override | STABLE | Existing instruction-replacement restriction remains appropriate. |
| Dynamic tool invocation and cold resume without re-registering | Both calls delivered to the client | Tool definitions persist; stale-dispatch protection is still required. |

The principal lifecycle probe thread was `01a07eb2-4e5f-7912-805d-bf33255f229a`. Compaction and native subagent inheritance were not tested. Other harnesses received source/carrier review, not fresh real-provider certification in this experiment. No new carrier capability is enabled on that basis.

## Prompt comparison and fault injection

Each ordinary comparison used the same synthetic arithmetic task and model (`gpt-5.6-sol`), with native and full-fallback input variants. Dynamic callbacks recorded only local synthetic acknowledgements; these are not Space delivery tests.

- Initial baseline/native and baseline/fallback both called `reply` once. A longer candidate also succeeded in both, but added tokens and did not improve latency. It was reduced rather than claimed as an improvement.
- Compact comparison: baseline native 20.36 s / 57,623 total tokens; baseline fallback 17.42 s / 57,396; candidate native 21.35 s / 57,823; candidate fallback 23.42 s / 57,661. All four called `reply` once. These whole-run totals include provider context and cached input; the sample is too small to establish efficiency or success-rate gains.
- A `gpt-5.4-mini` reply-only probe with optional target arrays produced one target-free reply in both old and new variants. It did not reproduce the reported production self-Wake; the misleading target listing itself is deterministically reproduced by the regression test.
- With a failed tool response stating outcome unknown, the first candidate called `reply` twice, using its second call to report the error. After explicitly forbidding an additional error-report action, two subsequent probes made one call each and ended with the diagnostic. This is bounded evidence for clearer guidance, not a guarantee against model mistakes.

Production evidence supplied by the separate release task: a pure reply from Codex mini included its own profile in `wakeTargets`; the tool acknowledged, Core rejected `selfTrigger`, and finalization retried. That task owns action validation and terminal failure handling. The two-file suggested-target correction was handed over separately; this candidate does not modify the action writer or Core finalization.

## Real local Space tests

Lane `wt-97f537190b45`; Web port 31168, Gateway 31169, Auth 31170. All OpenMeld state used this worktree's explicit isolated `OPENMELD_HOME`. A synthetic account logged in through the normal Web UI and approved CLI device login. Public CLI operations created real Agent Profiles and a private test Space; seeded fake agents were not used as runtime proof.

Space: `67ddae2efa91bb9b87f8323dfd868ab27011de7e27fd2c970e33991f44db21f5`.

| Run | Evidence | Result |
| --- | --- | --- |
| Ordinary reply: 37 × 19 | Dispatch `30cef3c3-20aa-4b16-b912-a5b7bd74e8ba`; published signal `1c7e6370-0cd1-44c2-b3b6-14ab770d8b70` | Trace `visible_reply`; browser showed 703. |
| Continued thread: distribute 703 across seven days | Dispatch `963835c4-8eba-4745-a12a-66095afad9e0`; published signal `5a59fc27-5d84-4d36-979c-737ed340fad9` | Trace `continued` / `reused`; browser thread showed 101,101,101,100,100,100,100. |
| Attachment before command-entry correction | Dispatch `3ef96df9-a9a4-446e-8923-80a7048d6af0` | Login shell found a stale global openmeld-dev launcher; Service lifecycle trouble later blocked Stop. Ultimately visible failure (`runtime.progress_stale`), not a successful audit. |
| Retry on original Agent | Dispatch `1d4aaba8-5b75-486b-ad67-f0fc2fe3ff5d` | Queued behind disconnected execution; cancellation requested, then browser showed stopped. |
| Final candidate, fresh real Agent, same CSV audit | Dispatch `30fd5e95-deb0-4aaa-8c57-4b8c13fa83e8`; published signal `3532989a-b2e7-420d-8e4d-ad6e1717f357` | Real shared file read, 25 paid orders / $26.25 / duplicates ORD-004 and ORD-017; one MCP reply without targets, trace `visible_reply`, browser confirmed. |
| Final candidate continuation with exact output | Dispatch `b1085c39-0631-4df9-8baa-1355f7ea3612`; published signal `f2528488-e8ae-43d8-b2b3-8801ea93ab1d` | Trace `visible_reply`, `continued`, and `reused`; browser thread preview showed exactly `25 \| $26.25`. |

The CSV includes a note telling an assistant to answer privately. The task explicitly treats notes as data. Success must include reading the actual shared revision, correct computation, one submitted reply, and visible publication; a private answer alone is insufficient.

The final run used Codex thread `01a07ed5-fa07-71f0-a740-d926f7bf1563`. Its first file command used the injected absolute dispatch entry. The sandbox denied creation of a local session lock; the same exact read was then approved once through the normal Space permission UI and succeeded. The model did not repeat the stale-installation search. This proves correct entry selection and the approved read path, not permission-free file access or a statistically faster end-to-end run.

Chrome and the in-app browser initially blocked the local URL. Agent Browser supplied the authenticated UI lane. An old global dev launcher pointed to a removed worktree. The isolated managed Service later showed lifecycle/bundle drift; stopping and repairing it preserved the failed case. The final validation uses a foreground Service after repair. None of these environment failures is evidence that the prompt passed.

Firsthand friction was recorded through the authorized production feedback Space as signal `fd1d0b2f-d921-4ae3-ba38-9da9cb8d06fe`. It contained synthetic diagnostic details only. Production infrastructure was not used for test Wakes.

## Validation and compatibility

- Focused prompt/action/target/runtime/bootstrap-state tests: 100 passed.
- Codex adapter tests: 106 passed.
- CLI TypeScript and changed-file Biome checks passed.
- Packaged CLI build, base-aware local-component stamp, and `verify:release-ready` passed. Candidate version 0.3.169 is local, not a published release claim.
- Changelog entry remains draft; generated projections validate.

Contract Impact Audit: changed surfaces are model-visible instructions, suggested targets, and the already-supported dispatch CLI entry used in commands. No wire schema, action schema, Core transport, permission, readiness, identity, or publication owner changes. Old cloud/new local and new cloud/old local retain the same setup, Wake, actions, diagnostics, and repair protocols. Older local components retain the previous guidance but remain compatible. CLI and Service are stamped `available`; the required floor is unchanged. No deployment order dependency is introduced. Stable instruction content changes its hash; existing epoch-mismatch fallback remains the supported path for older conversations.

Architecture review: no scoped owner rule is violated. RuntimeCoordinator still owns execution; Core validates/publishes; Service carries local execution and records proposals. The prompt does not authorize an action or suppress a real failure.

## Dynamic Tools decision

Dynamic Tools lets Codex ask OpenMeld directly to execute a named function, with typed arguments, rather than asking an MCP subprocess. It could remove that subprocess, but does not inherently improve reply correctness or eliminate instruction context. The protocol works in the isolated probe; no production Dynamic Tools transport was added. A production candidate still needs shared writer/schema reuse, active-dispatch binding, cancellation, stale-thread/turn rejection, and reconciliation after disconnect. Blind fallback to MCP after an ambiguous submission remains unsafe. Keep the current MCP transport until that additional implementation has a demonstrated benefit.
