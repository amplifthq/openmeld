# October 14 model catalog review

Reviewed PR #1710 at `c7d1f1505b13efdfe038644e44b16db5362e20e3`.

## Five additional routes

OpenCode 1.19.0 returned these exact IDs and native variant keys through
`opencode models <provider> --verbose --pure`. Zen metadata was refreshed
with a noncredential `OPENCODE_API_KEY=catalog-metadata-placeholder` to expose
paid model metadata. That placeholder was not used for execution probes.

| Native ID | Native variant keys |
| --- | --- |
| `opencode/gemini-4-argon` | `low`, `medium`, `high` |
| `opencode/cat-jam-free` | `low`, `medium`, `high`, `xhigh`, `max` |
| `opencode-go/cat-jam-free` | `low`, `medium`, `high`, `xhigh`, `max` |
| `openrouter/liquid/lfm-2.5-24b-a2b` | None |
| `openrouter/unbiased/pareto-26.9` | None |

The vendor-shaped capture is
`packages/schemas/tests/fixtures/opencode-model-catalog-2026.10.14.json`.
The existing catalog test compares IDs, availability and reasoning options
against this independent capture. Version 1.19.0 is the observed compatibility
floor, not a claim about the earliest upstream release that supports them.
All five entries receive New. Defaults and existing selections are preserved.
Liquid's API can produce reasoning, but OpenCode exposes no separate variant
keys for this route; do not invent effort options from its API capabilities.

Official sources checked on October 14:

- [OpenCode model endpoints](https://opencode.ai/v2/docs/console/models/)
- [OpenCode Go model endpoints](https://opencode.ai/v2/docs/console/go/)
- [Liquid LFM2.5-24B-A2B](https://openrouter.ai/liquid/lfm-2.5-24b-a2b)
- [Pareto 26.9](https://openrouter.ai/unbiased/pareto-26.9)
- [OpenRouter model API](https://openrouter.ai/api/v1/models)

`openrouter/~unbiased/pareto-latest` is not added. Its official route follows
the newest Pareto model; the reviewed addition pins `pareto-26.9` instead.

## Native execution

Probes used the installed OpenCode 1.19.0, an empty working directory,
external plugins disabled with `--pure`, permission set to deny, and the prompt
`Reply with MODEL_OK only. Do not use tools.` Existing account access was used.
Gemini and Cat Jam requested the `medium` variant.

| Route | Observed result |
| --- | --- |
| Liquid through OpenRouter | Returned `MODEL_OK`, finish reason `stop`, exit 0 |
| Pareto through OpenRouter | Returned `MODEL_OK`, finish reason `stop`, exit 0 |
| Gemini through Zen | Native error: `Unexpected server error. Check server logs for details.`, exit 1; no successful inference |
| Cat Jam through Zen | HTTP 403 `FreeTierError`: `OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building.`; no successful inference |
| Cat Jam through Go | No result within the bounded probe; execution remains unverified |

An initial concurrent probe hit OpenCode's local database lock. Zen and Go
probes were repeated sequentially; the table records the sequential results.
These upstream/account or unresolved execution outcomes do not establish
global model withdrawal. Neither catalog membership nor native inventory is
an account entitlement guarantee. OpenMeld create/edit and Wake acceptance
remain unverified; this PR stays Draft.

## GPT-5.5 retirement recheck

The [official notice](https://learn.chatgpt.com/docs/models#gpt-55-retirement)
still announces October 14 retirement for Codex with ChatGPT sign-in, with
API access excluded. No official postponement was established.

At `2026-10-14T02:04:04Z`, Codex CLI 0.162.1 reported `Logged in using ChatGPT`.
A native request with `--model gpt-5.5 --ignore-user-config --ephemeral
--skip-git-repo-check --sandbox read-only --json` and the prompt
`Reply with OK only. Do not use tools.` completed successfully:

```json
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":23236,"cached_input_tokens":2432,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

Decision: **withdrawal unconfirmed; requested model still executes for the
tested account**. Keep `retirement.status: announced` and `unavailable: false`;
update the notice source and verification time. This is not proof of continued
access for every account, of a postponed retirement, or of API retirement.
Do not replace saved GPT-5.5 selections or alter the Codex default.

## Contract and delivery scope

Validation passed: catalog schema and captured model contracts (16 tests),
runtime model selection (14 tests), model-catalog collector/publication
(15 tests), the schemas build, and `pnpm run verify:pr -- --feedback`
(strict docs, Changelog, changed-file Biome and focused catalog tests).

Online catalog data only. No adapter, SDK, schema shape, dispatch protocol,
runtime ownership, database, offline catalog or local component change.
Existing clients consume the same catalog contract; the reviewed notice retains
its ChatGPT-only scope. This violates no scoped architecture ownership rule.
Eventual delivery selects Core only. Changelog entry remains unpublished.
No merge, deployment, or production Wake was performed.
