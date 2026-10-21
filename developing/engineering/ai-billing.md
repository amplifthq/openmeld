# Hosted AI credits and workspace keys

## Agent Context

- Purpose: Define hosted AI funding, native limits, and workspace credentials.
- Read this when: Changing AI credits, BYOK, provider admission, or running real AI smoke tests.
- Update this when: Funding policy, secret ownership, or rollout contracts change.
- Do not use this for: Local controller token estimates, payments, or release authorization.
- Source of truth: Core billing service owns admission and credit holds; OpenRouter native key limits are the backstop; this file owns the operator and product contract.

## Ownership and product contract

Core owns workspace funding selection, key encryption, and admission. For
platform funding, usage receipts and credit holds in `ai_usage_records`
participate in admission (see [Admission and credit holds](#admission-and-credit-holds)).
OpenRouter owns the provider spend counter and its native key limit remains the
enforcement backstop. Receipts are not a second wallet: they never mint, carry
over, or refund credits. No payment processor or paid plan is active.

- A creator's first workspace receives 5,000 credits each UTC calendar month.
  Credits do not roll over. One credit represents $0.001 of provider-reported
  inference cost under policy `2026-10-v1`; tokens vary by model, cache, and output.
- The grant belongs to the creator and its original workspace. Deleting that
  workspace retains the consumed grant. Additional workspaces require BYOK.
- Owner/admin members can save, replace, or remove one workspace OpenRouter
  inference key in App settings → AI usage. All members share this funding
  choice, including Center Agent, Remote Agent, and their model helpers.
- BYOK takes precedence. An invalid, exhausted, or revoked BYOK stops requests;
  it never falls back to sponsored usage. Removing it restores the existing
  sponsored key and its remaining monthly balance, without resetting credits.
- AI usage shows one compact funding card. Its key action opens a separate
  settings dialog. BYOK changes the card title, badge, and masked suffix.
  Current BYOK funding displays recorded usage in USD; platform funding displays
  credits. Totals, axes, tooltips, and model/agent details use the same unit.
  Switching the source changes presentation, not historical attribution or
  balances. Details explain that historical BYOK credit equivalents do not
  debit the included balance. Local controller statistics remain token counts.
- Every workspace uses Free or BYOK, including the operator's own workspace.
  There is no internal exemption or uncapped sponsored key provisioning.

`organization_ai_credentials` stores encrypted keys separately for `byok`,
`free`. Free keys have native `limit: 5, limit_reset: monthly`.
Retired `internal` credential rows are ignored. Historical usage attribution and
database migrations retain that value so existing records remain readable.
The retained grant and a transaction advisory lock prevent concurrent first use
from creating multiple active sponsored keys. A provider/DB failure can leave an
orphan upstream key; operators reconcile by its `openmeld:<organization>:<source>`
name. Never rotate or recreate an existing key to recover a balance error.

Native limits have propagation delay and can overshoot for already admitted
requests, so they are a backstop, not the concurrent admission control.
The UI must not promise an exact hard maximum or a fixed token count. Changing
the monthly grant or conversion is a versioned product policy change: document
its effective date, update existing provider keys deliberately, and do not
silently reinterpret historical receipts.

## Admission and credit holds

Admission policy versions:

| Version | Effective | Platform-funded admission |
| --- | --- | --- |
| `provider-counter` | 2026-10-19 | Live OpenRouter `GET /key` `limit_remaining > 0` per request. Concurrent requests could jointly overdraw. |
| `credit-holds` | Deployment of migration `0048_ai_credit_holds` | Per-workspace reservation against the local ledger, described below. |

The grant size and the 1 credit = $0.001 conversion are unchanged; historical
receipts keep their meaning. BYOK and local runtimes are not reserved.

**Hold estimate.** Before Core admission, the Remote Agent metered fetch reads
the exact request body and sends `providerAuthorizationVersion: 2` with a
`creditHold`. The hold is 1.25 × (estimated prompt tokens × input price +
requested `max_tokens`/`max_completion_tokens` × output price + server research
fees). Prompt tokens are UTF-8 body bytes ÷ 3 plus 6,000 tokens per image; the
higher OpenRouter price band applies once the estimate reaches its threshold.
Server web search and fetch tools share one OpenRouter step budget,
`max_tool_calls` (default and maximum 30; web research sends 3). Each step adds
retrieved content, another model pass, and a per-call fee of the selected
engine, which is separate from model token prices. Search may use every step,
because `max_uses` binds only Anthropic native search:
the direct `openrouter` fetch engine is free; search with `auto` or `native`
reserves the larger of the model's native search fee and the Exa fallback
(OpenRouter falls back to Exa for models without native search). Engines without
a reviewed fee fail closed. Pro variants reserve their output cap twice. Prices come
from the reviewed table in `services/remote-agent/agent-core/ai-credit-hold.ts`;
a test keeps it equal to the captured OpenRouter prices and requires a price for
every hosted catalog model. The 1.25 margin covers price drift between reviews
and estimate error.

The estimate is `unavailable` for an unreviewed model, a body without an output
cap, fallback model lists, plugins, multiple choices, or an unknown server tool.
Core then rejects platform funding with `ai_usage.credit_hold_unavailable`
(HTTP 402) before provisioning or calling the provider. A BYOK workspace ignores
the estimate. Every hosted request must therefore send an explicit output cap.

**Reservation.** Core takes a transaction-scoped advisory lock
`ai-credit-reservation:<organization>` and computes, for the current UTC month,
`available = 5,000 credits − committed`. Committed spend sums remote
platform-funded rows: a provider-reported cost when present, otherwise the hold
while it has not expired. Core reads the clock after acquiring the lock and
stores it as the hold's admission time; a held request belongs to the month in
which Core admitted it, even when the Remote Agent observed it just before
midnight. Rows recorded before migration `0048` have no
`funding_source` column value and are matched by their stored `fundingSource`.
Holdless legacy pending rows count nothing. Core inserts the pending record and
its hold in the same transaction, so concurrent begins see each other's holds.

- A **new task** (no earlier platform hold for the same execution attempt this
  month, or no attempt ID) needs `available ≥ 300 credits` and
  `hold ≤ available`. It also reads the live provider balance first, outside the
  lock, after a local pre-check. Under the lock it subtracts what that read may
  have missed: requests admitted after the pre-check, and requests the pre-check
  saw unsettled, at their hold or, once settled, their actual cost. It then uses the
  smaller of the local and provider balances. This keeps the provider
  configuration check, covers usage the local ledger cannot see, and stops
  concurrent new tasks from reserving the same provider remainder.
- A **continuation** of an attempt that already holds platform credits is
  admitted while `available > 0`, even when its hold exceeds the remainder. This
  one-request grace keeps high-frequency tool loops from stopping one call short.
  It skips the live provider read: measured `GET /key` latency was about
  0.45–0.77 s per call (12 calls, 2026-10-21), paid on every tool-loop request
  under the earlier policy.

A rejected reservation returns the existing `ai_usage.monthly_limit_reached`
error and writes no record. The lock covers one aggregate query and one insert;
the provider read is never made while holding it. Lock waits are bounded by a
5 s `lock_timeout`, which fails the request rather than admitting it.

**Settlement and expiry.** Settlement replaces the hold with the
provider-reported cost; the hold columns remain as admission evidence. A
settlement without a cost (`unavailable`, `collection_failed`) keeps counting its
hold. Every hold without a reported cost, pending or settled, stops counting 30
minutes after admission. The row stores the admission time, not an expiry, so the window is
read-time policy. Normal settlement takes seconds, and the durable outbox retries
transport failures. Expiry was chosen over a reconciliation job so a lost
settlement cannot permanently lock a workspace out of its credits; the native key
limit still charges the true cost.

**Residual overshoot.** Concurrent admission cannot jointly exceed the local
allowance, nor the provider balance net of the holds Core knows about. The remaining bounded overshoot is: one continuation's hold past zero;
an actual cost above its estimate (the 1.25 margin makes this unlikely for priced
text, but an unusual tokenizer or server-tool result can exceed it); costs of
expired or unknown-cost holds after 30 minutes; and, in the rollout month only,
continuations of tasks that the local ledger cannot fully see; and the
provider's own propagation delay for costs settled before a new task's pre-check. Each is capped by
the OpenRouter native key limit, which keeps its own propagation delay.

The monthly aggregate scans that workspace's remote rows for the month through
`ai_usage_records_org_time_idx`. Revisit it with a per-period total if larger
paid allowances make those scans material.

## Configuration and open-source boundary

The implementation, schemas, migrations, conversion policy, and tests can all be
public. No private billing repository is required. Deployment secrets and account
data stay outside Git:

| Core setting | Purpose |
| --- | --- |
| `OPENROUTER_MANAGEMENT_API_KEY` | Creates sponsored inference keys; never sent to a client or Remote Agent. |
| `OPENMELD_AI_CREDENTIAL_CRYPTO_KEY` | Base64-encoded 32-byte AES-GCM key. Back up and retain it with the encrypted database. |

Public examples contain empty values. Do not commit credentials, provider key
hashes, real receipts, database exports, environment dumps, or
smoke logs. Sanitizing future public Git history is a separate release task.
Encryption-key replacement needs explicit re-encryption of existing rows; simply
changing the environment value makes their keys unavailable and fails closed.

Remote Agent receives the current inference key only through its trusted Core
service binding, immediately before each request. The key is not retained in
model registrations, durable outboxes, usage rows, public RPC responses, or logs.
Requests are restricted to the configured OpenRouter completion endpoint and
use manual redirects so credentials cannot follow a redirect. When Cloudflare
AI Gateway is configured, requests use explicit workspace authorization and no
stored official BYOK alias. Without a configured gateway, they use OpenRouter
directly. Partial gateway configuration is an error.
The common metered fetch sets `HTTP-Referer: https://openmeld.ai` and
`X-OpenRouter-Title: OpenMeld` for both platform-funded and BYOK requests, including
Center Agent and Remote Agent helpers. These headers follow OpenRouter's
[app attribution contract](https://openrouter.ai/docs/app-attribution).
The same boundary owns request `metadata`: `openmeld_organization_id`,
`openmeld_funding_source`, and `openmeld_purpose`. These stable identifiers apply
to both funding sources. Organization names and user details are not sent.
Do not use the end-user `user` field or the routing `session_id` field as a
tenant label. Keep the public app title and referer identical across tenants.
OpenMeld receipts remain the cross-organization reporting source: a customer's
BYOK activity belongs to their OpenRouter account, not the platform account.
The fields use OpenRouter's
[chat completion metadata contract](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).
Custom metadata support does not guarantee a dashboard filter or grouping.
Compare platform cost and customer-funded usage separately. Organization-scoped
managed keys provide upstream reconciliation for Free usage.

## Operator rollout

This change does not enable or alter a production deployment by itself. Before
an authorized rollout, provision the management and encryption secrets in Core's
deployment secret store. Keep their
values out of Wrangler files. Apply the PostgreSQL migration first, deploy Core
and Gateway, then Remote Agent and Web in the same maintenance window. Remote
workers without `providerAuthorizationVersion` fail closed. Version 1 supports
BYOK only; platform credits require version 2 with a `creditHold` (see the
credit-hold order below). Missing configuration also stops sponsored requests. Do not roll back to workers that
can use an unmetered official alias. A safe rollback keeps the new admission gate
or pauses hosted inference. Local Service and CLI are not part of this protocol.

The former daily allowance table remains historical evidence. Its operator
script is retired and its rows no longer authorize inference. The AI usage card
shows the provider-native key balance; admission also applies credit holds, so
a workspace can be refused while the card still shows a small remainder. BYOK
costs remain visible in the all-model-cost chart but never reduce included
credits.

Credit holds need migration `0048_ai_credit_holds` (`funding_source`,
`credit_hold_nano_usd`, `credit_hold_admitted_at_ms`: three nullable columns and a
check constraint, no backfill), then Core, then Remote Agent. Core must be first:
earlier Core rejects the new `creditHold` field. Between the Core and Remote
Agent deployments, version 1 workers keep BYOK requests working while
platform-funded requests stop with `ai_billing.provider_authorization_required`.
Rolling Remote Agent back to version 1 pauses platform-funded inference instead
of bypassing holds.

## Verification boundary

For ordinary real BYOK smoke, use the shared development key described below.
Use disposable provider keys for tests that change limits, revoke credentials,
or exercise provisioning, and use a local PostgreSQL/Worker lane. Verify native
monthly configuration, a zero-cap rejection, restoration with propagation delay,
concurrent first use, BYOK save/replace/remove, member permissions, cross-workspace
isolation, ignored retired credentials, unavailable secrets, and no fallback. Exercise
both Agent entry points with real model calls. Check receipts and upstream key
usage separately. A configured reset timestamp is not proof of an observed
calendar rollover. Delete all disposable keys after the smoke.

## Shared development BYOK smoke key

Authorized developers and agents can retrieve the reusable inference key from
Doppler project `openmeld-core`, config `dev`, secret `OPENROUTER_SMOKE_API_KEY`.
Use it for local real-model smoke and Center/Remote Agent development. When the
task already authorizes real AI testing, retrieve this key instead of asking
the user to supply a new one. If access fails or the key is unavailable, report
that blocker; do not substitute production credentials.

This is a normal OpenRouter inference key, not a management key. It is a test
input, not a Worker environment binding or an automatic funding fallback. Its
presence in Doppler does not configure BYOK in a local workspace. Keep it out
of the runtime environment allowlists and production secret synchronization.

For a manual browser setup, copy only this secret without printing its value:

```sh
doppler secrets get OPENROUTER_SMOKE_API_KEY \
  --project openmeld-core --config dev --copy >/dev/null
```

Run with shell tracing disabled. For automation, capture the single-secret
command's output with `--plain` instead of `--copy` in private process memory,
and pass it directly to the password
input through the browser tool. Never return the value in tool output, embed it
in a command argument, or save it in a file, screenshot, trace, PR, or chat.
Do not dump the whole Doppler config. Clear the copied value after use without
overwriting newer clipboard content.

1. Start an isolated local PostgreSQL lane using the
   [development workflow](development-workflow.md). Core needs its development
   `OPENMELD_AI_CREDENTIAL_CRYPTO_KEY` to encrypt the saved BYOK. Keep that key
   stable while retaining the local database. BYOK does not need the production
   Management key.
2. Sign up or sign in through the local product and use an owner/admin in the
   test workspace. Open **App settings → AI usage → Use your own key**, paste
   the smoke key, and save. Verify the **BYOK** badge and masked suffix. Each
   new disposable database/workspace needs this setup once.
3. Send a short prompt through each relevant real entry point: Center Agent and
   Remote Agent. Use an inexpensive supported model and a bounded task budget.
   Verify the visible answer and persisted usage with `fundingSource: byok`;
   check provider request IDs and reported cost when testing attribution or
   accounting. A saved badge alone does not prove a real model call. Do not mock
   billing/provider responses for this acceptance path.
4. Record only non-secret results and the actual test cost. Remove the workspace
   BYOK or discard the local database when the disposable test ends, and stop
   the task-owned development processes. A retained local development workspace
   can keep its encrypted BYOK for later authorized development.

Do not delete, rotate, exhaust, or change limits on this shared upstream key as
smoke cleanup. Failure/limit tests must use separately authorized disposable
keys. Do not treat the smoke key as a grant to run unbounded AI tasks or use it
in staging or production.
