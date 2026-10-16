# October 14 model catalog review

Reviewed PR #1710 at `c7d1f1505b13efdfe038644e44b16db5362e20e3`.

## Final scope: two additional routes

Add only Liquid LFM2.5-24B-A2B and Pareto 26.9 through OpenRouter. Both
completed native inference. Defer Zen Gemini and both Cat Jam routes after
the provider-boundary diagnosis below, as requested by the owner. This does
not retire these models globally or remove any previously cataloged route.

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
The existing catalog test compares the two admitted IDs, availability and
reasoning options against this independent capture. The three deferred records
remain under `deferredModels`, separate from admitted test inputs.
Version 1.19.0 is the observed compatibility
floor, not a claim about the earliest upstream release that supports them.
Both admitted entries receive New. Defaults and existing selections are preserved.
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
| Gemini through Zen | Native `ProviderModelNotFoundError`, wrapped as a generic error; paid Zen credential is not configured |
| Cat Jam through Zen | Denying tools produces HTTP 403 `FreeTierError`; repeating with tools requiring approval returned `MODEL_OK`, stop/exit 0 |
| Cat Jam through Go | Native logs show an active Go subscription is required; repeated upstream rejections explain the bounded probe timeout |

An initial concurrent probe hit OpenCode's local database lock. Zen and Go
probes were repeated sequentially. Follow-up diagnosis used native CLI logs
and a controlled Cat Jam permission comparison. All probes bypassed OpenMeld.

### Provider-boundary diagnosis

- **Zen Gemini:** `opencode auth list` lists OpenAI, OpenRouter and Go, but no
  Zen credential. The paid Gemini route appears only when metadata enumeration
  is enabled with a placeholder; that does not authenticate execution. At
  `2026-10-14T02:18:19Z`, native logs exposed
  `ProviderModelNotFoundError: Model not found: opencode/gemini-4-argon`.
  The generic outer error was not a demonstrated provider outage. Defer this
  new route because this environment cannot validate paid Zen access.
- **Go Cat Jam:** the failed native sessions log
  `AI_APICallError: Upstream request failed: An active OpenCode Go subscription is required to use Go models.`
  The CLI retries this upstream account rejection. This is not an OpenMeld
  timeout or proof that the model is globally unavailable. Defer the new route.
- **Zen Cat Jam:** the original all-tools-denied probe changed the outgoing
  tool set. Repeating with `permission: {"*":"ask","edit":"deny"}` in the
  same empty directory returned `MODEL_OK` without tool use at
  `2026-10-14T02:18:06Z`. This isolates a permission-dependent upstream
  free-tier restriction, not a bad model ID or failed OpenMeld serialization.
  [Upstream issue #51241](https://github.com/anomalyco/opencode/issues/51241)
  describes the same deny-versus-ask behavior. Defer this route per the owner's
  instruction rather than weakening OpenMeld permissions to satisfy free-tier
  eligibility. Neither user settings nor the OpenMeld adapter were changed.

The installed version is 1.19.0, also the latest release returned by GitHub's
stable-release endpoint during this review. The upstream issue includes V2
reports too; an unrelated harness migration is not justified for this catalog
change. No OpenMeld adapter defect was established.

These provider/account outcomes do not establish global model withdrawal.
OpenMeld create/edit and Wake acceptance remain unverified; the admitted
routes have native inference and catalog-contract evidence, not end-to-end
product acceptance. No deployment is requested.

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
Deployment and production Wake are outside this review's execution scope.
