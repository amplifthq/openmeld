# October 18 model catalog review

Reviewed the evidence-only proposal in PR #237. This review adds eleven
OpenCode routes and confirms GPT-5.5 withdrawal for Codex ChatGPT sign-in.
Defaults, saved selections, hosted model policy and the CLI offline snapshot
remain unchanged.

## Admitted routes

Each route below returned `MODEL_OK`, a native `step_finish` with reason
`stop`, and exit code 0 on October 18. Probes used OpenCode 1.19.0 in an empty
directory, `--pure`, JSON output, and the prompt
`Reply with MODEL_OK only. Do not use tools.` No probe executed a tool.
Permissions required approval and denied edits; sharing was disabled.
Existing provider access was used without changing credentials.

| Native route | Native reasoning variants | Tested variant |
| --- | --- | --- |
| `opencode/beam-free` | low, medium, high, xhigh, max | low |
| `opencode/deepseek-v4.1-flash-free` | low, high, max | low |
| `opencode/nemotron-3.5-super-vl-free` | none, minimal, low, medium, high, xhigh | low |
| `openrouter/deepseek/deepseek-v4.1-flash-1017` | none, low, high, max | low |
| `openrouter/elorian/glimpse` | low, medium, high | low |
| `openrouter/meta/muse-spark-open` | low, medium, high, xhigh | low |
| `openrouter/nvidia/nemotron-3.5-super-vl` | low, medium, high | low |
| `openrouter/nvidia/nemotron-3.5-super-vl:free` | low, medium, high | low |
| `openrouter/reflection/beam-1.0-501b-a23b` | low, medium, high, xhigh, max | low |
| `openrouter/unbiased/pareto-26.10` | None | Model default |
| `openrouter/xingchen-agi/xing4.0-29b-a4b:free` | low, medium, high | low |

All eleven native inventory records declare text output and tool calling.
The retained native fields and probe receipts are in
`packages/schemas/tests/fixtures/opencode-model-catalog-2026.10.18.json`.
This capture extends the existing catalog contract test; expected variant
keys come from native output, not the authored catalog.

OpenCode 1.19.3, the latest stable release at review time, was also run through
an isolated npm executable. Its native variant keys match 1.19.0 for all
fourteen candidates. No global installation or project dependency changed.
The catalog records 1.19.0 as the observed compatibility floor, not the earliest
possible supporting version. New entries follow captured release dates in
descending order and receive `New`; discovery date is not release date.

Sources checked:

- [OpenCode model endpoints](https://opencode.ai/v2/docs/console/models/)
- [OpenCode Go](https://opencode.ai/v2/docs/console/go/)
- [OpenCode 1.19.3 release](https://github.com/anomalyco/opencode/releases/tag/v1.19.3)
- The exact native `opencode models --verbose` records, with a second
  `opencode models --pure --verbose` capture using 1.19.3.

Provider restrictions still apply. For example, the official Beam Free notice
limits regional access. A successful probe does not promise access for every
account, region or future date. These results prove native inference and exact
catalog parameters, not OpenMeld create/edit or a production Wake.

## Deferred Go routes

`opencode-go/beam-free`, `opencode-go/gemini-4-argon-contributor`, and
`opencode-go/step-5-preview` are present in native inventory. Each execution
returned HTTP 401 with `api_key_expired`. The response instructs the account
owner to create a replacement key in OpenCode Console; signing in again does
not renew it. Do not add these routes until account access can be verified.
This account failure does not establish global model unavailability. Existing
Go entries and credentials are unchanged.

## Existing discovery changes

The seven reasoning changes concern uncataloged OpenRouter routes:
Claude Haiku 5.5, DeepSeek V4.1 Flash, Ember 1, Gemini Nano Banana 2.1,
Ternary Bonsai 2 27B, and the two DeepSeek latest aliases. They do not change
an existing OpenMeld selection. Do not copy API reasoning values into unrelated
Zen, Go, native Claude Code or hosted entries. No product change is justified
from these discovery-only updates.

The seven lifecycle changes concern Zen Exo Free, Ling 3.0 Flash Fin Free,
Ling 3.1 Flash Free, Muse Spark 1.3 Contributor Free, Step 5 Preview Free,
Go MiniMax M2.7 and Go Step 5 Preview Free. The discovery source marks them
deprecated and current native enumeration omits them. Neither fact establishes
a scoped withdrawal. Preserve all existing identities and availability;
remove the stale `New` labels from Exo Free and both Step 5 Preview Free routes.
No official withdrawal notice was established for these seven routes.

## GPT-5.5: confirmed scoped withdrawal

The [official notice](https://learn.chatgpt.com/docs/models#gpt-55-retirement)
specifies October 14 at 19:00 UTC for Codex ChatGPT sign-in, excluding API-key
sessions. The October 14 probe in review #1710 preceded that effective time;
its success does not establish a postponement.

On October 18, Codex CLI 0.162.1 reported `Logged in using ChatGPT`.
An ephemeral, read-only native request with user configuration ignored returned
HTTP 400 and `The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.`
The turn failed with exit code 1. The sanitized response is retained in
`packages/schemas/tests/fixtures/codex-gpt55-withdrawal-2026.10.18.json`.

Change `retirement.status` to `withdrawn` for `builtin:codex` / `chatgpt` only.
Keep global `unavailable: false`, the exact model ID, API-key access, defaults
and saved selections. The runtime test exercises the authored catalog with
ChatGPT, API-key and unknown authentication, and verifies no silent fallback.

## Validation and delivery boundary

Focused catalog contract tests, runtime model-selection tests, collector and
publication tests, and the schemas build passed. Repository feedback checks
and hosted Final Candidate status are recorded on the PR.

Contract Impact Audit: catalog data only; no schema shape, adapter, dispatch,
database or local-component contract changes. Existing readers consume the
same strict schema and scoped-retirement mechanism. No scoped architecture
ownership rule is violated. Future delivery selects Core only.

The Changelog entry is unpublished. No production credentials changed, no
merge or deployment occurred, and no end-to-end OpenMeld Wake is claimed.
