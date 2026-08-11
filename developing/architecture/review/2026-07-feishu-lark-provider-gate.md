# Feishu and Lark Provider Gate Evidence

## Agent Context

- Purpose: Preserve the redacted provider evidence used to gate the first Lark
  and Feishu Message Channel implementation.
- Read this when: Revalidating Lark or Feishu registration, permissions,
  Webhook reachability, SDK assumptions, or production enablement.
- Update this when: A provider gate is rerun, the pinned SDK or registration
  protocol changes, or new redacted evidence changes a gate result.
- Do not use this for: Claiming production readiness, defining the durable
  Message Channel contract, or storing provider credentials and raw payloads.
- Source of truth: The linked provider responses and pinned package metadata own
  external facts; this file owns only the dated redacted gate result. OpenMeld
  product and architecture owner documents own durable behavior.

Date: 2026-07-18; production availability decision updated 2026-07-20;
registration creation recovery revalidated 2026-07-21

Status: PARTIAL PASS — Lark registration and Channel permission passed. Lark
setup is now available in production by explicit product decision, without a
claim of live delivery proof; application configuration and Webhook evidence
remain pending. Feishu remains disabled. Remove this file when every open gate
is either closed or rejected and the final evidence is distilled into the owner
documents.

This document records the redacted evidence required by Gate 0 of
`design-plans/feishu-lark-message-channel-implementation-plan.md`. It is not a
production-readiness claim. No production connection, provider credential,
Queue, D1 row, callback route, or model execution was created.

## Pinned external implementation

The reviewed official package is:

- package: `@larksuiteoapi/node-sdk`;
- version: `1.71.1`;
- npm publication: `2026-07-14T12:41:57.714Z`;
- npm `gitHead`: `1711494d0cb848b93472f03fb1e8f5366122bcf7`;
- npm integrity:
  `sha512-Z4cZmgWvwiE7tCHqGm+t7DKvbpNRRTH2HqVwcYiOMAwbjIytXSoQqWytsOVu3p+d0fIvrtyIPZok5HOV/VNxxw==`;
- tarball SHA-256:
  `1760f68b449fafbf0e88ee101970a0077c8d57729e259565b7c21edc825bffbc`.

The npm metadata is preserved in
`scripts/lark-platform/fixtures/sdk-package-1.71.1.json`. The public package
exports the long-running `registerApp()` helper. Its resumable `begin` and
`poll` protocol is not a public SDK API, so OpenMeld isolates the
vendor-derived endpoint contract in
`scripts/lark-platform/provider-gate.mjs` and fails closed on unknown
responses.

## Lark result

### Personal Agent registration: pass

A new OpenMeld-owned development app was created from the Personal Agent QR
flow in a real Lark development tenant. The result reported:

- a Lark tenant brand;
- an App ID and App Secret;
- the consenting operator open ID;
- a usable tenant access token with a 7,200-second expiry.

Secrets, token values, operator identity, and the real App ID remain only in
mode-`0600` ignored files under `dev-tmp/`.

The resumable implementation was then exercised against the same development
app:

1. one process called the Feishu registration `begin` endpoint and persisted
   the device code, five-second interval, one-hour expiry, expected brand, and
   current poll host;
2. an independent process performed one Feishu-domain `poll` request and
   received the Lark brand signal;
3. the persisted poll host changed to `accounts.larksuite.com` without a
   recursive request;
4. another independent process performed one Lark-domain `poll` request and
   received the app credential;
5. the credential was written to a separate mode-`0600` file.

Captured, redacted registration shapes live in
`scripts/lark-platform/fixtures/registration-*.lark.json`. Unit tests prove
`authorization_pending`, `slow_down`, expiration, denial, unknown-response
failure, expected-brand validation, and the one-platform-request-per-command
rule.

One provider quirk is now explicit: starting `begin` directly against
`accounts.larksuite.com` produced a launcher link that the Lark surface
reported as expired. Starting at `accounts.feishu.cn` and following the
provider-returned Lark domain switch succeeded. The implementation therefore
does not select the initial registration host from the expected brand.

On 2026-07-21, the production launcher configuration was rerun in the same real
Lark tenant after the provider page had once shown `Couldn't create app`. The
following fresh registration links all created a new app and returned
credentials: the base launcher; `createOnly` without addons; the exact
Channel-only addons without `createOnly`; the exact addons with `createOnly`;
and the exact production name, description, addons, and `createOnly` values.
The original browser-side failure was therefore not reproducible as a stable
parameter, permission, tenant, or app-name defect. OpenMeld keeps the verified
Channel-only launcher parameters unchanged.

The provider page does not send that generic browser-side creation failure back
through the registration poll protocol. Core can continue to receive only
`authorization_pending`, while Web would otherwise keep presenting a truthful
but unhelpful wait. The product recovery is an explicit pending-attempt restart
that issues a fresh setup link; ordinary begins remain resumable. No provider
credential, App ID, operator identity, or raw response from this revalidation
is tracked in the repository.

### Channel-only permission template: pass

The real QR flow used `addons.preset: false`. Lark presented and granted only
the requested bot/channel capabilities. The application scope API returned
exactly these ten granted tenant scopes:

```text
cardkit:card:read
cardkit:card:write
im:chat.members:bot_access
im:chat:read
im:message
im:message.group_at_msg:readonly
im:message.p2p_msg:readonly
im:message:readonly
im:message:send_as_bot
im:resource
```

The Developer Console read-back showed exactly:

- `im.message.receive_v1`;
- `im.chat.member.bot.added_v1`;
- `im.chat.member.bot.deleted_v1`;
- `card.action.trigger`.

No Calendar, Mail, Meetings, Tasks, approval, attendance, OKR, tenant
administration, or document-workflow permission was present. The selected
Lark permission mode is therefore `channel_only`, bundle version
`channel-only-2026-07-18`.

### Application configuration and Webhook: pending

The QR-created app currently uses the platform's default persistent-connection
mode. Application-config Patch, configuration read-back, one real message
event, and one real card callback require a live development HTTPS probe.
They are intentionally not claimed from a dry-run bundle or an inactive
callback hostname.

The 2026-07-20 product decision makes Lark setup available to every production
Organization before this live probe can be run. That decision supersedes the
earlier rollout restriction on `OPENMELD_LARK_CHANNEL_ENABLED` and
`OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS`; it does not supersede the connection
truth boundary:

- no live production Lark delivery is claimed by this configuration change;
- credential receipt alone must not present a connected Channel;
- Core must still verify application configuration plus the Event Subscription
  URL and Message Card Request URL separately for the specific connection
  before it reports `connected`;
- WebSocket remains a development harness, not an automatic fallback.

## Feishu result

Feishu did not pass Gate 0. The currently available account lacks the required
Feishu API qualification and no qualified mainland tenant/network test lane
was available. Therefore none of the following is claimed:

- Feishu Personal Agent credential completion;
- Feishu `preset: false` permission read-back;
- Feishu application-config Patch or Webhook receipt;
- the required 100 message events and 30 card callbacks across three mainland
  test windows;
- mainland delivery, acknowledgement, retry, or callback SLO measurements.

`OPENMELD_FEISHU_CHANNEL_ENABLED` must remain disabled and
`OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS` must remain empty. This blocked
brand does not block dormant shared contracts or the independently gated Lark
implementation.

## Worker SDK compatibility result

Wrangler `4.110.0` successfully bundled the exact official SDK with
`nodejs_compat` and compatibility date `2026-02-03`. The spike references:

- public message and card-action normalizers;
- the OpenAPI Client;
- message resource download and image upload methods;
- the high-level CardKit streaming entry point.

The dry-run output was:

```text
Total Upload: 4878.83 KiB / gzip: 357.32 KiB
No bindings found.
```

This proves bundle compatibility only. Real workerd execution, real Feishu and
Lark normalization parity, CardKit mutation, and media transfer are still
pending. Product code must prefer a small Worker-native adapter unless the
remaining runtime checks justify importing an official public subset. It must
never import `WSClient` into a request-scoped Worker.

## Commands

Deterministic checks:

```sh
pnpm run test:lark-platform-provider
pnpm run verify:lark-platform-sdk-bundle
```

Guarded real-provider registration uses one independent command per platform
poll:

```sh
pnpm run verify:lark-platform-provider -- \
  --action begin \
  --provider lark \
  --environment development \
  --app-id <development-app-id> \
  --callback-host <development-callback-host> \
  --state-file <ignored-private-state-file>

pnpm run verify:lark-platform-provider -- \
  --action poll \
  --provider lark \
  --environment development \
  --app-id <development-app-id> \
  --callback-host <development-callback-host> \
  --state-file <ignored-private-state-file> \
  --credential-file <ignored-private-credential-file>
```

The command rejects non-development environments, implicit or local callback
hosts, explicitly known production App IDs, explicitly known production
callback hosts, provider mismatches, early polls, expired state, incomplete
credentials, and unknown provider responses.
