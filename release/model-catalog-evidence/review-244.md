# October 21 model catalog review

PR #244 originally contained five evidence snapshots and no catalog changes.
Compared with the committed October 18 review, its new model facts are three
MiniMax M3.1 Flash routes and two Space Bunny deprecation markers.
This review admits one route and preserves existing defaults and selections.

## Verified addition

`openrouter/minimax/minimax-m3.1-flash:free` returned `MODEL_OK`, finish reason
`stop`, and exit code 0 through native OpenCode 1.19.0 on October 21.
The request used `--pure --format json --variant low` in an empty temporary
directory. All tool permissions were denied, sharing and automatic updates
were disabled, and no tools ran. Existing provider access was used without
changing credentials.

Native inventory declares text output, tool calling, and the exact variants
`low`, `medium`, `high`, `xhigh`, and `max`. OpenCode 1.19.3, the current stable
npm release, reports identical variant objects for all three candidate routes.
The newer executable ran through an isolated npm invocation; the global
installation and repository dependencies are unchanged. Version 1.19.0 is an
observed compatibility floor, not a claim about the earliest supporting release.

The sanitized native record and probe result are retained in
`packages/schemas/tests/fixtures/opencode-model-catalog-2026.10.21.json`.
The existing catalog contract test now compares this record with the authored
ID and reasoning options. It failed before the catalog addition.

## Deferred routes

| Route | Observed result | Decision |
| --- | --- | --- |
| `opencode/minimax-m3.1-flash-free` | HTTP 403 `FreeTierError` on both 1.19.0 and 1.19.3, despite native execution | Defer until the provider accepts the native request |
| `opencode-go/minimax-m3.1-flash-free` | HTTP 401 `api_key_expired` on 1.19.0 | Defer until account access is restored and verified |

The free-tier response says requests must originate within OpenCode; these
probes did use OpenCode. This establishes a provider rejection, not its cause.
The Go response requires a replacement key; signing in again does not renew
the key. No credentials were changed. Neither result proves global model
withdrawal, and neither authorizes a fallback model.

## Other review decisions

- Preserve `opencode/space-bunny-free` and `opencode-go/space-bunny`. Discovery
  marks them deprecated and current native inventory omits them, but no scoped
  official withdrawal notice was established. Neither has a stale New label.
- Preserve Codex Sol and Luna minimum version 0.155.1. The bundled catalog's
  0.155.0 hint does not replace the previously captured execution evidence.
- GPT-5.5 remains withdrawn for Codex ChatGPT sign-in only. The current official
  notice agrees with review #237. API-key access and saved selections remain
  unchanged; there is no new retirement-policy change in this PR.
- Claude Code 2.1.303 release notes contain reliability fixes, not a new model
  contract. Cursor and Grok Build source content is unchanged. No additions
  are justified for those controllers.
- Cost, context-limit, open-weight, and family metadata changes do not change
  OpenMeld's local model-selection contract. Do not copy marketplace reasoning
  options into other providers or hosted policy.
- Creation defaults, CLI offline catalog, adapter code, and hosted models are
  unchanged. The admitted model receives New and precedes older releases.

Sources rechecked on October 21:

- [OpenCode Console models](https://opencode.ai/v2/docs/console/models/)
- [OpenCode Go](https://opencode.ai/v2/docs/console/go/)
- [Codex GPT-5.5 retirement](https://learn.chatgpt.com/docs/models#gpt-55-retirement)
- Native `opencode models --pure --verbose` on 1.19.0 and 1.19.3.

## Acceptance and delivery boundary

The native probe proves inference for this account and one reasoning level.
Native enumeration establishes the remaining option names, not successful
inference at every level. This review does not claim a browser create/edit
smoke, an end-to-end OpenMeld Wake, or access for every account.

Contract Impact Audit: catalog data only. Shared schema shapes, CLI, Service,
Skills, Core, Gateway, Web, setup, Wake, Space actions, and diagnostics retain
their current contracts. No scoped architecture ownership rule is violated.
The online catalog remains Core-owned and does not become execution or
Wakeability authority. Future delivery selects Core only; no local-component
release is needed. The Changelog entry remains unpublished.

Focused check results are recorded on the PR. No merge or deployment is part
of this update.
