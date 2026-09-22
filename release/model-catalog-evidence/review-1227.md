# Reviewed local model integration: PR #1227

The September 22 catalog scan replaced closed PR #1138. Its five JSON
snapshots contain discovery evidence, not automatic support claims. This
review records the subsequent authenticated integration and local acceptance.
It is not production deployment evidence.

## Catalog decisions

| Controller | Added model ID | Captured native evidence |
| --- | --- | --- |
| Cursor | `grok-4.7[context=256k,reasoning_effort=high,fast=true]` | Cursor 2026.09.18-9a7762b ACP `session/new` returns the exact compound ID in both model configuration and legacy inventory. Reasoning is part of the ID. |
| Grok Build | `grok-4.7`, `grok-4.7-build-fast` | Grok Build 1.0.40 ACP initialization and session inventory return both IDs and `low`, `medium`, `high`, `xhigh` efforts. |
| OpenCode | `opencode/mimo-v2.6-flash-free` | OpenCode 1.18.31 authenticated `models opencode --refresh --verbose` returns the active free model, without variants. |
| OpenCode Go | `opencode-go/grok-4.7` | The authenticated Go inventory returns the active model with `low`, `medium`, `high`, `xhigh` variants. |
| OpenCode Go | `opencode-go/mimo-v2.6-flash`, `opencode-go/mimo-v2.6-pro` | The authenticated Go inventory returns both active models without variants. |

These seven choices receive the catalog-owned `New` badge. The captured vendor
fields are retained in
`packages/schemas/tests/fixtures/local-model-catalog-2026.09.22.json`; catalog
tests compare exact IDs and efforts against that external response.

OpenCode's old default, `opencode/mimo-v2.5-free`, is absent from the refreshed
inventory and a direct invocation reports `ProviderModelNotFoundError`.
The new free model succeeds, so the online default moves to
`opencode/mimo-v2.6-flash-free` and the retired entry becomes unavailable.
Stored explicit selections are not rewritten; the existing unavailable-model
fallback contract applies. Grok Build's default remains Grok 4.6.

The discovered `opencode/deepseek-v4.1-flash` route is deliberately not added:
it was absent from this account's free-provider inventory. The separate,
existing `opencode-go/deepseek-v4.1-flash` route remains supported. Codex Astra
and Sol and Claude Code Fable 5/5.1 were already catalog choices.

## Native execution and OpenMeld acceptance

Both Grok Build additions and all four OpenCode additions returned
`LOCAL_MODEL_OK` from actual native invocations. Grok's ACP response confirmed
the selected exact model ID and `end_turn`; OpenCode completed with `stop`.

Cursor's exact model can be selected, but direct named-model execution is
blocked by this account's Free-plan restriction: only Auto is permitted.
Successful Cursor inference is not claimed, and no account plan or native
default was changed for this acceptance.
An OpenMeld Cursor Profile accepted and persisted the exact model. Its Wake
also ended in an explicit failure, not a Space reply. The public trace reported
missing reply/silence intent, rather than the native CLI's account restriction;
those observations are recorded separately and do not establish one root cause.
The corrected reply-tool prompt used client message
`33375354-9851-47ae-9c07-c94c6d6fec2f`, target
`agt_a420a10e-07f6-4197-99bd-4caa23b6bff3`, and failure signal
`c1e5e04e-5418-4433-ad51-c59a7d84fbaf`.

The full OpenMeld check used a disposable local worktree lane, seeded account,
normal Web/CLI login and setup, and its own OpenMeld Service. It did not use
production state or internal mutations:

- Web creation displayed all four new OpenCode choices. Grok exposes its four
  reasoning levels; switching back to MiMo clears the inapplicable effort.
  Creating an OpenCode Agent with MiMo V2.6 Flash Free and refreshing its page
  preserved the model.
- A Grok Build Agent was created through the public CLI with Grok 4.7/low.
  Web editing showed both new models; saving Grok 4.7 Fast/low survived refresh.
- Explicit Wakes to Grok 4.7 and MiMo V2.6 Flash Free produced visible Space
  replies, `GROK_LOCAL_WAKE_OK` and `MIMO_LOCAL_WAKE_OK`. Grok's one-time read
  and reply tool permissions were approved through the normal Web prompt.
  Public `service trace` reported `delivered=true`, `visible_reply`, and
  `reply.delivered` for both.

The isolated Space was
`f171757545b41f5ff8a0aea45645f46c4f6f6511395e57c548370733ddc3ed55`.
Trace selectors and published replies:

| Model | Client message | Target Profile | Reply signal |
| --- | --- | --- | --- |
| Grok 4.7 | `4127a2f2-fab8-4fd5-a0b1-99ebea5abefd` | `agt_c0264cea-a8ac-4635-80e1-6ed4f6103d42` | `006c5121-65c5-4304-83ec-0e8085756cc6` |
| MiMo V2.6 Flash Free | `bb56a0e4-0c71-412d-a49a-6b8ede8fb8c3` | `agt_0dc523af-76c5-42fd-8d8a-5ba15eae3eb7` | `a26b958b-7c97-4433-ab92-bdee25f2dbad` |

These are representative end-to-end checks, not a claim that every new model
completed an OpenMeld Wake. All six non-Cursor additions have separate native
execution evidence.

## September 23: Claude Opus 5.5

The [official Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
introduces `claude-opus-5-5` in 2.1.280. The
[Anthropic effort contract](https://platform.claude.com/docs/en/build-with-claude/effort)
supports `low`, `medium`, `high`, `xhigh`, and `max` for this model.
The local catalog adds that exact ID and version floor without changing the
default. A temporary official 2.1.280 installation was used for an invocation;
OAuth authentication failed before inference. The user explicitly requested
skipping further Claude Code execution testing. Local inference and a Local
Agent Wake are therefore unverified, not successful.

The live [OpenRouter catalog](https://openrouter.ai/api/v1/models) exposes
`anthropic/claude-opus-5.5`, including tools, 1M context, 128K maximum output,
and `high` effort. The captured response is retained in
`services/remote-agent/tests/fixtures/openrouter-opus-5.5-2026-09-23.json`.
Center and Remote share this route with OpenMeld's existing 16,384 output
budget. The catalog schema tests (9) and hosted adapter tests (15) pass,
including serialized tool continuation against the captured capabilities.

In the same disposable local lane, the Center Agent's Anthropic picker offered
Opus 5.5; saving and refreshing preserved the selection. The public CLI saved
the personal Remote Agent's selection, and its Web Profile displayed Opus 5.5.
Both normal Web conversations completed tool continuations and visibly replied.
Provider completion logs confirm the exact Opus 5.5 ID, tool-use responses,
and final text responses; public CLI history confirms publication:

| Agent | Space | Reply signal | Reply text |
| --- | --- | --- | --- |
| Center | `f2f20c8548eeb08001cc3d8a0bf451799a1278bc9be3f8a2a3d8241848300e4c` | `94086553-7fad-43af-aef5-461947e2a28a` | `OPUS_55_CENTER_OK` |
| Remote | `a92ecf5d627d7901f5af0a791cb50bc84ea500a03de6a4cc6e627589714ceb97` | `abacbd79-00de-4c9d-ac49-885a72531fc2` | `OPUS_55_REMOTE_OK` |

## Contract and rollout

The local additions change the online catalog served by Core. The fixed CLI
offline snapshot is unchanged. There are no new schema fields, protocol flags,
Binding writers, runtime authorities, database changes, or contract epochs.
Existing model availability checks still intersect catalog choices with the
computer's native inventory. The scoped architecture rules remain satisfied.

The same PR also adds six hosted models, including Opus 5.5, and shared Fluid
Provider/Model selectors for Center Agent and Remote Agents. That shared
catalog mapping needs Core deployed before Web. Model catalog tests (9),
shared selection tests (8), Core catalog tests (2), Changelog validation, and
the source CLI build pass. Hosted validation is recorded in the PR description.
