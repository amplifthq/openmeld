# Wake Provider Failure Copy Review

## Agent Context

- Purpose: Preserve the evidence and copy mapping from one provider-account
  failure investigation.
- Read this when: Revisiting provider rejection classification or public Wake
  failure copy.
- Update this when: New production evidence changes the mapping.
- Do not use this for: Current execution truth or provider availability.
- Source of truth: Owner documents and code own current behavior; this file
  owns only the dated investigation evidence.

Date: 2026-07-03
Status: INVESTIGATION CLOSED — root cause was an upstream provider account
failure; copy changes shipped. Remove this file when the provider-failure
copy rules are absorbed into an owner document, or after the copy has been
stable in production long enough that this evidence no longer changes actions.

## Investigation

The production Wake failure for `wake-speed-test-opencode` was an upstream
OpenCode Zen/provider account failure, not a Space, Queue, Core, or daemon route
failure.

Evidence:

- Daemon dispatch journal for dispatch
  `f08e2524-b73c-4af7-a03c-8288cc04d64e` recorded `errorCode:
  upstream_unreachable`, `errorType: adapter`, and `errorMessage:
  upstream_unreachable: Insufficient Balance`.
- The matching OpenCode log recorded `AI_APICallError: Insufficient Balance`
  for provider `opencode` and model `deepseek-v4-flash-free`.
- The same source event produced successful Codex and Claude Code results, so
  the failure was controller/provider-specific.
- A later manual terminal run of the same model succeeded. That does not
  contradict the earlier failure: OpenCode Zen is still a provider-backed route
  with account, billing, credit, and monthly-limit controls, even for free
  models.

## Mapping

| Failure class | Detection inputs | Public copy |
| --- | --- | --- |
| Provider insufficient balance | `provider.insufficient_balance`, `quota.exceeded`, `insufficient_quota`, safe diagnostic phrases such as `Insufficient Balance`, `not enough credits`, or `payment required` | The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing, then wake the agent again. |
| Provider auth invalid | `auth.required`, credential/login codes, safe diagnostic phrases such as `invalid API key`, `invalid token`, `unauthorized`, or `not logged in` | The model provider rejected this request because the provider credentials are invalid or expired. Reconnect the provider account, then wake the agent again. |
| Provider rate-limited | `provider.rate_limited`, `provider.rate_limit`, `rate_limited`, `rate_limit`, or safe diagnostic phrases such as `429`, `rate limit`, or `too many requests` | The model provider rate-limited this request. Wait a moment or raise the provider limit, then wake the agent again. |
| Provider unreachable | `upstream_unreachable`, provider/network/unavailable codes, or safe diagnostic phrases such as provider connection refusal or provider/network timeout | The model provider was unreachable. Check provider status or network access, then wake the agent again. |

Raw provider or adapter error messages remain diagnostic evidence. Space-visible
copy is derived from the shared whitelist mapping.

## Implementation Notes

- `packages/schemas/src/public-agent-failure-reason.ts` remains the shared
  source of truth for public failure recovery copy.
- `packages/space-mesh/src/agent-failure-reason.ts` now delegates detailed
  provider-message classification to the shared schema package instead of
  maintaining a separate whitelist.
- OpenCode now classifies `Insufficient Balance` as
  `provider.insufficient_balance`.
- Codex, Claude Code, and OpenClaw quota classifiers now recognize common
  balance/credit/payment phrases as quota failures.
- Existing result payload fields are reused. No new schema field is required.

## Contract Impact

No payload shape changed. New runtimes may send the more specific
`provider.insufficient_balance` code; older Core versions still match it as a
provider-class failure. New Core versions can also classify old runtime payloads
that only include `upstream_unreachable` plus a safe balance phrase in
`errorMessage`.

Old CLI x new Core and new CLI x old Core therefore remain interoperable. The
only behavior change is safer, more actionable public failure copy.

## Verification

- `pnpm --filter @openmeld/schemas test -- public-agent-failure-reason.test.ts`
- `pnpm --filter @openmeld/space-mesh test -- agent-failure-reason.test.ts`
- `pnpm --filter @openmeld/core test:boundary -- dispatch-publication-policy.test.ts`
- `pnpm --filter @openmeld/adapter-opencode build`
- `pnpm --filter @openmeld/adapter-opencode test`
- `pnpm --filter @openmeld/schemas check`
- `pnpm --filter @openmeld/space-mesh check`
- `pnpm --filter @openmeld/adapter-opencode check`
- `pnpm --filter @openmeld/adapter-codex check`
- `pnpm --filter @openmeld/adapter-claude-code check`
- `pnpm --filter @openmeld/adapter-openclaw check`
- `pnpm --filter @openmeld/core check`
- `git diff --check -- packages/schemas packages/space-mesh services/core runtime/adapters developing`
- `pnpm run verify:release-ready`

`pnpm run verify:release-ready` initially reported a stale
`release/local-components.json` `service.bundleHash`. The manifest was re-stamped
as an advisory local component update, then the release-ready gate passed.

## Production Validation

Not run in this branch. After deployment, wake `wake-speed-test-opencode` again
in the production Space and verify the Space failure notice says the provider
account does not have enough credits, without showing the raw `Insufficient
Balance` provider text.
