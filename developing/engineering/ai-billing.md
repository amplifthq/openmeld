# Hosted AI credits and workspace keys

## Agent Context

- Purpose: Define hosted AI funding, native limits, and workspace credentials.
- Read this when: Changing AI credits, BYOK, provider admission, or exemption configuration.
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

Use disposable provider keys and a local PostgreSQL/Worker lane. Verify native
monthly configuration, a zero-cap rejection, restoration with propagation delay,
concurrent first use, BYOK save/replace/remove, member permissions, cross-workspace
isolation, ignored retired credentials, unavailable secrets, and no fallback. Exercise
both Agent entry points with real model calls. Check receipts and upstream key
usage separately. A configured reset timestamp is not proof of an observed
calendar rollover. Delete all disposable keys after the smoke.
