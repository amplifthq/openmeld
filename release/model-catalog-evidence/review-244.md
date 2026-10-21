# October 21 model catalog review

PR #244 originally contained five evidence snapshots and no catalog changes.
Compared with the committed October 18 review, its new model facts are three
MiniMax M3.1 Flash routes and two Space Bunny deprecation markers.
This review admits one route, corrects native model inventory handling, and
preserves existing defaults and selections.

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
inference at every level or access for every account.

The OpenMeld acceptance run exposed a Service bug: its OpenCode parser rejected
native IDs containing additional slash-separated segments. A captured, sanitized
OpenCode 1.19.0 `/provider` record now exercises the existing readiness test.
The test failed before the parser correction. The corrected inventory also
reaches the existing 256-model report bound on this account. Shared compatibility
policy therefore treats omission from a saturated report as inconclusive and
uses its existing version-floor or unknown-evidence policy. Positive matches and
catalog-wide unavailability retain their precedence. Unsaturated aligned reports
still establish absence. No model is substituted.

Contract Impact Audit:

- CLI and Service 0.3.266 are available updates. Native inventory parsing changes;
  command, setup, Wake, Space action, trace and self-rescue payloads do not.
- The shared schema retains the same 256-model bound and wire shape. Its bound
  is now a shared constant, used by producers and compatibility consumers.
  No CLI, Service, Skills or execution contract epoch changes are needed.
- Old cloud and new local components accept the same payloads, but old cloud
  can still incorrectly reject a model omitted from a full report. Release Core
  and Web compatibility consumers before distributing the corrected Service.
  New cloud works with old Service reports; the affected nested model still
  needs the available Service update to be reported. Existing setup and Wake
  remain usable throughout; no mandatory floor increase is justified.
- Gateway and Skills are unchanged. A future release includes Core, Web and
  local CLI/Service artifacts. This PR does not authorize production deployment.
- No scoped architecture ownership rule is violated. The online catalog remains
  Core-owned, local inventory is compatibility evidence, and RuntimeCoordinator
  retains Wake execution authority. The Changelog entry remains unpublished.

## OpenMeld Wake acceptance

On October 21, an isolated PostgreSQL development lane used a fresh test account
and private Space. Public CLI commands created and connected an OpenCode Agent
with `openrouter/minimax/minimax-m3.1-flash:free` and `low` reasoning, added it to
the Space, and sent Wake request `pr244-minimax-wake-20261021-a`.

The Agent published exactly `OPENMELD_WAKE_OK_244` through the OpenMeld reply
action. The browser's thread showed the reply. Public `service trace` reported
`delivered=true`, `visibleOutcome=visible_reply`, `status=succeeded`, and matched
the published signal. Dispatch `8e31d3b7-d764-4b06-9be2-8965537adfed` links to
reply `6dcbdfdf-4f21-4e26-a511-23a80589c81e`.

During development, package rebuilds restarted the local Workers and interrupted
the first binding attempt. Public profile setup restored the connection before
the successful Wake; no database or projection edits supplied the result.
This proves the selected route, reasoning level, local execution and visible
publication for this account. It does not establish other accounts' provider
access or production deployment. Focused check results are recorded on the PR.
