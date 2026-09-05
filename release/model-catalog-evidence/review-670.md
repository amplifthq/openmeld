# Reviewed local model integration: PR #670

The original automated JSON snapshots remain unchanged. This review records
the subsequent integration decisions; it is not production release evidence.

## Catalog decisions

| Harness | Added choices | Evidence |
| --- | --- | --- |
| Codex | `gpt-6-astra` | Codex 0.153.4 app-server `model/list` returned the exact ID and six reasoning efforts, including `ultra`; a direct low-effort invocation returned `OK`. Official minimum: 0.153.0. |
| Claude Code | `claude-fable-5-1` | Captured official Claude Code documentation and discovery metadata establish the ID, five efforts and minimum 2.1.255. Installed 2.1.259 meets that minimum; execution remains unverified because OAuth refresh failed. |
| Cursor | `claude-fable-5-1[thinking=true,context=300k,effort=high]`, `gemini-3.8-flash[reasoning_effort=high]` | Cursor 2026.09.02-c22c1a3 authenticated ACP `session/new` returned these exact compound IDs. No independent reasoning field is added. Named-model execution was rejected by the account's Free-plan restriction. |
| OpenCode | `openai/gpt-6-astra`, `openai/gpt-6-astra-fast`, `opencode/muse-spark-1.3-contributor-free`, `opencode-go/muse-spark-1.3-contributor`, `opencode-go/omen-alpha` | OpenCode 1.18.29 `models <provider> --verbose` returned active entries. Catalog efforts use its exact variant keys. Astra has no `ultra`; Muse variants stop at `xhigh`; Omen exposes `low` and `high`. The OpenAI invocation failed token refresh with 401. |

All nine additions receive the catalog-owned `New` badge. No client infers
release age, removes badges automatically, or changes execution from a badge.

Codex keeps runtime default `gpt-5.6-sol` and creation recommendation Sol/high.
Claude changes runtime default from Opus 4.8 to `claude-opus-5`, with explicit
creation recommendation Opus 5/model-default reasoning. Existing explicit
Profile selections and remembered creation preferences are not rewritten.
Claude Profiles with an unset model will now resolve to Opus 5.

## Deliberately not added or changed

- Cursor Astra: absent from the observed ACP model inventory.
- OpenCode Zen Astra, Fable 5.1, Gemini 3.8 Flash and paid Muse Spark 1.3:
  marketplace discovery did not match the observed local provider inventory.
- Grok Build: no new candidate in the configured discovery scope.
- GPT-5.4 availability: the official restriction is ChatGPT-sign-in specific;
  it is not sufficient evidence to mark the models globally unavailable.
- Existing Codex minimum versions: left unchanged rather than tightening
  compatibility for existing choices as a side effect of this addition.

## Validation and delivery boundary

Schema validation, Core creation-default tests, existing Profile creation
integration tests, Center Agent settings tests and Web type checking pass.
An isolated browser using the production model-selector component and authored
catalog confirms the badge in both list and trigger, removal when switching to
Sol, and the Claude Opus 5 default with model-default reasoning. This browser
fixture saves no Profile and does not prove an authenticated OpenMeld Wake.

Before production acceptance, restore Claude/OpenCode credentials, use a Cursor
account that permits named models, and verify actual OpenMeld create/edit/Wake
paths in the release lane. Native Codex success is separate from OpenMeld Wake
success. No default or credential in the user's installed harness was changed.

## Contract impact and batch handoff

No new shared fields, adapter flags, RPC, Binding, setup, dispatch or Service
lifecycle contract is introduced. `badgeLabel` already exists in the shared
catalog schema; older UI may omit its presentation. Core still owns creation
policy and remembered preferences. The local model selector reads the same
catalog and compatibility projection as before. Scoped architecture ownership
is unchanged; no contract epoch or required update floor is warranted.

The catalog is embedded in the CLI/Service fallback, so the release owner must
stamp the combined batch's exact local-component sources and use the CLI
release lane plus the affected Web deployment. This leaf PR does not stamp,
merge, request a separate Final Candidate, deploy, or publish. Keep #670 as the
discovery-to-delivery record and attach final batch/release/smoke evidence here.
