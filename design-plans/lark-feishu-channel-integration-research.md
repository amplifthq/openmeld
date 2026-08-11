# Lark and Feishu Channel Integration Research

## Agent Context

- Purpose: Preserve a dated external-platform research snapshot for evaluating
  a possible Lark and Feishu channel integration.
- Read this when: A formally authorized channel-design task needs the vendor
  evidence and tradeoffs gathered on 2026-07-17.
- Update this when: The vendor contracts materially change before that design
  is approved, or new authenticated evidence replaces a claim in this snapshot.
- Do not use this for: Treating Lark or Feishu as an approved OpenMeld channel,
  implementing the recommendation directly, or overriding the current
  Organization, Remote Agent, shared-contract, and data owner documents.
- Source of truth: The linked vendor sources own external platform facts;
  OpenMeld owner documents under `developing/` own product and architecture
  decisions.

Research date: 2026-07-17
Written against repository HEAD: `bb9c6d116e`

Status: RESEARCH SNAPSHOT — NO IMPLEMENTATION AUTHORIZED. Remove this file or
distill approved facts into the scoped `developing/` owners when a formal
channel decision ships; remove it if the proposal is abandoned.

This document covers external platform facts and a recommended integration
shape. It intentionally does not inspect OpenMeld's current Slack
implementation.

## Executive decision

Lark and Feishu should be implemented as one provider family with an explicit
regional brand, not as two independent channel implementations:

```text
Provider family: lark
Brand / region:   lark | feishu
API origin:       https://open.larksuite.com | https://open.feishu.cn
```

The official Node SDK already models the two API origins as separate domains,
and its one-click app registration returns `tenant_brand` as either `lark` or
`feishu`. Credentials and identifiers must still be treated as
region-bound—OpenMeld must not assume that an App ID, App Secret, tenant key,
Open ID, or token from one platform works on the other.
([official Node SDK](https://github.com/larksuite/node-sdk),
[official Go SDK domain reference](https://open.feishu.cn/document/server-side-sdk/golang-sdk-guide/calling-server-side-apis?lang=zh-CN))

There are two viable installation models:

1. **Customer-owned custom app per tenant.** An organization administrator
   creates a custom app, or uses Lark/Feishu's new one-click Agent app
   registration flow. OpenMeld stores that tenant's App ID and App Secret and
   runs the official Channel SDK over a long-lived WebSocket. This is the
   fastest pilot path and avoids marketplace review, but creates one credential
   set and one persistent connection per connected tenant.
   ([one-click Agent app](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview),
   [custom app development](https://open.larksuite.com/document/home/introduction-to-custom-app-development/self-built-application-development-process?lang=en-US),
   [Channel SDK](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))
2. **OpenMeld store app for multiple tenants.** OpenMeld publishes a store app,
   tenants install it, and each installation is addressed by `tenant_key`.
   Store apps use one App ID across tenants and obtain a tenant-specific
   `tenant_access_token`; store-app event delivery must use the developer-server
   webhook path because the official long-connection guide limits that mode to
   custom apps. This is the right eventual model for self-serve SaaS
   distribution, but it adds ISV qualification, platform review, installation,
   upgrade, and per-tenant token lifecycle work.
   ([custom versus store app token model](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN),
   [long-connection restriction](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket),
   [Lark store-app publishing overview](https://open.larksuite.com/document/isv-guides/publish-your-app/publishing-guidelines))

Recommended sequence:

- Prove one Feishu tenant and one Lark tenant using the customer-owned custom-app
  model and the official Node Channel SDK.
- Keep the provider boundary compatible with a later store-app webhook
  transport; do not let custom-app credentials or a process-local WebSocket
  become the OpenMeld channel model.
- If the product requirement is an ordinary **Add to Lark / Add to Feishu**
  button for any customer, plan separate store-app registrations and review
  work for the Lark and Feishu ecosystems. The separate consoles, API origins,
  accounts domains, and app directories are enough reason to fail closed rather
  than assume cross-brand credential portability.
  ([official adapter setup](https://open.larksuite.com/document/mcp_open_tools/integrating-agents-with-feishu/vercel-chat-sdk-lark-message-publish),
  [official Node SDK domain model](https://github.com/larksuite/node-sdk))

## The important 2026 platform change

Lark/Feishu now publishes an Agent-specific integration stack:

| Layer | Official capability | What it removes from OpenMeld's scope |
| --- | --- | --- |
| Credential setup | One-click app registration by QR/device authorization | Manual app creation, initial common scopes, and initial event configuration |
| Conversation transport | Channel SDK for Node, Python, Java, and Go | WebSocket lifecycle, event parsing, token refresh, message normalization, media handling, card interaction, and streaming reply mechanics |
| Business actions | Lark CLI / OpenAPI | Optional future tools for documents, calendar, sheets, mail, and tasks; this is separate from the message channel |

The platform describes these as three composable layers and explicitly says the
Channel SDK supports group chat, direct messages, document comments, streaming
replies, and card interactions.
([official Agent integration overview](https://open.larksuite.com/document/mcp_open_tools/overview-of-lark-agent-integration-capabilities))

For Node.js, `@larksuiteoapi/node-sdk` now exposes `createLarkChannel`. The
official documentation says it is the recommended entry point for conversational
bots and that it wraps `WSClient`, `EventDispatcher`, and `Client`. It normalizes
more than twenty native message shapes, exposes direct/group chat type,
thread/reply relationships and mentions, supports media, and owns native card
streaming.
([official Channel module reference](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

This means OpenMeld should **use the official SDK for the provider codec and
transport**, but should not delegate OpenMeld's durable channel truth to it.
The same Channel SDK also has configurable deduplication, stale-event handling,
per-chat serialization, and policy rejection; its documentation says some
duplicate, stale, and concurrency drops are silent. OpenMeld needs its own
durable event ledger and diagnostics around that layer rather than treating
in-memory SDK behavior as authoritative.
([Channel safety and rejection behavior](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

## Installation model A: customer-owned custom app

### User flow

1. An OpenMeld organization owner selects **Connect Lark** or **Connect
   Feishu**.
2. OpenMeld starts the official one-click app registration flow. The Node SDK's
   `registerApp` uses an OAuth 2.0 Device Authorization Grant-style flow,
   returns a short-lived URL/QR code, can prefill app name/icon/description, can
   request additional scopes/events/callbacks, and returns `client_id`,
   `client_secret`, and the detected `tenant_brand`.
   ([official Node SDK registration reference](https://github.com/larksuite/node-sdk))
3. The organization administrator scans and confirms. The platform creates or
   selects a custom app inside that tenant and returns its credentials. The
   official Agent registration guide says common message permissions and event
   subscriptions can be provisioned automatically.
   ([one-click Agent app guide](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview))
4. OpenMeld encrypts and stores the credentials against exactly one OpenMeld
   Organization and exactly one provider brand.
5. A dedicated connector runtime starts `createLarkChannel` with the correct
   domain. `connect()` waits for a real WebSocket handshake and the SDK
   automatically reconnects after runtime disconnects.
   ([Channel connection contract](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))
6. OpenMeld marks the channel connected only after a real handshake and bot
   identity read, not merely after storing credentials.

### Benefits

- A custom app is an internal tenant app. It does not require Lark platform
  marketplace review; the tenant administrator reviews and publishes it for
  that tenant.
  ([custom app development process](https://open.larksuite.com/document/home/introduction-to-custom-app-development/self-built-application-development-process?lang=en-US),
  [custom app review](https://open.larksuite.com/document/best-practices/intro-to-custom-app-review))
- Long connection avoids exposing a public inbound endpoint and the SDK handles
  the connection authentication and encrypted transport.
  ([long-connection guide](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket))
- The official Channel SDK has a direct Agent-focused surface for normalized
  messages, replies, media, cards, and native streaming.
  ([Channel module](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

### Costs and constraints

- Custom apps are tenant-local. OpenMeld must store one App ID and App Secret
  per customer tenant.
  ([custom app model](https://open.larksuite.com/document/home/introduction-to-custom-app-development/self-built-application-development-process?lang=en-US))
- Long connection is process-oriented and stateful. Each SDK client is a
  connection; an app can establish at most 50 long connections, and delivery is
  cluster/load-balanced rather than broadcast when multiple clients exist.
  ([long-connection limits](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket))
- The official Channel SDK expects a process-lifetime connection and
  auto-reconnect loop. This is not a natural fit for a request-only serverless
  handler; OpenMeld would need a dedicated connector process or a verified
  long-lived runtime.
  ([Channel connection lifecycle](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))
- No official Lark/Feishu Node SDK or Channel module source reviewed for this
  research claims compatibility with Cloudflare Workers. The published Node
  examples use Node HTTP frameworks or process-lifetime WebSockets, and the
  Channel module accepts Node `Buffer` and local file paths for media. Treat
  Cloudflare Workers compatibility as **unknown until proven by a focused
  build/runtime spike**; do not infer support from the package being written in
  TypeScript.
  ([official Node SDK](https://github.com/larksuite/node-sdk),
  [Channel module runtime surface](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))
- Tenant administrators still control app availability. A bot can interact only
  with users in its configured availability range.
  ([bot availability behavior](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN),
  [permission model](https://open.larksuite.com/document/home/introduction-to-scope-and-authorization/overview))

### Best use

Use this model for:

- the first real Feishu and Lark pilots;
- enterprise customers willing to own an internal app;
- development environments;
- an on-premise or customer-hosted connector.

Do not mistake it for the final self-serve marketplace model.

## Installation model B: OpenMeld store app

### User flow

1. OpenMeld creates a store app in the appropriate developer console, enables
   the bot capability, configures scopes and events/callbacks, tests it in a
   test tenant, and submits it for the regional app directory review.
   ([create a Lark store app](https://open.larksuite.com/document/isv-guides/publish-your-app/step1-create-a-store-application),
   [test a store app](https://open.larksuite.com/document/isv-guides/publish-your-app/step6-test-the-store-application),
   [publish a store app](https://open.larksuite.com/document/isv-guides/publish-your-app/step7-publish-the-store-application))
2. A customer administrator installs OpenMeld and approves all requested
   permissions. New permissions require a new app version and tenant
   reauthorization/upgrade.
   ([store app permission behavior](https://open.feishu.cn/document/isv-guides/publish-your-app/step5-develop-store-application))
3. OpenMeld records the installation's `tenant_key`. Store apps use the same
   App ID across tenants; the tenant key is required to obtain or select the
   correct `tenant_access_token`.
   ([store-app token model](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN),
   [official Node SDK store-app client](https://github.com/larksuite/node-sdk))
4. OpenMeld receives installation and lifecycle events at its public webhook.
   The platform sends `app_ticket` to store apps hourly for obtaining
   `app_access_token`, and exposes installation/enablement and uninstall
   lifecycle events.
   ([official event list](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-list))
5. Inbound events are routed by at least `(brand, app_id, tenant_key)`.
6. Outbound calls use the region's API origin and the tenant-specific token.
   The official Node SDK supports `AppType.ISV` and `withTenantKey`.
   ([official Node SDK store-app usage](https://github.com/larksuite/node-sdk))

### Benefits

- One app registration can serve multiple tenants within the same platform.
- The install/upgrade/uninstall lifecycle is a normal product flow rather than
  asking every customer to own and maintain credentials.
- A public webhook fits horizontally scaled, queue-backed SaaS ingress better
  than one persistent WebSocket per tenant.

### Costs and constraints

- Lark requires official review before a store app is launched in its app
  directory.
  ([Lark publishing guidelines](https://open.larksuite.com/document/isv-guides/publish-your-app/publishing-guidelines))
- Feishu's official ISV onboarding guide lists business qualification,
  certification, service, and public-listing requirements in addition to the
  technical review. OpenMeld should validate eligibility before making public
  Feishu listing a launch dependency.
  ([Feishu ISV onboarding](https://open.feishu.cn/document/isv-guides/publish-your-app/step1-complete-the-entry))
- Store-app message events should be designed around the public webhook
  transport. The official long-connection guide states that long connection is
  limited to custom apps.
  ([long-connection restriction](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket))
- Token and ticket caches must be distributed. The official SDK documentation
  specifically calls out distributed storage for store-app `app_ticket` and
  tenant tokens.
  ([official SDK cache guidance](https://open.feishu.cn/document/server-side-sdk/golang-sdk-guide/calling-server-side-apis?lang=zh-CN))
- Feishu advises using servers in mainland China to leave enough time for the
  three-second callback deadline. A production Feishu webhook served only from
  an overseas region must be tested against real Chinese tenants and may require
  a China-accessible ingress.
  ([Feishu event callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN))

### Best use

Use this model when OpenMeld needs a true self-serve **Add to Lark** or **Add to
Feishu** installation across unrelated customer tenants.

## One shared provider, two regional deployments

The application contract should carry the brand explicitly:

```ts
type LarkBrand = "lark" | "feishu";

type LarkInstallationKey = {
  brand: LarkBrand;
  appId: string;
  tenantKey: string;
};
```

The official SDK exposes different API origins:

- Feishu: `https://open.feishu.cn`
- Lark: `https://open.larksuite.com`

Its one-click registration flow also distinguishes
`accounts.feishu.cn` from `accounts.larksuite.com`.
([official Node SDK](https://github.com/larksuite/node-sdk))

Recommended operational boundary:

| Concern | Shared | Region-specific |
| --- | --- | --- |
| Internal channel envelope | Yes | No |
| OpenMeld Organization mapping | Yes | No |
| Event ledger and idempotency | Yes | No |
| Center Agent routing and reply publication | Yes | No |
| Message/card domain model | Yes | Renderer differs by provider |
| API client and token cache | Same implementation | Separate origin, credentials, and cache namespace |
| Webhook endpoint | Same handler contract | Separate route/secret/observability dimensions |
| Marketplace listing and review | Same checklist | Separate app registration and review process |
| Data residency and network validation | Same policy framework | Separate evidence and deployment decision |

Treat separate Lark and Feishu app registrations as the safe default. This is an
engineering inference from the platforms' separate developer consoles, API and
accounts origins, app directories, and region-bound identifiers—not an official
claim that cross-brand publication is impossible. OpenMeld should confirm the
commercial listing arrangement with the platform before attempting to combine
registrations.

## Inbound message flow

### Required event

Subscribe to `im.message.receive_v1`. An application bot can receive:

- all direct messages sent by users to the bot with
  `im:message.p2p_msg:readonly`;
- group messages that mention the bot with
  `im:message.group_at_msg:readonly`;
- all messages in groups containing the bot only with the broader, sensitive
  `im:message.group_msg` permission.

The official FAQ recommends message-event subscription plus the relevant
scopes, and explicitly distinguishes application bots from one-way group custom
webhooks.
([bot receive behavior](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN),
[official scope list](https://open.larksuite.com/document/ukTMukTMukTM/uYTM5UjL2ETO14iNxkTN/scope-list))

For the first release, request direct messages plus group mentions. Do not
request all group messages unless the product explicitly promises passive
channel ingestion; it is a sensitive permission and materially changes the
privacy model.

### Durable ingest sequence

```text
Lark/Feishu event
  -> verify/decrypt with official SDK
  -> validate brand + app_id + tenant_key
  -> normalize provider payload
  -> persist provider event id before acknowledging
  -> acknowledge within 3 seconds
  -> enqueue asynchronous OpenMeld processing
  -> resolve Organization, conversation, and sender binding
  -> invoke the same channel-neutral Center Agent turn pipeline
  -> publish a reply or an explicit visible failure
```

The platform requires a successful response within three seconds. For webhook
events, failure triggers retries at 15 seconds, 5 minutes, 1 hour, and 6 hours,
up to four retries. Version 2 events provide `header.event_id`, which must be
used for deduplication across the roughly 7.1-hour replay window.
([event delivery and retry contract](https://open.larksuite.com/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM))

Long-connection delivery also requires processing within three seconds or a
retry is triggered, and multiple clients receive cluster/load-balanced—not
broadcast—delivery.
([long-connection guide](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket))

The three-second handler must therefore stop after durable acceptance. It must
not wait for an Agent run or message publication.

## Outbound messages and replies

The send API is:

```text
POST /open-apis/im/v1/messages?receive_id_type=...
```

It supports text, rich text, interactive cards, images, video, audio, files,
stickers, group cards, and user cards. `chat_id` addresses a conversation;
`open_id`, `union_id`, `user_id`, or email can address a user. The bot must be
available to a direct-message recipient and must be in a group before posting
there.
([send-message API](https://open.larksuite.com/document/server-docs/im-v1/message/create))

For replies, use the dedicated reply API:

```text
POST /open-apis/im/v1/messages/:message_id/reply
```

It preserves reply/thread semantics and has the same bot availability and group
membership requirements. The reply request also accepts a developer-generated
`uuid`; requests with the same UUID successfully execute at most once within
one hour.
([reply-message API](https://open.larksuite.com/document/server-docs/im-v1/message/reply))

Important reliability details:

- Send-message calls can include a developer-generated `uuid`; calls with the
  same UUID succeed at most once within one hour.
- Reply-message calls have the same one-hour UUID idempotency window.
- The send endpoint documents a general limit of 1,000 requests/minute and 50
  requests/second.
- To avoid disturbing users, messages to the same user are limited to 5 QPS;
  messages to the same group share a 5 QPS limit among bots in that group.

([send-message limits and idempotency](https://open.larksuite.com/document/server-docs/im-v1/message/create))

OpenMeld should use a deterministic outbound idempotency key derived from its
reply/publication record, keep a per-tenant and per-conversation rate limiter,
and classify provider rate limits separately from Agent failures.

## Cards, interactions, and streaming

Lark/Feishu interactive cards are the analogue of Slack Block Kit, but the JSON
schema and interaction lifecycle are provider-specific. Cards are sent as
`msg_type: "interactive"`.
([interactive card introduction](https://open.larksuite.com/document/home/quickly-develop-interactive-cards/introduction),
[send-message API](https://open.larksuite.com/document/server-docs/im-v1/message/create))

The current `card.action.trigger` callback includes the operator's tenant key
and Open ID and must be acknowledged within three seconds. The official card
documentation says callbacks can be configured for long-connection delivery,
while the general event long-connection guide says long connection only
supports event subscriptions. The official Channel SDK exposes a normalized
`cardAction` event over its transport.
([card callback contract](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN),
[long-connection guide](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket),
[Channel SDK](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

Because those official pages are not perfectly aligned, the implementation
spike must verify the exact card callback transport in one real Feishu app and
one real Lark app. For store apps, keep a webhook callback endpoint available.

The official Channel SDK can create native CardKit streaming replies with a
server-rendered typewriter animation and owns update throttling. OpenMeld should
use that primitive instead of repeatedly sending or updating cards by hand.
([Channel streaming contract](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

## Identity mapping

Lark/Feishu exposes three relevant user identifiers:

| Identifier | Isolation | Recommended OpenMeld use |
| --- | --- | --- |
| `open_id` | Different for the same user across apps; also isolated by tenant | Primary provider-user key inside one installed app |
| `union_id` | Same across apps from the same developer, but different across developers and tenants | Optional cross-app correlation under the same verified developer account; never a global person ID |
| `user_id` | Stable across apps inside one tenant, different across tenants | Use only if a feature genuinely needs tenant-wide cross-app identity; it requires an additional sensitive field scope |

([official identity example](https://open.feishu.cn/document/platform-overveiw/basic-concepts/user-identity-introduction/larkid?lang=zh-CN),
[message API identifier definitions](https://open.larksuite.com/document/server-docs/im-v1/message/create))

The durable provider identity should be:

```text
(brand, app_id, tenant_key, open_id)
```

Never key an OpenMeld member by Open ID alone. Never merge Lark and Feishu
identities because their email strings happen to match. Link the provider user
to an OpenMeld Organization Member through an explicit, authenticated binding
flow, for example:

1. The user DMs the bot and receives a short-lived binding link.
2. The link opens OpenMeld and requires the user's existing OpenMeld session.
3. OpenMeld binds the exact provider identity tuple to the exact Organization
   Member.
4. Future events fail closed if the tenant, provider identity, or OpenMeld
   Organization no longer matches.

The inbound event and card callback include `tenant_key`, and v2 events also
include `app_id`; these fields should be validated before identity resolution.
([event envelope](https://open.larksuite.com/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM),
[card callback envelope](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN))

## Minimal first-release permissions

Request only:

| Capability | Permission / subscription | Why |
| --- | --- | --- |
| Receive bot DMs | `im:message.p2p_msg:readonly` + `im.message.receive_v1` | Center Agent direct messages |
| Receive group mentions | `im:message.group_at_msg:readonly` + `im.message.receive_v1` | Explicit invocation in groups without passive ingestion |
| Send as bot | `im:message:send_as_bot` | Direct and group replies |
| Card interaction | `card.action.trigger` callback | Buttons and approval-style actions; no API scope is listed for the callback |

([scope catalog](https://open.larksuite.com/document/ukTMukTMukTM/uYTM5UjL2ETO14iNxkTN/scope-list),
[card callback](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN))

Defer:

- `im:message.group_msg`, because it reads all messages in groups containing the
  bot and is classified as a sensitive/advanced permission;
- user-ID field scopes, because Open ID is sufficient for provider-local
  identity;
- contact-directory scopes, unless product requirements need profile lookup;
- history-reading scopes, unless OpenMeld explicitly promises history import;
- document, calendar, task, sheet, and mail permissions, because those are app
  tool capabilities, not requirements for a message channel.

The platform permission model has separate access tokens, API scopes,
availability range, and row/field data permissions. All applicable dimensions
must authorize a call; a token alone does not grant broad tenant data access.
([application authorization model](https://open.larksuite.com/document/home/introduction-to-scope-and-authorization/overview))

## Security requirements

### Webhook mode

- Configure an Encrypt Key and Verification Token.
- Use the official `EventDispatcher` / webhook adapter and
  `CardActionHandler`; the official SDK performs event decryption, challenge
  handling, and card verification. Do not implement a parallel hand-written
  crypto path unless an audited platform contract requires it.
  ([official Node SDK event and card handlers](https://github.com/larksuite/node-sdk))
- Validate the v2 envelope's `app_id`, `tenant_key`, `event_type`,
  `event_id`, and verification token before routing.
  ([event envelope](https://open.larksuite.com/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM))
- Persist the event ID before acknowledging, then enqueue asynchronous work.
- Namespace all secrets, token caches, replay protection, and metrics by
  `(brand, app_id, tenant_key)`.

### Long-connection mode

The official SDK authenticates the connection and handles the encrypted
transport; the platform documentation says application code does not need to
perform separate decryption or signature verification for each event.
([long-connection security](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket))

OpenMeld must still:

- protect the per-tenant App Secret;
- verify that the connected bot identity belongs to the expected installation;
- record connection/reconnection health;
- deduplicate provider event IDs durably;
- fail closed when organization or sender bindings are absent or mismatched.

### Secret ownership

The two installation models have different trust boundaries:

- In a custom-app connection, the customer tenant owns the app and grants
  OpenMeld custody of that app's secret.
- In a store-app connection, OpenMeld owns the shared app secret and receives
  tenant-specific tokens/tickets after installation.

These must be distinct credential kinds in storage and diagnostics.

## Reliability and rate-limit comparison with Slack

| Concern | Lark / Feishu | Slack |
| --- | --- | --- |
| Inbound HTTP deadline | Respond successfully within 3 seconds | Respond with HTTP 2xx within 3 seconds |
| Event retries | 15 seconds, 5 minutes, 1 hour, 6 hours; up to 4 retries | Near-immediate, 1 minute, 5 minutes; up to 3 retries |
| Event dedup key | v2 `header.event_id` | top-level `event_id` |
| WebSocket mode | Official long connection; custom apps only per the general guide; cluster delivery | Socket Mode; distributed apps supported, but HTTP is required for Slack Marketplace listing |
| Production transport guidance | Store apps use developer-server webhook; Feishu recommends China-mainland callback hosting | Slack recommends HTTP for highest production reliability and Marketplace submission |
| Send limit relevant to chat | 5 QPS to the same user; shared 5 QPS to the same group; endpoint also lists 1,000/min and 50/sec | Generally 1 message/second per channel; HTTP 429 includes `Retry-After` |
| Outbound idempotency | Send-message `uuid` deduplicates for one hour | OpenMeld must retain its own durable publication idempotency around `chat.postMessage` |

Lark/Feishu sources:
[event retry contract](https://open.larksuite.com/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM),
[long connection](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket),
[send-message limits](https://open.larksuite.com/document/server-docs/im-v1/message/create),
[Feishu callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN).

Slack sources:
[Events API](https://docs.slack.dev/apis/events-api/),
[HTTP versus Socket Mode](https://docs.slack.dev/apis/events-api/comparing-http-socket-mode/),
[Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/),
[rate limits](https://docs.slack.dev/apis/web-api/rate-limits/).

Both providers require the same high-level reliability pattern: verify, persist
an idempotency key, acknowledge quickly, queue work, and publish through a
rate-limited idempotent outbox. The timing and identifiers differ; the durable
pipeline does not have to.

## What can be shared with Slack

The official platform models show substantial reusable product and runtime
behavior:

| Share across providers | Keep provider-specific |
| --- | --- |
| Organization-level channel connection state | App creation, OAuth/device registration, installation, upgrade, and uninstall flows |
| Permission to connect/disconnect a channel | Slack signing-secret verification versus Lark/Feishu token/encryption handling |
| Durable inbound event ledger | Raw event schemas and retry headers |
| Three-second accept-and-queue ingress pattern | Slack Event API / Socket Mode versus Lark/Feishu webhook / long connection |
| Channel-neutral inbound message envelope | Message, mention, thread, attachment, and card normalization |
| Organization Member identity-binding workflow | Slack team/user IDs versus Lark/Feishu brand/tenant/Open ID tuple |
| Center Agent turn routing | Provider-specific bot visibility and membership rules |
| Conversation/session correlation | Provider conversation and thread identifiers |
| Durable reply outbox and publication state | `chat.postMessage`/Block Kit versus IM v1/cards/CardKit |
| Rate-limit scheduler, backoff framework, and explicit failure states | Provider-specific limits, error codes, and retry hints |
| Observability, trace correlation, audit, and redaction rules | Provider request IDs, token types, and platform log links |
| Product UX vocabulary for Connected / Needs attention / Disconnected | Provider logos, native installation copy, and remediation links |

The common internal envelope can look like:

```ts
type ChannelInboundMessage = {
  provider: "slack" | "lark";
  providerVariant?: "lark" | "feishu";
  providerTenantId: string;
  providerConversationId: string;
  providerThreadId?: string;
  providerMessageId: string;
  providerEventId: string;
  providerUserId: string;
  chatType: "direct" | "group";
  mentionsBot: boolean;
  text: string;
  attachments: ChannelAttachment[];
  occurredAt: string;
};
```

This is an OpenMeld-owned contract. The Lark Channel SDK's normalized message is
an input to it, not the cross-provider source of truth.

### Platform-specific rendering must remain separate

Slack Block Kit and Lark/Feishu cards are not interchangeable templates. Slack
uses Block Kit JSON and sends interaction payloads to its configured request
URL or Socket Mode connection.
([Slack Block Kit](https://docs.slack.dev/block-kit/),
[Slack interactivity](https://docs.slack.dev/interactivity/handling-user-interaction/))

Lark/Feishu uses interactive message cards/CardKit and
`card.action.trigger`; its official Channel SDK also exposes native typewriter
streaming.
([Lark card callback](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN),
[Channel streaming](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

Share semantic card intents such as `status`, `progress`, `approval`,
`open_details`, and `retry`; render them with separate provider renderers.

## Slack comparison in plain terms

The platforms have the same basic skeleton:

```text
Create platform app
  -> request minimum bot scopes
  -> organization/workspace installs or approves it
  -> receive messages/events
  -> acknowledge quickly
  -> map platform tenant/user/conversation to OpenMeld
  -> run Center Agent
  -> send reply through platform API
```

Slack's distributed installation is standard OAuth 2.0: each workspace install
returns a bot token and team/enterprise identifiers. A Slack app can be
undistributed, unlisted-distributed, or Marketplace-listed.
([Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/),
[Slack distribution](https://docs.slack.dev/app-management/distribution/))

Lark/Feishu has an additional choice:

- customer-owned custom app with App ID/App Secret and long connection; or
- OpenMeld-owned store app with tenant-keyed tokens and webhook delivery.

Slack also supports HTTP Events API and Socket Mode, but Slack explicitly
requires HTTP for Marketplace apps and recommends HTTP for highest production
reliability.
([Slack HTTP versus Socket Mode](https://docs.slack.dev/apis/events-api/comparing-http-socket-mode/))

Both platforms support bot DMs, group/channel messages, mentions, rich cards,
and interactive actions.
([Slack DM event](https://docs.slack.dev/reference/events/message.im),
[Slack app mentions](https://docs.slack.dev/reference/events/app_mention/),
[Lark/Feishu bot FAQ](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN),
[Lark/Feishu send-message API](https://open.larksuite.com/document/server-docs/im-v1/message/create))

## Open Connector decision

No Open Connector is required to integrate Lark, Feishu, or Slack as messaging
channels. Each platform has a first-party app/bot model, first-party inbound
event transport, first-party outbound message APIs, official SDKs, and native
installation/authorization.

That statement is about the external platform architecture. Whether OpenMeld's
current Slack implementation actually uses Open Connector is a repository fact
and is intentionally outside this external-only research task.

Open Connector could still be a separate future tool-access abstraction, but
it should not sit in the critical message-ingress or reply-publication path.
Doing so would add an unnecessary authority and reliability layer between the
provider and OpenMeld.

## Recommended implementation plan

### Phase 0: settle the product install promise

Decide which first-release promise is real:

- **Private pilot:** “Connect your organization's Lark/Feishu app.”
- **Self-serve SaaS:** “Add OpenMeld to Lark/Feishu.”

The first promise uses custom apps. The second requires the store-app lane.

### Phase 1: two-brand custom-app spike

1. Use official one-click registration to create one Feishu custom app and one
   Lark custom app.
2. Request only DM, group-mention, bot-send, and card-action capabilities.
3. Use `createLarkChannel` and the explicit region domain.
4. Prove:
   - a DM event and reply;
   - a group `@bot` event and reply;
   - thread/reply placement;
   - one interactive card action;
   - one native streaming reply;
   - reconnect behavior;
   - event duplicate behavior;
   - disconnect/revoked-credential diagnostics.
5. Record all provider IDs and request/event IDs in a redacted evidence bundle.

### Phase 2: shared OpenMeld channel core

Create or extend one provider-neutral pipeline for:

- Organization connection authority;
- external identity binding;
- normalized inbound messages;
- durable event deduplication;
- asynchronous turn dispatch;
- durable reply outbox;
- visible failure publication;
- rate limiting and provider-specific backoff;
- audit, diagnostics, and secret redaction.

Keep the official SDK behind a `LarkChannelAdapter`.

### Phase 3: production transport

For the custom-app release:

- run long connections in a dedicated persistent connector runtime;
- shard and supervise connections;
- use a durable cache implementation;
- expose connection health without treating it as proof of message delivery.

For the store-app release:

- build public regional webhook ingress;
- route by brand, App ID, and tenant key;
- persist app tickets and tenant tokens in distributed storage;
- handle install, permission upgrade, uninstall, and secret rotation;
- complete Lark and Feishu app review separately;
- prove Feishu callback latency from a real Chinese tenant.

### Phase 4: parity and expansion

Add, in order:

1. attachments and media;
2. richer cards and approval actions;
3. reactions and edits;
4. optional history retrieval with an explicit product promise and permission
   review;
5. optional Lark business tools through a separate Apps/tool-access boundary.

## Acceptance checklist

- [ ] Feishu and Lark are one provider family with an explicit brand/region.
- [ ] Credentials, tokens, IDs, caches, logs, and metrics are region- and
      tenant-namespaced.
- [ ] The install model is explicit: custom app or store app.
- [ ] Only minimum DM, group-mention, send, and card scopes are requested.
- [ ] A real bot DM works in both Feishu and Lark.
- [ ] A real group mention works in both Feishu and Lark.
- [ ] The bot cannot read unmentioned group messages in the minimum-scope
      configuration.
- [ ] Identity is keyed by brand, app, tenant, and Open ID.
- [ ] Inbound events are durably deduplicated before asynchronous processing.
- [ ] The provider is acknowledged inside three seconds without waiting for the
      Agent.
- [ ] Outbound replies use deterministic idempotency keys and provider-aware
      rate limiting.
- [ ] Card callbacks are verified and proven over the chosen production
      transport.
- [ ] SDK reconnects, silent policy drops, and outbound retries are surrounded
      by OpenMeld-owned observability.
- [ ] Slack Block Kit and Lark/Feishu card JSON remain separate renderers over
      shared semantic intents.
- [ ] Open Connector is not introduced into the channel-critical path.

## 2026-07-17 follow-up: Personal Agent registration and broad permissions

### Decision

The user's memory of a "Personal Agent" QR-code connection is substantially
correct, but the public product name is different:

- The public Feishu documentation calls it **一键创建飞书智能体应用**
  ("one-click creation of a Feishu Agent app").
- The public Lark documentation calls it **一键创建 Lark 应用** ("one-click
  creation of a Lark app").
- The official Lark CLI source sends `archetype=PersonalAgent` to the app
  registration endpoint. `PersonalAgent` is therefore a real registration
  archetype in the first-party implementation, but it is not documented as a
  separate marketplace app type or a built-in Lark/Feishu Agent that third
  parties attach to.
  ([Feishu one-click Agent app](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview),
  [Lark Agent integration overview](https://open.larksuite.com/document/mcp_open_tools/overview-of-lark-agent-integration-capabilities),
  [official CLI registration source](https://github.com/larksuite/cli/blob/main/internal/auth/app_registration.go))

OpenMeld **can use this flow**. The official Feishu guide explicitly positions
it for third-party AI Agents such as OpenClaw and Hermes, and the official SDK
returns an App ID and App Secret to the integrating Agent after the user
confirms. The fastest validation path is therefore a per-tenant Agent app
created by QR code, not a store-app review.
([Feishu one-click Agent app](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview),
[official Node SDK registration API](https://github.com/larksuite/node-sdk#app-registration))

This is not a complete one-scan grant for everything the Center Agent may do.
It solves the **app credential and bot/channel plane**. Access to a user's own
calendar, mail, messages, documents, tasks, and other personal resources still
needs a **user OAuth grant and user access token**. For a fully capable personal
Center Agent, the honest setup is a short two-consent wizard:

1. **Connect the Agent app:** scan once to create or select the tenant's custom
   Agent app and return its App ID/App Secret.
2. **Connect my Lark/Feishu account:** scan or open a second device-flow URL to
   grant user scopes and return a refreshable user access token.

The official CLI itself follows this two-step sequence: `config init --new`
creates/configures the app, then `auth login` grants a user identity. Its
first-party guidance says bot identity cannot see a user's calendar, Drive, or
mail, while user identity needs both the scope enabled on the app and the
individual user's authorization.
([official Lark/Feishu CLI quick start](https://github.com/larksuite/cli#quick-start-ai-agent),
[official CLI identity and authorization rules](https://github.com/larksuite/cli/blob/main/skills/lark-shared/SKILL.md),
[token identity guidance](https://open.larksuite.com/document/faq/trouble-shooting/how-to-choose-which-type-of-token-to-use))

### What the QR flow actually does

Confirmed first-party behavior:

- The app registration API is based on an OAuth 2.0 Device Authorization
  Grant-style flow. It produces a URL suitable for a QR code, polls for
  completion, and returns `client_id`, `client_secret`, the scanning user's Open
  ID when available, and `tenant_brand` as `feishu` or `lark`.
  ([official Node SDK registration API](https://github.com/larksuite/node-sdk#app-registration))
- A Feishu registration URL is valid for ten minutes and only one user may use
  it. The confirmation page lets that user select an existing app or create a
  new one. The integrating Agent can prefill the app avatar, name, and
  description.
  ([Feishu one-click Agent app](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview))
- The same official SDK handles Feishu and Lark. It begins on the Feishu
  accounts endpoint, detects `tenant_brand`, switches to the Lark accounts
  endpoint when needed, and reports the final brand with the credentials.
  ([official CLI registration source](https://github.com/larksuite/cli/blob/main/internal/auth/app_registration.go),
  [official Node SDK registration API](https://github.com/larksuite/node-sdk#app-registration))
- `addons` can add tenant scopes, user scopes, tenant/user events, and
  callbacks on top of the platform preset. They are shown on the confirmation
  page and take effect after confirmation. `createOnly: true` can prevent the
  user from accidentally changing an existing app.
  ([official Node SDK registration API](https://github.com/larksuite/node-sdk#custom-scopeseventscallbacks-addons-and-updating-an-existing-app))
- `addons` is additive. The preset permissions cannot be removed through this
  flow. Unknown catalog names are silently ignored, so OpenMeld must validate
  the resulting app configuration rather than trusting its requested list.
  Sensitive transport settings such as event delivery type, request URLs,
  encryption keys, and other `security.*` configuration cannot be sent through
  `addons`.
  ([official Node SDK registration API](https://github.com/larksuite/node-sdk#custom-scopeseventscallbacks-addons-and-updating-an-existing-app))

The QR registration should be treated as a **tenant-owned custom Agent app**.
It returns a tenant-specific App ID/App Secret and the official preset uses
WebSocket event delivery, which is available to custom apps. It is not the
same as installing one OpenMeld store app into many tenants. This classification
is an engineering inference from the credential and transport contract; the
public one-click page does not explicitly label the generated app type.
([Feishu one-click Agent app](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview),
[official long-connection restrictions](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket))

The official documents do not promise that every ordinary member in every
tenant can create or update one of these apps. Lark/Feishu explicitly says the
CLI only simplifies app creation and that the app remains subject to the
enterprise's normal governance. Permissions, publication, availability range,
and administrator review can still block production use in a managed tenant.
Therefore OpenMeld must show the actual platform outcome, not promise that any
user can always finish the QR flow without administrator help.
([official Feishu CLI guide](https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu),
[custom-app permission review](https://open.feishu.cn/document/ukTMukTMukTM/uQjN3QjL0YzN04CN2cDN),
[app availability](https://open.feishu.cn/document/develop-process/test-and-release-app/availability))

### The platform preset is already intentionally broad

Keeping the default preset gives OpenMeld substantially more than a minimal
mention bot. As of the 2026-06-18 official Feishu page, it includes:

| Area | Default app-identity capabilities |
| --- | --- |
| Agent app | manage the app's own configuration, read bot identity, manage bot menu and Slash Commands |
| Conversation | receive group mentions and DMs, read messages, send/update/bulk/system messages, create/read/update chats |
| Interaction | read/write cards, receive card actions, read/write reactions and Pins |
| Media | upload and retrieve image/file resources |
| Membership | receive bot-added and bot-removed events |
| Documents | read/write Docx, convert text to blocks, read/write/delete document comments |
| Drive and Wiki | read Drive metadata and Wiki node information |
| Contact | read basic contact information |

The preset subscribes to message receipt, reaction creation/deletion,
bot-added/bot-removed, and document-comment events, plus the CardKit action
callback. Its only default user-identity scope is `offline_access`. The complete
scope list is maintained in the official page and should be imported as a
versioned fixture instead of manually copied between OpenMeld services.
([official preset scope and event list](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview))

This default is a strong **channel** bundle, but `offline_access` alone does not
let the Center Agent read or act on the scanning user's personal resources. A
user access token is still required, and its requested user scopes must also be
enabled on the app.
([official CLI identity rules](https://github.com/larksuite/cli/blob/main/skills/lark-shared/SKILL.md),
[user access token](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token))

### Recommended broad-permission validation profile

For the current value-validation phase, use a **broad but capability-backed**
profile rather than either a minimal bot or an unmaintainable hand-written list
of every platform scope:

1. Keep the full one-click Agent preset.
2. Add all user scopes supported by the official Lark CLI business-domain
   catalog for the pilot account.
3. Expose only tools that OpenMeld can actually execute and report honestly.
   A granted scope without a corresponding Center Agent tool does not add user
   value.
4. Use one linked test user initially. The user token represents that user and
   must not be reused as organization-wide authority.

The first-party CLI currently covers Messenger, Docs, Drive, Markdown, Sheets,
Slides, Base, Calendar, Tasks, Wiki, Contacts, Mail, meetings, Minutes,
attendance, approvals, OKRs, whiteboards, and Feishu-only app-building
capabilities. It has more than 200 curated commands, raw access to the wider
OpenAPI surface, and official Agent skills. The supported source-of-truth
command for a broad user grant is:

```text
lark-cli auth login --domain all --no-wait --json
```

The official implementation expands `all` to the business domains available
for the detected Feishu/Lark brand and derives user scopes from its current API
metadata and shortcut registry. It skips brand-incompatible domains. This is
more maintainable for a pilot than OpenMeld inventing and freezing its own
exhaustive scope catalog.
([official CLI capabilities and authorization](https://github.com/larksuite/cli),
[official CLI scope-selection source](https://github.com/larksuite/cli/blob/main/cmd/auth/login.go),
[official CLI shared authorization rules](https://github.com/larksuite/cli/blob/main/skills/lark-shared/SKILL.md))

For product terminology, group the broad grant by user value:

| Center Agent capability pack | High-value operations |
| --- | --- |
| Conversations | search/read messages and chats, send/reply, manage group members and reactions, transfer files |
| Knowledge | search/read/create/update Docs, Drive, Wiki, Sheets, Slides, Base, comments, permissions and attachments |
| Time | read/create/update Calendar events, query free/busy, suggest times, reserve rooms, RSVP |
| Follow-through | create/update Tasks and task lists, reminders, subtasks and collaborators |
| Communications | search/read/draft/send/reply/forward/archive Mail, manage folders, labels and rules |
| Meetings | find meeting records, summaries, action items, transcripts and media |
| Organization | search users and read visible contact information |
| Workflows | approvals, personal attendance and OKRs where the tenant edition and API support them |

The official CLI documents these domains and exposes identity-aware commands
for them. Some operations only support user identity, some support app identity,
and some return different resources depending on the identity. OpenMeld should
not flatten both token types into one ambiguous "Lark connected" state.
([official CLI capability map](https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu),
[official CLI README](https://github.com/larksuite/cli),
[token identity guidance](https://open.larksuite.com/document/faq/trouble-shooting/how-to-choose-which-type-of-token-to-use))

There is a practical platform limit to "ask for everything." Lark/Feishu
classifies scopes by sensitivity:

- Custom-app scopes may be configured as approval-free or approval-required by
  the tenant. Approval-required scopes need a version and administrator
  approval before they work in production.
- Store-app scopes always go through platform review and tenant installation or
  upgrade review; advanced scopes require a concrete justification.
- In a Feishu test tenant/test version, permission changes can take effect
  without administrator review, making it the fastest place to validate the
  broad profile before one production approval.

Thus the fastest path is not to request unrelated HR and tenant-administration
write access. It is to request every scope backing the concrete Center Agent
tool packs above in one test profile, exercise them, and submit the resulting
known-good production bundle once.
([permission levels and review](https://open.feishu.cn/document/ukTMukTMukTM/uQjN3QjL0YzN04CN2cDN),
[test-tenant behavior](https://open.feishu.cn/document/home/quick-start-of-personnel-and-attendance-management-system/step-1-create-and-configure-an-application))

### Can permissions be added later without reinstalling?

For the QR-created custom app, **yes, but not silently**:

- Call `registerApp` again with the existing `appId` and additive `addons`.
- The user scans again, sees the configuration diff, and explicitly
  reauthorizes the app update.
- For new user-identity scopes, the affected user must also complete user OAuth
  again so the new scopes are present in that user's token. The official CLI
  supports incremental user authorization: multiple `auth login` grants
  accumulate scopes.
- Platform publication or tenant-admin approval may still be required before a
  newly added scope works in the production tenant.

This does not require deleting and reinstalling the custom app, but it does
require a visible reauthorization step. The official flow is additive and does
not provide a way to remove individual preset permissions.
([official Node SDK app-update flow](https://github.com/larksuite/node-sdk#custom-scopeseventscallbacks-addons-and-updating-an-existing-app),
[official CLI incremental user authorization](https://github.com/larksuite/cli/blob/main/skills/lark-shared/SKILL.md),
[custom-app permission review](https://open.feishu.cn/document/ukTMukTMukTM/uQjN3QjL0YzN04CN2cDN))

For a store app, adding scopes is a versioned product change. It requires
platform review and tenant administrators must approve the new version or
upgrade. That is another reason the QR-created custom app is the correct rapid
validation lane, while the store app remains the later distribution lane.
([store-app permission review](https://open.feishu.cn/document/ukTMukTMukTM/uQjN3QjL0YzN04CN2cDN),
[Feishu store-app development](https://open.feishu.cn/document/isv-guides/publish-your-app/step5-develop-store-application))

### Fastest practical OpenMeld validation shape

The external-platform research supports this product flow:

1. **Connect Lark / Connect Feishu** launches the official one-click
   `PersonalAgent` registration with the platform preset, an OpenMeld-branded
   app name/avatar, `createOnly: true`, and the additional scopes/events needed
   by the selected broad capability packs.
2. OpenMeld encrypts the returned App ID/App Secret and records the returned
   `tenant_brand`; the user never pastes credentials.
3. A persistent connector starts the official Channel SDK and proves DM,
   mention, document-comment, attachment, card-action, and streaming-reply
   behavior. The SDK supports these native surfaces.
4. The wizard immediately offers **Enable Center Agent actions** and runs the
   separate user device OAuth for the broad business domains.
5. OpenMeld stores app identity and user identity as two explicit grants, even
   if one wizard creates both. Revoking the user's personal tool access must
   not make the message channel appear disconnected, and losing the channel
   must not silently revoke or reinterpret a user token.
6. For the pilot, reuse the official CLI and its Agent skills as the execution
   surface for business actions rather than reimplementing hundreds of
   Lark/Feishu APIs. Put it behind OpenMeld's existing tool policy,
   observability, and confirmation boundary.

The official stack was designed as exactly these three composable layers:
one-click credentials, Channel SDK for conversation, and Lark CLI for business
actions. Using all three is the shortest first-party path from a QR code to a
Center Agent that can both converse and perform useful work.
([Lark Agent integration overview](https://open.larksuite.com/document/mcp_open_tools/overview-of-lark-agent-integration-capabilities),
[official Channel SDK](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md),
[official Lark/Feishu CLI](https://github.com/larksuite/cli))

The official Vercel Chat SDK adapter is another useful conformance reference:
it already implements QR registration, native CardKit streaming, interactive
cards, message editing/deletion/reactions, history, group/DM normalization, and
WebSocket transport on top of Lark Channel SDK. OpenMeld can reuse the
underlying official Lark Channel SDK directly or wrap this adapter, but should
not introduce a second durable conversation engine just to obtain these
provider codecs.
([official Vercel Chat SDK adapter guide](https://open.larksuite.com/document/mcp_open_tools/integrating-agents-with-feishu/vercel-chat-sdk-lark-message-publish))

### OpenMeld-specific refinement: keep the existing Webhook and Queue runtime

The generic official-stack recommendation above needs one OpenMeld-specific
adjustment. OpenMeld's production Slack path already has an HTTP Gateway,
durable Queue acceptance, Core ingress ledger, native-delivery worker,
callback reconciliation, and fenced final publication. Running Lark Channel
SDK as a persistent WebSocket connector would add a second runtime and
connection-lifecycle problem even though the expensive execution path already
exists.

The fastest production-shaped OpenMeld path is:

1. Use the official `PersonalAgent` device flow and `addons` to create the app
   and request the broad permission bundle.
2. Store the returned App ID/App Secret under the authenticated OpenMeld
   Organization, using the same encryption boundary as other channel
   credentials.
3. Call the official application-config patch API to change the generated
   app's event and callback delivery from `websocket` to `webhook`, point both
   request URLs at OpenMeld Gateway, configure verification/encryption, and
   retain the selected events and callbacks.
4. Let Gateway validate and normalize Lark/Feishu ingress, durably enqueue it,
   and acknowledge the platform without waiting for Center Agent execution.
5. Reuse the existing Core/native-delivery lifecycle, with a typed
   provider-neutral message-channel locator and a provider publication adapter.

The official application-config API exposes `event.subscription_type`,
`event.request_url`, `callback.callback_type`, `callback.request_url`,
scope/event/callback additions, visibility, contact range, and encryption
configuration. The one-click preset already grants the app-self-management
scope used by this setup. This avoids requiring the Node SDK or its `ws`
dependency inside a Cloudflare Worker and avoids operating one long-lived
connection per QR-created app.
([official application-config patch API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v7/application-v7/application-config/patch),
[official Node SDK generated application-config contract](https://github.com/larksuite/node-sdk/blob/main/code-gen/projects/application.ts),
[one-click Agent preset](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview))

For a disposable single-tenant spike, Channel SDK plus the official CLI remains
the shortest way to prove platform behavior. It should be treated as a
conformance harness, not automatically adopted as OpenMeld's production
transport or durable execution engine.

The current OpenMeld code is not plug-compatible yet. The expensive execution
engine can be called in place, but the message-channel edges need one bounded
extraction:

- Reuse in place: Center Agent target authorization, worker admission,
  idempotent native-delivery submission, retries, callback reconciliation,
  memory, quota, audit, and terminal publication claims.
- Extract once: normalized channel event orchestration, external-user linking,
  provider credential lookup, provider conversation locator, and final
  publication dispatch.
- Keep provider-specific: Slack OAuth and signatures; Lark/Feishu
  `PersonalAgent` registration, app configuration, user OAuth, Open ID and
  tenant identity, CardKit rendering, and API error classification.
- Migrate rather than copy: the current `"slack" | "space"` conversation kind,
  Slack-only native-delivery columns, Slack-only ingress and identity tables,
  and Slack-only Web channel mutations.

This is deliberately smaller than migrating OpenMeld to Vercel Chat SDK.
Replacing the current Slack path would discard or re-prove OpenMeld-specific
tenancy, authorization, durable ingress, outcome-unknown handling, and final
publication guarantees. Lark's official adapter is a provider behavior
reference; it is not a replacement for OpenMeld's native-delivery authority.

### Confirmed unknowns and validation requirements

- The official pages do not state that every non-admin user can create or
  update a Personal Agent app in every managed tenant. Validate with one
  ordinary member and one administrator in both Feishu and Lark.
- The public one-click page does not explicitly state whether the generated app
  is internally classified as a custom app, although the per-tenant credential
  and long-connection contract strongly imply it.
- The official Node Channel SDK and CLI do not claim Cloudflare Workers
  compatibility. Both assume process-oriented behavior; run a real runtime
  spike before choosing a Worker deployment.
- Permission parity is not guaranteed across Feishu and Lark. The official CLI
  already brand-filters unsupported domains; OpenMeld must capture and display
  the actual granted scopes and tools for each connection.
- A large permission grant does not prove business capability. The acceptance
  test must execute at least one real read and one real write in each enabled
  capability pack, under the intended user identity.

These are engineering unknowns or validation obligations, not confirmed
platform limitations.

## Primary source index

### Lark / Feishu

- [Official Node SDK](https://github.com/larksuite/node-sdk)
- [Official Node Channel SDK reference](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md)
- [Official Lark/Feishu CLI](https://github.com/larksuite/cli)
- [Official CLI PersonalAgent registration source](https://github.com/larksuite/cli/blob/main/internal/auth/app_registration.go)
- [Official CLI user-scope selection source](https://github.com/larksuite/cli/blob/main/cmd/auth/login.go)
- [Official CLI authorization rules](https://github.com/larksuite/cli/blob/main/skills/lark-shared/SKILL.md)
- [Agent integration capability overview](https://open.larksuite.com/document/mcp_open_tools/overview-of-lark-agent-integration-capabilities)
- [One-click Agent app creation](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview)
- [Official Vercel Chat SDK adapter](https://open.larksuite.com/document/mcp_open_tools/integrating-agents-with-feishu/vercel-chat-sdk-lark-message-publish)
- [Custom app development](https://open.larksuite.com/document/home/introduction-to-custom-app-development/self-built-application-development-process?lang=en-US)
- [Store app publishing guidelines](https://open.larksuite.com/document/isv-guides/publish-your-app/publishing-guidelines)
- [Feishu ISV onboarding](https://open.feishu.cn/document/isv-guides/publish-your-app/step1-complete-the-entry)
- [Custom versus store app token behavior](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN)
- [Tenant access token](https://open.larksuite.com/document/server-docs/getting-started/api-access-token/auth-v3/tenant_access_token_internal)
- [Application authorization model](https://open.larksuite.com/document/home/introduction-to-scope-and-authorization/overview)
- [User identity model](https://open.feishu.cn/document/platform-overveiw/basic-concepts/user-identity-introduction/larkid?lang=zh-CN)
- [Event overview and retry contract](https://open.larksuite.com/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM)
- [Long-connection guide](https://open.larksuite.com/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/use-websocket)
- [Send-message API](https://open.larksuite.com/document/server-docs/im-v1/message/create)
- [Reply-message API](https://open.larksuite.com/document/server-docs/im-v1/message/reply)
- [Scope catalog](https://open.larksuite.com/document/ukTMukTMukTM/uYTM5UjL2ETO14iNxkTN/scope-list)
- [Card callback contract](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN)
- [Event callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN)

### Slack

- [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)
- [App lifecycle and distribution](https://docs.slack.dev/app-management/distribution/)
- [Events API](https://docs.slack.dev/apis/events-api/)
- [HTTP versus Socket Mode](https://docs.slack.dev/apis/events-api/comparing-http-socket-mode/)
- [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [Verifying Slack requests](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)
- [Block Kit](https://docs.slack.dev/block-kit/)
- [Handling interactions](https://docs.slack.dev/interactivity/handling-user-interaction/)
- [Direct-message event](https://docs.slack.dev/reference/events/message.im)
- [App-mention event](https://docs.slack.dev/reference/events/app_mention/)

## 2026-07-17 follow-up: WebSocket versus Webhook and exact SDK reuse

### Decision

For the QR-created `PersonalAgent` validation lane, WebSocket is a legitimate
first-party production transport, not merely a local-development trick.
However, it does not unlock a Center Agent business capability that Webhook
lacks. Message events, reactions, bot membership events, document-comment
events, modern card actions, attachment metadata, and outbound CardKit
streaming can all be supported with either inbound transport. Sending,
replying, downloading resources, updating cards, and native streaming are
outbound OpenAPI operations and do not travel over the inbound WebSocket.
([one-click Agent preset](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview),
[long-connection events](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case),
[callback overview](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview),
[official Channel SDK](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

The practical OpenMeld decision is therefore:

- **Production-shaped first transport: Webhook.** It directly reuses the
  existing HTTP Gateway, durable Queue acceptance, horizontal edge scaling,
  ingress ledger, and native-delivery lifecycle. It also remains compatible
  with a later store-app distribution model, for which long connection is not
  supported.
- **Supported secondary transport: WebSocket connector.** Keep transport out
  of the normalized message-channel contract so OpenMeld can add a persistent
  connector without changing Core. Use it when a real validation shows that
  automatic Webhook configuration is blocked, when the QR-created app needs to
  work immediately with its default settings, or when a dedicated persistent
  runtime is already justified for other providers.
- **Disposable platform spike: WebSocket.** It is the fastest way to prove
  PersonalAgent registration, messages, cards, resources, and streaming
  because the QR-created app defaults to long connection and the official
  Channel SDK implements it directly.

This is not an architectural ban on WebSocket. It is a sequencing decision:
preserve a transport seam now, ship on the already-operated durable ingress
path, and add the persistent connector only when it buys an observed product
or operational advantage.

### Official transport facts

| Question | WebSocket long connection | Developer-server Webhook |
| --- | --- | --- |
| Supported application type | Only custom/self-built apps. The QR-created PersonalAgent preset defaults to this mode. | Custom apps and the required path for future store apps. |
| Public endpoint | Not required; the client opens an outbound connection. | Required, with a challenge/configuration flow. |
| Authentication and payload security | SDK authenticates during connection establishment; the SDK owns transport encryption and callers do not separately verify/decrypt each push. | The receiver must validate the verification token and decrypt encrypted payloads when configured. |
| Event processing deadline | Handler must complete within three seconds without throwing, otherwise a repush is triggered. | HTTP 200 is required within three seconds, otherwise the event is retried. |
| Published event retry detail | The official long-connection page confirms timeout repush but does not publish the exact retry timetable. | The official event overview publishes 15 seconds, 5 minutes, 1 hour, and 6 hours, up to four retries. |
| Callback processing | Modern callbacks such as `card.action.trigger` are supported; three-second synchronous response. | Modern callbacks are supported; three-second synchronous HTTP response. |
| Callback retry | Callbacks are synchronous and have no repush mechanism. This is a callback property, not a transport difference. | Same. |
| Legacy card callback | The old message-card callback is not supported over long connection. | Supported. |
| Multiple replicas | Cluster delivery, not broadcast: one random connected client receives a push. | Ordinary HTTP load balancing; one request reaches one receiver. |
| Connection limit | At most 50 client connections per app; each initialized client consumes one. | No per-app persistent client connection to operate. |
| Inbound payload/business events | Same selected event/callback contracts. | Same selected event/callback contracts. |
| Outbound replies, media, CardKit streaming | OpenAPI calls; independent of inbound transport. | OpenAPI calls; independent of inbound transport. |

Primary sources:
[long-connection event limits](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case),
[long-connection callback limits](https://open.feishu.cn/document/server-side-sdk/golang-sdk-guide/handle-callback?lang=zh-CN),
[event retry and `event_id`](https://open.larksuite.com/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM),
[callback semantics](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview),
[card callback timing](https://open.larksuite.com/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/handle-card-callbacks).

The latest platform docs supersede an older sentence still present in the
Node SDK's root README that says long connection does not support callbacks.
The current Feishu callback guide, the current PersonalAgent preset, and the
current `WSClient` source all support event and modern callback dispatch over
the same long connection. Use those current sources, not the stale README
sentence.
([PersonalAgent callback preset](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview),
[current callback guide](https://open.feishu.cn/document/server-side-sdk/golang-sdk-guide/handle-callback?lang=zh-CN),
[current Node `WSClient`](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts))

### Reliability and acknowledgement implications

Neither transport should run the Center Agent inside the platform's
three-second handler:

1. Validate enough of the provider envelope to identify the connection and
   event.
2. Durably accept the event into OpenMeld Queue.
3. Acknowledge the Lark/Feishu platform only after Queue acceptance.
4. Let Core deduplicate on the provider event ID and own the long-running
   Center Agent execution.

The official Node `WSClient` awaits `EventDispatcher.invoke()` and only then
sends its response frame. A WebSocket connector can therefore use exactly the
same durable-accept rule as the HTTP Gateway: its dispatcher handler enqueues
and returns within the deadline. It must not call the Agent directly.
([official `WSClient` acknowledgement source](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts))

Card actions are different from ordinary events. They are synchronous
callbacks with no platform repush. The receiver may return a small immediate
result such as a toast or empty acknowledgement, then update the card
asynchronously through CardKit. The official card FAQ states that a handler
that cannot finish in three seconds can return `{}` and use the callback token
for a delayed update within 30 minutes. OpenMeld should keep this bounded
interactive response separate from the durable Center Agent execution.
([callback overview](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview),
[card callback FAQ](https://open.feishu.cn/document/common-capabilities/message-card/message-card))

The public docs do not state a stronger backlog or delivery SLA for events
created while every WebSocket client is disconnected. They document repush
after a received event times out, but do not document the exact long-connection
repush schedule. Therefore, it would be an unsupported inference to claim that
WebSocket is more reliable than the documented HTTP retry contract. A real
disconnect/reconnect test must be part of any WebSocket production acceptance.

### PersonalAgent scaling consequence

`WSClient` is configured with exactly one App ID/App Secret. If OpenMeld
creates one PersonalAgent app for every connected OpenMeld account, the
production connector needs one live connection per connected app. The
platform's "50 connections per app" limit is not the immediate constraint when
OpenMeld normally opens one or two connections per app. The real cost is the
linear fleet responsibility:

- credential-to-connector placement;
- process restart and reconnect reconciliation;
- liveness, reconnect-exhaustion, and credential-error monitoring;
- controlled failover without assuming a particular replica owns an event;
- hundreds or thousands of sockets rather than one shared HTTP ingress;
- Lark and Feishu regional egress and operational diagnostics.

Running two clients for one app can provide process redundancy, but cluster
delivery is random and not broadcast. Both clients must submit into the same
durable Queue and rely on the same event ledger. Local process memory cannot
be execution authority.
([connection limit and cluster delivery](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case),
[official reconnect implementation](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts))

This makes WebSocket particularly attractive when there are only a few pilot
apps or when OpenMeld already operates a persistent connector fleet. It makes
Webhook more attractive when the number of QR-created apps grows and the
existing Cloudflare Gateway can receive all of them through a shared route.

Latency is not a deciding fact today. Long connection can plausibly remove
some HTTP setup overhead, but the official documentation publishes no
comparative latency SLA, and Center Agent execution time is likely much larger
than the ingress difference. This remains an engineering hypothesis to measure,
not a platform fact.

### Cloudflare can open outbound WebSockets, but does not remove socket ownership

The current Cloudflare platform can act as a WebSocket client. A Worker can
create an outbound WebSocket, and a Durable Object can keep an outbound
WebSocket as part of its instance state. Therefore, "Cloudflare cannot connect
to Lark over WebSocket" is no longer a valid reason to reject long connection.
([Workers WebSocket client example](https://developers.cloudflare.com/workers/examples/websockets/),
[Durable Objects WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/))

The lifecycle contract still makes a long-lived Lark connector materially
different from OpenMeld's existing request/Queue path:

- Durable Object WebSocket hibernation applies when the Durable Object accepts
  WebSockets as a server. An outbound WebSocket for which the Durable Object is
  the client does not hibernate.
- An active outbound WebSocket prevents Durable Object eviction for at most 15
  minutes. After that, the connection can remain open, but normal eviction
  rules apply again.
- Outbound WebSockets count toward the Worker's simultaneous open-connection
  limit.

([Durable Object WebSocket hibernation boundary](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[outbound connection lifecycle change](https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/),
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/))

A Durable Object per PersonalAgent app is a plausible design, but it still
requires explicit reconnect alarms, connection-health state, credential
rotation, ownership fencing, failover, and a durable event acceptance path.
It must be proven against the Lark SDK or a Worker-native protocol client
before being treated as a stable permanent connection host. A dedicated Node
connector service is the other plausible design and fits the official SDK
runtime more directly, but introduces another deployed runtime.

Neither design changes the recommendation for the first production transport:
Webhook already fits the current Gateway and Queue, while a production
WebSocket fleet currently adds lifecycle work without adding a required Center
Agent capability. Preserve the transport seam and test WebSocket, but do not
make that extra runtime a launch dependency.

### Exact value of the official Node Channel SDK

The current public Channel module is much more than a WebSocket wrapper. It
provides:

- normalization of text, rich post, image, file, audio, video, sticker,
  shared user/chat, location, calendar, todo, vote, system, interactive card,
  merge-forward, and fallback message shapes;
- stable normalized message fields for sender, chat type, mentions,
  `mentionedBot`, resources, reply/root/thread relationships, and timestamps;
- modern card actions, reactions, bot-added events, and document comments;
- markdown conversion, structured mentions, message splitting, media upload,
  SSRF checks, format fallbacks, and error classification;
- CardKit native typewriter streaming with throttling, ordered sequence
  updates, rollover before the card-element limit, and idempotent UUIDs for
  CardKit update operations;
- configurable policy checks, stale-event detection, deduplication,
  per-chat serialization, and message batching;
- low-level `Client`, resource download, reactions, chat lookup, and raw
  OpenAPI escape hatches.

([Channel reference](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md),
[Channel public exports](https://github.com/larksuite/node-sdk/blob/main/channel/index.ts),
[normalizers](https://github.com/larksuite/node-sdk/tree/main/channel/normalize),
[outbound implementation](https://github.com/larksuite/node-sdk/tree/main/channel/outbound),
[safety implementation](https://github.com/larksuite/node-sdk/tree/main/channel/safety))

There are three different reuse levels:

1. **Directly reusable in a dedicated Node WebSocket connector.** Use
   `WSClient` + `EventDispatcher` for the thinnest raw durable-ingress bridge,
   or `createLarkChannel()` when its normalization and conversational features
   are wanted in the connector. In either case, the handler should only
   normalize/enqueue/ack; Core remains the execution authority.
2. **Potentially reusable public normalizers.** The package publicly exports
   `normalize`, `normalizeCardAction`, `normalizeReaction`,
   `normalizeBotAdded`, `normalizeComment`, their raw-event types, and
   normalized contracts. These are useful for a Node conformance harness and
   can be evaluated for a production adapter.
3. **Conformance reference for Worker code.** The source and tests precisely
   document tricky provider behavior even if OpenMeld does not import the
   package: merge-forward tree reconstruction, mention removal, message
   resource descriptors, thread/root/reply relationships, CardKit sequences,
   content limits, fallback errors, and media handling.

It is not currently a drop-in Cloudflare Worker dependency. The published
`@larksuiteoapi/node-sdk@1.71.1` package is a monolithic Node package: the npm
tarball contains approximately 5.5 MB CommonJS, 5.5 MB ESM, and 16.9 MB of
types, and depends on Axios, Node `ws`, `Buffer`, Node streams, filesystem
paths, and process-lifetime timers. The official project makes no Cloudflare
Workers compatibility claim. Tree-shaking or `nodejs_compat` might make a
subset work, but that requires a real bundle/runtime spike; it is not a
confirmed property.
([official package manifest](https://github.com/larksuite/node-sdk/blob/main/package.json),
[media uploader source](https://github.com/larksuite/node-sdk/blob/main/channel/outbound/media/uploader.ts),
[WS client source](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts),
[npm package](https://www.npmjs.com/package/@larksuiteoapi/node-sdk))

More importantly, the official WebSocket lifecycle assumes a process owner:
`connect()` establishes one app-specific socket, process-lifetime timers drive
ping and reconnect, and shutdown closes that client. The official Vercel
adapter explicitly says initialization keeps the process alive until shutdown.
A request-scoped Cloudflare Gateway handler cannot be assumed to own that
lifecycle after its request finishes. Supporting WebSocket in OpenMeld
therefore means proving a separate persistent/stateful connector runtime (and
its placement, restart, and health model), not merely calling `WSClient.start()`
inside the existing Worker. This is an engineering inference from the
first-party runtime contract, not a Lark platform prohibition.
([Channel lifecycle](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md),
[official adapter lifecycle](https://github.com/larksuite/node-sdk/blob/main/docs/vercel-chat-adapter/README.md),
[WS reconnect source](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts))

The Channel object's current Webhook facade should also not be assumed to wire
itself into a Fetch handler. Its source accepts `transport: "webhook"` and
constructs a private `EventDispatcher`, but explicitly says HTTP wiring is
external and does not expose that dispatcher through the public Channel API.
For a Node HTTP server, the supported lower-level path is the public
`EventDispatcher` plus the official Node/Express/Koa adapters, or a custom
adapter that invokes the dispatcher. For a Cloudflare Worker, OpenMeld still
needs its own Fetch-compatible verification/decryption boundary.
([Channel source](https://github.com/larksuite/node-sdk/blob/main/channel/channel.ts),
[official Webhook dispatcher examples](https://github.com/larksuite/node-sdk#events-handling))

The outbound sender must not be adopted unchanged as OpenMeld's final
publication authority. It retries errors classified as `rate_limited` or
`unknown`, falls back from a vanished reply target to a fresh message, and does
not pass the Reply API's optional `uuid` on ordinary create/reply sends. An
ambiguous network outcome followed by an `unknown` retry can therefore create
a duplicate visible message. OpenMeld must retain its durable publication
claim and outcome-unknown rule, and should supply deterministic provider UUIDs
where the OpenAPI supports them. The SDK's CardKit streaming updates are safer:
they already generate UUIDs from card ID plus sequence.
([retry source](https://github.com/larksuite/node-sdk/blob/main/channel/outbound/retry.ts),
[sender and CardKit UUID source](https://github.com/larksuite/node-sdk/blob/main/channel/outbound/sender.ts),
[Reply API](https://open.larksuite.com/document/server-docs/im-v1/message/reply))

Likewise, Channel safety is process-local by default. Its default dedup cache
is memory-only unless a persistent cache is injected, its processing lock is
in-memory, and some duplicate/stale/locked cases are silently dropped. These
are useful bot-library safeguards but cannot replace OpenMeld Queue acceptance,
the durable ingress ledger, or native-delivery execution truth.
([dedup cache source](https://github.com/larksuite/node-sdk/blob/main/channel/safety/dedup-cache.ts),
[processing lock source](https://github.com/larksuite/node-sdk/blob/main/channel/safety/processing-lock.ts),
[Channel safety behavior](https://github.com/larksuite/node-sdk/blob/main/docs/channel.md))

### Exact value of `@larksuite/vercel-chat-adapter`

The official adapter is a thin bridge from the official Channel SDK into
Vercel Chat SDK. Its useful, executable provider decisions include:

- `lark:{chatId}:{rootId}` thread encoding;
- using `root_id` or `message_id` as the reply root, not native `thread_id`
  (`omt_*`), because the reply API expects a message ID;
- translation of 23 provider message shapes through the Channel normalizer;
- Lark emoji mapping and reaction behavior;
- history fetch, single-message fetch, client-side thread grouping, channel
  info, direct-message opening, editing, deletion, and streaming;
- translation from Chat SDK formatted content/stream chunks into Channel
  markdown and native CardKit typewriter streaming;
- a documented feature matrix that exposes unsupported concepts such as
  typing indicators, modals, and ephemeral messages.

([official adapter guide](https://github.com/larksuite/node-sdk/blob/main/docs/vercel-chat-adapter/README.md),
[official npm package](https://www.npmjs.com/package/@larksuite/vercel-chat-adapter))

It is not a suitable OpenMeld production dependency as a whole:

- version `0.1.2` is WebSocket-only and returns HTTP 501 from
  `handleWebhook()`;
- it is single-app only and explicitly says multi-app/multi-tenant fan-out is
  future work;
- `initialize()` opens a WebSocket and expects a long-running process until
  shutdown;
- it delegates durable subscription/dedup/locking to the Vercel Chat SDK
  `StateAdapter`, introducing a second conversation-state system;
- it keeps direct-message classification in a process-local cache, and
  documents that the first DM after restart can be misrouted until the cache
  is repopulated;
- it sets `persistMessageHistory = false` and fetches provider history on
  demand;
- it does not implement OpenMeld Organization mapping, member authorization,
  Center Agent selection, durable Queue acceptance, native delivery, fenced
  publication, or outcome-unknown semantics.

Its best value to OpenMeld is therefore **executable conformance**, not an
alternate conversation engine. OpenMeld should use its thread rules, message
normalization expectations, reaction mapping, history behavior, and feature
matrix as test oracles. Importing the full adapter would add Vercel Chat state
and a WebSocket lifecycle while still leaving the important OpenMeld-specific
work unfinished.

### Fastest non-duplicative implementation sequence

1. Define one provider-neutral ingress function used by either transport:
   `acceptMessageChannelEvent(connectionId, providerEventId, normalizedEvent)`.
   Its only success condition is durable Queue acceptance.
2. Keep raw Lark/Feishu verification and payloads at the provider boundary.
   Normalize once into the shared message-channel event and typed conversation
   locator before crossing the Queue.
3. Implement the Webhook receiver first because it plugs into the existing
   Gateway and scales all PersonalAgent apps behind one service. Route each
   connection through an opaque path or another pre-decryption lookup so the
   correct per-app verification/encryption material is available.
4. Implement outbound OpenAPI and CardKit as a provider publication adapter.
   Reuse the official normalizer contracts and CardKit behavior as
   conformance references, but retain OpenMeld's durable publication claim.
5. Build a separate official-Node-SDK smoke harness that connects one Feishu
   and one Lark PersonalAgent app over WebSocket. Use it to capture real event
   fixtures and validate DMs, group mentions, replies, threads, resources,
   reactions, document comments, card actions, reconnect behavior, and native
   streaming.
6. Preserve a `webhook | websocket` connection-transport field and the same
   queue envelope. If Webhook auto-configuration is blocked in real tenants,
   promote the smoke harness into a small sharded persistent connector. No Core
   or native-delivery redesign should be required.
7. Do not operate both transports for one app at the same time unless a tested
   migration procedure requires it. Provider configuration chooses one
   subscription mode; duplicate transport ownership would complicate
   diagnostics without adding product value.

This sequence obtains immediate first-party protocol truth from WebSocket
without making a new persistent connection fleet a prerequisite for the
production channel.

### Context7 check

The requested Context7 CLI was retried before this follow-up research:

```text
npx ctx7@latest library "Lark Node SDK" "<transport and SDK question>"
```

It returned `Monthly quota reached` and stated that 20 bonus API requests would
be available the next day. No Context7 documentation result was used. The
findings above were instead verified against the current Feishu/Lark official
documentation, the current first-party `larksuite/node-sdk` source, and the
official published npm packages. This is an explicit fallback after the
required CLI attempt, not an answer from model memory.

## 2026-07-18 current-code audit: simultaneous Slack and Lark per Organization

### Direct answer

The current OpenMeld code does **not** yet let an Organization connect or
receive messages from Lark/Feishu. There is no Lark connection record, ingress
route, identity mapper, worker trigger, native-delivery locator, publication
adapter, RPC, or Settings row in the current tree.

The current architecture can, however, cleanly support the requested product:

- one Organization may have its existing Slack workspace connection and one
  Lark/Feishu tenant connection at the same time;
- both connections resolve to the Organization's one canonical Center Agent
  designation;
- a request that originates in Slack receives its final result only in the
  originating Slack conversation;
- a request that originates in Lark receives its final result only in the
  originating Lark conversation;
- disconnecting either provider must not disconnect or invalidate the other.

No current database constraint says that an Organization may have only one
Channel provider. The existing constraint says only that an Organization may
have one Slack workspace: the Slack binding and token tables each have a unique
Organization index (`packages/db/src/core/dispatch.schema.ts:440-465`,
`packages/db/src/core/dispatch.schema.ts:525-563`). The OAuth behavior test
expressly calls this the "one-workspace-per-organization" guard, not a
one-Channel guard
(`services/core/tests-node/slack-oauth-installation.test.ts:909-933`).
A separate provider-scoped Lark connection can therefore coexist with that
Slack connection without weakening the Slack ownership invariant.

This matches the current product model. Channels are provider-native places
where a member can message the Center Agent, Slack is only the first shipped
Channel, and future collaboration platforms may join
(`developing/product/organizations-and-center-agent.md:561-573`). The model
also deliberately separates Channels from Apps and permits the same provider
to be connected independently in each family
(`developing/product/organizations-and-center-agent.md:622-628`).

### What "the same Center Agent" means

There is at most one active Center Agent designation per Organization. The
database uniqueness constraint and repository lookup are both keyed by
`organizationId`
(`packages/db/src/core/center-agent.schema.ts:13-52`,
`services/core/src/center-agent/center-agent-repository.ts:103-181`).
Slack currently resolves its workspace binding to an Organization and then
reads that Organization's Center Agent target
(`services/core/src/remote-agent/application/slack-signal-service.ts:439-456`,
`services/core/src/remote-agent/application/slack-signal-service.ts:1099-1147`).
Lark should perform the same provider-to-Organization resolution and call the
same target resolver.

Therefore "the same Center Agent" means the same:

- Center Agent Profile identity and hosted-runtime Binding;
- Organization membership and authorization boundary;
- model, tool policy, Organization context, and durable Center Agent memory
  policy;
- Core-owned admission policy and Organization-wide daily quota;
- audit and native-delivery correctness guarantees.

It does **not** mean that a Slack thread and a Lark thread become one transcript,
or that one answer is mirrored into both products. Every provider conversation
must have a collision-proof canonical conversation identity, for example:

```text
slack:<workspace-id>:<channel-id>:<thread-id>
lark:<deployment>:<tenant-id>:<chat-id>:<thread-or-message-id>
```

The worker Durable Object name is derived from the submitted conversation
identifier (`services/remote-agent/agent-core/submission.ts:103-107`,
`services/remote-agent/flue-adapter/cloudflare-entrypoint.ts:39-85`).
Distinct provider-prefixed identifiers consequently allow Slack and Lark turns
to run concurrently without merging their histories, while both turns still
carry the same `organizationId`, Center Agent Profile, and Binding.

The daily admission limit is intentionally shared across the Organization, not
allocated per provider. The current ledger is keyed by Organization and UTC
day (`packages/db/src/core/dispatch.schema.ts:360-394`), and the owner document
defines one Organization-wide limit for all Remote Agent entry surfaces
(`developing/product/remote-agent-runtime.md:262-278`). Lark should join that
same limit rather than creating an independent quota.

### What can be reused directly

The expensive Center Agent execution and reliability machinery already exists
and should remain single-source:

1. The canonical Center Agent designation, hosted-runtime Binding resolution,
   and Organization authorization.
2. Core admission, durable native-delivery ledger, idempotency, recoverable
   submission, daily quota, watchdog, callback identity checks, and terminal
   publication fencing.
3. The Remote Agent worker, Flue admission, agent loop, shared Center Agent
   tools, audit, and memory infrastructure.
4. Gateway-to-Queue-to-Core durability. Slack already verifies at the edge and
   acknowledges only after queue submission
   (`services/gateway/src/routes/slack-events.ts:11-92`). Gateway and Core both
   bind the same durable queue
   (`services/gateway/wrangler.jsonc:96-103`,
   `services/core/wrangler.jsonc:118-133`), and Core already has a queue router
   that distinguishes payload families
   (`services/core/src/shared/queue/core-queue-router.ts:1-35`).
5. The provider-neutral `ChannelContext` contract. It already contains
   `provider`, `conversationId`, the verified current message, synchronization
   status, and bounded history
   (`packages/schemas/src/schemas/runtime/channel-context.ts:36-45`). The owner
   document explicitly says Slack is only its first producer and every future
   chat adapter translates into this shared contract
   (`developing/product/remote-agent-runtime.md:255-260`,
   `developing/architecture/shared-contracts.md:553-591`).
6. The rule that one conversation produces one native result surface. Current
   architecture selects the result surface by conversation kind and treats
   explicit cross-provider posting as a separate audited side effect
   (`developing/product/remote-agent-runtime.md:104-127`,
   `developing/product/remote-agent-runtime.md:181-190`).

These parts should be called through provider-neutral contracts. They should
not be copied into a second `lark-native-delivery-service` or a parallel Lark
worker.

### What is still Slack-specific and must be extracted or generalized

The current Slack implementation is not merely a thin adapter. Several reusable
responsibilities and Slack protocol details are still mixed together.

#### 1. Connection ownership and credentials

Slack owns separate binding and encrypted-token tables
(`packages/db/src/core/dispatch.schema.ts:440-563`) and its repository enforces
workspace and Organization conflicts
(`services/core/src/remote-agent/infrastructure/d1/slack-workspace-binding-repo.ts:82-218`).
OAuth installs the binding, token, and audit entry atomically
(`services/core/src/remote-agent/application/slack-oauth-installation.ts:12-125`).

Lark needs equivalent provider-specific credential handling, but the canonical
Channel projection should be provider-neutral. For the first supported
cardinality, enforce:

```text
UNIQUE (organization_id, provider)
UNIQUE (provider, external_tenant_id)
```

The first constraint permits exactly one Slack plus one Lark connection in the
same Organization. The second prevents one external tenant from being claimed
by two OpenMeld Organizations. If Feishu and international Lark app
deployments use different identifier namespaces, the provider key or typed
deployment field must be part of the external key.

Slack's existing tables may remain as credential-storage implementation detail
during a receiver-first migration, but there must ultimately be one canonical
Channels read projection. Adding unrelated permanent `slackConnection` and
`larkConnection` fields to every Center Agent API would preserve two
provider-shaped authorities and cause drift.

#### 2. Ingress normalization

The current queue envelope is strict and Slack-only:
`kind: "remote_agent_slack_event"`
(`packages/schemas/src/schemas/runtime/remote-agent-slack.ts:36-44`).
The Slack consumer parses that payload, invokes the Slack processor, and owns
retry/redrive behavior
(`services/core/src/remote-agent/transport/queue/slack-event-queue-consumer.ts:14-145`).

Lark should have a provider edge adapter that verifies the Lark event, handles
the provider challenge/deduplication requirements, and emits a shared normalized
message-channel event. The shared envelope must preserve:

- provider and provider deployment;
- connection/tenant identity;
- provider event ID and event timestamp;
- sender ID;
- conversation ID and thread/message anchor;
- normalized message text and resource references;
- trace and idempotency identity.

Webhook and long-lived WebSocket receipt can both terminate at this same
normalization boundary. Transport selection must not create a second Core
execution path.

#### 3. Signal orchestration

`slack-signal-service.ts` currently combines payload parsing, claim/retry,
workspace lookup, Center Agent target resolution, sender identity, context
fetch, memory, ledger creation, and worker submission
(`services/core/src/remote-agent/application/slack-signal-service.ts:148-275`,
`services/core/src/remote-agent/application/slack-signal-service.ts:404-635`).
That is the main extraction required before a clean second Channel.

Extract a provider-neutral Message Channel orchestration service whose inputs
are:

```text
verified connection
+ normalized event
+ verified OpenMeld member
+ typed conversation locator
+ normalized ChannelContext
```

It should own Organization/Center-Agent resolution, durable claim, admission,
memory selection, worker submission, and publication registration. Slack and
Lark adapters should own only provider signatures, tokens, API calls, provider
identity lookup, provider history fetch, and provider publication.

#### 4. External sender identity

Slack's durable identity link is scoped by `(slackTeamId, slackUserId)`
(`packages/db/src/core/dispatch.schema.ts:700-739`). The signal service first
checks that link and current Organization membership, then may resolve an exact
email match and persist the mapping
(`services/core/src/remote-agent/application/slack-signal-service.ts:754-830`).

Lark needs the same semantic behavior through a provider-neutral identity link:

```text
(provider, connection_id, provider_user_id)
    -> (organization_id, openmeld_user_id, resolution_source)
```

It must not store a Lark `open_id` without its app/connection scope, because
that identifier can be application-scoped. A person linked in both Slack and
Lark should resolve to the same OpenMeld user and therefore receive the same
Organization permissions and member-memory subject. The two provider identity
records nevertheless remain independently revocable.

#### 5. Native-delivery locator and publication

This is the largest current Slack-only seam. The ledger conversation kind is
currently only `"slack" | "space"`, and its record includes Slack team,
channel, and thread columns
(`services/core/src/remote-agent/infrastructure/d1/native-delivery-ledger-repo.ts:10-73`,
`packages/db/src/core/dispatch.schema.ts:273-358`).
The native-delivery service hardcodes the Slack kind and locator on submission
(`services/core/src/remote-agent/application/native-delivery-service.ts:589-675`)
and has Slack-specific callback publication branches
(`services/core/src/remote-agent/application/native-delivery-service.ts:5985-6025`,
`services/core/src/remote-agent/application/native-delivery-service.ts:6159-6180`).

Generalize this to one typed message-channel locator, owned by
`packages/schemas`, conceptually:

```text
conversationKind: "space" | "message_channel"
messageChannelLocator:
  provider
  connectionId
  conversationId
  threadOrMessageId
```

Publication then dispatches through a provider adapter such as
`publishFinalReply` or `publishVisibleFailure`. The existing ledger,
idempotency key, publication claim, uncertain-outcome handling, watchdog, and
callback validation stay unchanged.

This must be a compatibility migration, not a destructive rewrite. Existing
Slack ledger evidence remains readable; Slack rows are backfilled or adapted
to the typed locator; receivers learn the generic form before senders emit it.

#### 6. Turn envelope and memory source

The shared turn trigger still has an explicit Slack variant and no generic
external-message-channel variant, and durable memory sources include
`slack_conversation` only
(`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts:86-124`).
The envelope's `channelContext` field is already generic
(`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts:144-153`).

Add a provider-neutral message-channel trigger and memory source carrying the
provider and typed locator. Do not solve this by adding a second permanent
Lark-only branch next to every Slack check. Slack-specific agent tools may
remain explicit capabilities, while the base Center Agent turn and common
tools consume the generic trigger.

#### 7. Settings and RPC projection

The Settings page has a generic Channels title but renders exactly one Slack
row
(`clients/web/src/components/organizations/organization-message-channels-page.tsx:23-129`,
`clients/web/src/components/organizations/center-agent-message-channels-section.tsx:72-125`).
The Center Agent HTTP response embeds an optional `slackConnection`, and its
mutation responses are Slack-specific
(`packages/schemas/src/schemas/http/center-agent.ts:180-230`). Gateway and Core
likewise expose only Slack connect/disconnect routes and methods
(`services/gateway/src/routes/rpc-http.center-agent.ts:41-142`,
`services/core/src/rpc/methods.ts:4567-4600`,
`services/core/src/rpc/methods.ts:5019-5090`,
`services/core/src/rpc/methods.ts:5318-5367`).

Create a canonical Organization Channels projection whose rows use stable
provider identity and provider-specific connection status. Keep Center Agent
designation/runtime state separate. Settings can then render Slack and Lark
rows from the same list, and a Lark disconnect mutation cannot accidentally
alter Slack state.

### Recommended implementation sequence

1. Define provider-neutral shared schemas for Channel connection projection,
   normalized ingress event, conversation locator, queue envelope, turn
   trigger, and memory source.
2. Introduce provider-scoped connection and external-identity ownership with
   the cardinality rules above. Expose a canonical Channels read API.
3. Extract the common orchestration from `slack-signal-service.ts` and put
   current Slack behavior behind the new adapter contracts without changing
   user-visible Slack behavior.
4. Generalize the native-delivery locator and publication dispatch. Migrate
   existing Slack evidence compatibly and keep one ledger/claim/watchdog path.
5. Add the Lark/Feishu installation flow, credentials, verified ingress, sender
   resolver, context adapter, and publication adapter. Both Webhook and
   WebSocket transports feed the same normalized ingress contract.
6. Render independent Slack and Lark connection rows in Organization Settings.
7. Run real-provider smoke only after contract tests prove the simultaneous
   connection and isolation invariants.

This order reuses the expensive runtime immediately while removing the
Slack-shaped assumptions at the boundaries where a second provider would
otherwise create permanent duplication.

### Required acceptance evidence

At minimum, tests and real smoke must prove all of the following:

- the same Organization can own one Slack connection and one Lark connection;
- a Slack event and a Lark event both resolve to the exact same Center Agent
  Profile and Binding;
- provider-prefixed conversation identities cannot collide;
- simultaneous Slack and Lark turns retain their own callback locators;
- each final reply appears only on its originating provider;
- duplicate event claims are scoped by provider/connection/event ID;
- the same human can have independent Slack and Lark identity links to one
  OpenMeld member;
- an unmapped or non-member sender fails closed;
- disconnecting Lark leaves Slack connected and usable, and vice versa;
- the Organization-wide daily quota is shared and an idempotent replay does not
  consume it twice;
- Slack behavior remains unchanged after the common orchestration extraction;
- Feishu and international Lark identifier namespaces cannot claim or overwrite
  each other accidentally.

### Architecture judgment

The requested simultaneous Slack-and-Lark product is consistent with the
current owner documents because it keeps one canonical Center Agent, one
Organization authority boundary, one worker path, one native-delivery
reliability path, and exactly one result surface per originating conversation.

The non-compliant implementation would be to clone Slack end to end into a
parallel Lark signal service, Lark delivery ledger, Lark worker path, and
provider-shaped Center Agent state. That would create duplicate truth for
admission, result routing, identity, diagnostics, and execution. The practical
long-term path is therefore **adapter-specific protocol edges around one shared
Message Channel orchestration and native-delivery core**.

## 2026-07-18 adversarial revalidation after Fabel5 review

This section supersedes four drifted or incomplete claims above. Historical
research remains visible so the decision change is auditable.

### The current SDK can select a minimal template for a newly created app

The official Node SDK at commit
[`8b3e0df3af9401c263dc96026e1c7f17460a21cc`](https://github.com/larksuite/node-sdk/tree/8b3e0df3af9401c263dc96026e1c7f17460a21cc)
documents and implements `addons.preset: false`. For a new app, this drops the
default business template and starts from a minimal bot base plus explicitly
declared scopes, events, and callbacks.

This supersedes the earlier blanket statement that the one-click preset cannot
be removed. Two limitations remain:

- the SDK source says the add-on configuration may depend on platform rollout,
  and an unsupported add-on payload may be ignored;
- updating an already granted app must be treated as additive. A smaller
  requested fixture is not proof that old grants were removed.

The product plan therefore requires a real Feishu-and-Lark gate. Use the
channel-only template when the brand honors it; otherwise use the unchanged
official preset as a bounded fallback. Neither path adds business-domain
scopes for this Channel implementation.

### Business user OAuth does not belong in the Channel implementation

Current OpenMeld owner documents define Channels as conversation/reply surfaces
and Apps as independent external-system access. Core owns App registration and
authorization facts; OpenConnector is the current App credential and action
executor. A provider may exist in both families, but one connection never
authorizes the other.

Therefore the Channel plan must not create a Lark-platform user refresh-token
table, request broad business user OAuth, or register Feishu/Lark business
tools. A separate reviewed App design may later change the execution owner, but
that decision must update the owner documents rather than entering through the
Channel credential.

### Webhook configuration and mainland reachability are prerequisite facts

The official SDK states that event subscription type, request URLs, security
configuration, and encrypt keys cannot travel through registration add-ons and
must use the
[application-config Patch API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v7/application-v7/application-config/patch).
The QR-created app must therefore be proven switchable from its default
long-connection mode to Webhook for both brands before Webhook-first product
implementation begins.

The SDK's public `registerApp()` owns an in-process timer loop. Its source
implements registration with separate `begin` and `poll` requests, but those
functions are not public exports. A Worker-friendly resumable implementation
is therefore a vendor-derived contract, not a documented SDK API. It must be
isolated, pinned to a reviewed SDK commit, and verified against both brands. If
that contract is unsupported or unstable, OpenMeld needs a reviewed persistent
Node registration service that uses the public helper.

Feishu's
[event-callback optimization guide](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide)
recommends a server in mainland China to preserve the three-second response
budget. A real mainland tenant must measure delivery and callback behavior to
the Cloudflare development Gateway. Failed reachability does not automatically
approve WebSocket: the proposed connector deployment region must pass the same
real-tenant SLO, because changing the protocol alone does not remove a
cross-border path.

### Slack orchestration migration moves to Release 6

The earlier recommended sequence moved Slack behind the generic orchestration
before adding Lark/Feishu. The final plan intentionally reverses that migration
timing:

1. shared consumers and generic locator readers land first;
2. Lark and Feishu become the first generic producers and orchestration
   consumers;
3. the current Slack Gateway producer, Queue, ingress claim, and
   `slack-signal-service.ts` remain unchanged through Releases 1–5;
4. Slack adapterization and producer cutover happen in Release 6 behind Slack
   parity tests and real Slack smoke.

This sequence avoids changing the shipped Slack path while the second provider
is still proving the seam. Release 6 still converges all providers on the same
long-term Message Channel orchestration without migrating Slack credentials or
historical ledger evidence.
