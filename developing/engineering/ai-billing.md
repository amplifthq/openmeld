# Hosted AI credits and workspace keys

## Agent Context

- Purpose: Define hosted AI funding, native limits, and workspace credentials.
- Read this when: Changing AI credits, BYOK, provider admission, or running real AI smoke tests.
- Update this when: Funding policy, secret ownership, or rollout contracts change.
- Do not use this for: Local controller token estimates, payments, or release authorization.
- Source of truth: Core billing service and OpenRouter native key limits own admission; this file owns the operator and product contract.

## Ownership and product contract

Core owns workspace funding selection, key encryption, and admission. OpenRouter
owns the spend counter and enforcement. Usage receipts are an audit projection;
they do not debit a second wallet. No payment processor or paid plan is active.

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
requests. They are a practical abuse cap, not a strict concurrent reservation.
The UI must not promise an exact hard maximum or a fixed token count. Changing
the monthly grant or conversion is a versioned product policy change: document
its effective date, update existing provider keys deliberately, and do not
silently reinterpret historical receipts.

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
and Gateway, then Remote Agent and Web in the same maintenance window. Old Remote
workers fail closed until they send `providerAuthorizationVersion: 1`; missing
configuration also stops sponsored requests. Do not roll back to workers that
can use an unmetered official alias. A safe rollback keeps the new admission gate
or pauses hosted inference. Local Service and CLI are not part of this protocol.

The former daily allowance table remains historical evidence. Its operator
script is retired and its rows no longer authorize inference. Use provider-native
key status for balances and usage receipts for attribution; BYOK costs remain
visible in the all-model-cost chart but never reduce included credits.

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
