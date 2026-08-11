# Feishu and Lark Message Channel Implementation Plan

**Status:** Revised per Fabel5 review 2026-07-18

**Date:** 2026-07-18

**Scope:** OpenMeld Organization Message Channels, hosted Center Agent, Feishu,
Lark, and coexistence with Slack

**Evidence:** [Lark and Feishu Channel integration research](./lark-feishu-channel-integration-research.md)

**Review revalidation sources:** [official Node SDK snapshot](https://github.com/larksuite/node-sdk/tree/8b3e0df3af9401c263dc96026e1c7f17460a21cc),
[application-config Patch API](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v7/application-v7/application-config/patch),
[Feishu event-callback optimization guide](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide),
and [current long-connection event guide](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)

**Fabel5 review landing map:**

| Item | Disposition and landing sections |
| --- | --- |
| B1 | Accepted in principle and tightened in §2.3, §3, §6.3, §8.4, and §17: Package I and all Channel-owned business-action authorization are removed. |
| B2 | Partially accepted and corrected from current official SDK evidence in §2.4, §8.2, §8.5, §14.1, and §23: no business addons; use a verified channel-only template when available, with the unchanged official preset as the bounded fallback. |
| B3 | Accepted with a non-automatic fallback rule in §14.1, §14.3, §17 Gate 0, and §22. WebSocket is promoted only if the tested connector placement, not merely the protocol, resolves the measured problem. |
| B4 | Accepted in §1.1, §7.2, §17 Package D, and §20 Release 6: Slack producer and orchestration remain unchanged through Releases 1–5. |
| B5 | Accepted in §8.6 and §19: development and production use different apps, credentials, connection rows, and public endpoints. |
| B6 | Accepted and strengthened in §5.2 and §8.1: one canonical status union; `connected` is derived rather than stored twice. |
| B7 | Accepted in §6.2–§6.4 and §17 Package C: shared Feishu/Lark tables use the `lark_platform` prefix. |

Two requested changes were deliberately not copied literally:

- an unused `lark_user_authorizations` credential table would create a second
  App credential owner, so it is removed rather than retained;
- current official Node SDK evidence supports `addons.preset: false`, subject
  to platform rollout and real-brand verification, so the plan does not repeat
  the stale claim that the one-click preset can never be dropped.

## 1. Executive Decision

OpenMeld will support **Slack**, **Lark**, and **Feishu** as independent Message
Channel providers that may coexist in the same Organization.

The initial cardinality is:

```text
one Slack connection per Organization
+ one Lark connection per Organization
+ one Feishu connection per Organization
```

One Organization may therefore connect all three providers at the same time.
Each external provider account may belong to only one OpenMeld Organization.

All connected Message Channels resolve to the Organization's one canonical
Center Agent designation and hosted Binding. OpenMeld will not create a
provider-specific Center Agent, worker, memory graph, quota, execution ledger,
or tool catalog.

Each provider conversation remains independent:

```text
Slack request  -> reply only to the originating Slack conversation
Lark request   -> reply only to the originating Lark conversation
Feishu request -> reply only to the originating Feishu conversation
```

There is no automatic mirroring, cross-posting, or transcript merging.

Production inbound delivery will use **Webhook** first. The official long-lived
WebSocket connection will be used as a conformance and real-provider smoke
harness and remains an explicitly supported future transport behind the same
normalized ingress contract. OpenMeld will not operate both transports for one
connection at the same time.

The Message Channel path will remain a direct OpenMeld integration:

```text
Provider -> Gateway -> Queue -> Core -> hosted Center Agent -> Core -> Provider
```

It will not use OpenConnector. OpenConnector remains an App action backend, not
a conversation routing or result-surface authority.

### 1.1 Current code baseline

This plan was reconciled against the current on-disk implementation on
2026-07-18. It is not a greenfield Channel design.

The reusable provider-neutral foundation already includes:

- Organization access control in
  `packages/auth/src/organization/access-control.ts`;
- the shared `ChannelContext` contract in
  `packages/schemas/src/schemas/runtime/channel-context.ts`;
- the one-per-Organization Center Agent designation owner in
  `services/core/src/center-agent/center-agent-repository.ts`;
- hosted Remote Agent admission, Flue execution, Native Delivery, callback
  validation, quota, memory, recovery, and audit infrastructure.

The main provider-specific seams that still require generalization are:

- `packages/schemas/src/schemas/http/center-agent.ts`, whose public projection
  exposes `slackConnection` instead of a provider-neutral Channels list;
- `packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts`, whose
  trigger and memory source explicitly name Slack;
- `services/core/src/remote-agent/application/slack-signal-service.ts`, which
  combines Slack protocol handling with reusable admission orchestration;
- `services/core/src/remote-agent/application/native-delivery-service.ts`,
  which branches directly on the Slack conversation kind and publication
  surface;
- `services/core/src/remote-agent/infrastructure/d1/native-delivery-ledger-repo.ts`,
  whose locator projection includes Slack-specific columns;
- `clients/web/src/components/organizations/organization-message-channels-page.tsx`,
  whose current user experience is effectively a Slack connection surface.

The practical conclusion is:

```text
reuse the existing Center Agent runtime and Native Delivery machinery
+ extract a small provider-neutral Message Channel seam
+ implement one shared Lark-platform adapter with Lark and Feishu hosts
+ move Slack behind the same seam only in Release 6
+ never migrate Slack credentials as part of this plan
```

Implementation must re-run this narrow baseline audit against the then-current
`main` before starting. Concurrent work may change file locations or improve
the generic Native Delivery contracts, but it must not change the ownership
and result-surface invariants defined in this plan without an explicit review.

## 2. Product Contract

### 2.1 What users can do

An Organization owner or admin can:

- connect Slack, Lark, and Feishu independently;
- see the current status and external account for each provider;
- reconnect, repair, or disconnect one provider without affecting the others;
- complete the official Feishu/Lark Personal Agent QR flow;
- inspect actionable setup and delivery diagnostics.

An active Organization member can:

- see connected Message Channels;
- link their Slack, Lark, and Feishu identities to the same OpenMeld account;
- message or mention the same Center Agent from any connected provider;
- receive the answer or explicit failure on the provider where the request
  originated.

### 2.2 Meaning of "the same Center Agent"

Requests from every provider share:

- Center Agent Profile identity, name, handle, model, and hosted Binding;
- Organization membership, role, and represented-member authorization;
- Organization Documents, Projects, Apps, tools, and audit policy;
- member and Organization Memory policy;
- Remote Agent worker admission and Flue execution;
- the Organization-wide daily admission quota;
- watchdog, callback validation, recovery, diagnostics, and publication
  fencing.

They do not share the provider transcript automatically. Current-thread
context, cross-conversation search, and durable Center Agent Memory remain
separate capabilities.

### 2.3 Channel versus App authorization

Feishu/Lark has two conceptually separate grants, but this plan implements only
the first:

1. **Message Channel grant — in scope**
   - creates a Personal Agent application;
   - gives OpenMeld the application identity and bot credentials;
   - enables verified messages, mentions, resources, cards, callbacks, and
     replies.
2. **User App grant — out of scope**
   - authorizes one OpenMeld member to access provider resources as that user;
   - may eventually cover Calendar, Docs, Drive, Tasks, Mail, Contacts, and
     other reviewed business actions.

Connecting the Message Channel never creates, implies, or preauthorizes the
User App grant. The Channel wizard does not ask for business-domain user OAuth.
Any future Feishu/Lark App belongs in **Settings → Apps** and must use the
separately reviewed App credential, authorization, execution, idempotency, and
audit owner.

### 2.4 Channel permission policy for rapid validation

The first release requests only permissions needed for the implemented Message
Channel surface:

- receive verified direct messages and group mentions;
- send and reply as the bot;
- read the bounded current conversation context required by the product;
- upload and download message resources;
- create and update the cards used for progress and final results;
- receive card actions and bot-membership events;
- resolve only the provider identity fields required for explicit OpenMeld
  member linking.

It does not add Calendar, Mail, Tasks, Meetings, approval, attendance, OKR,
tenant-administration, or unrelated document-workflow scopes.

The current official Node SDK exposes two registration shapes:

1. `addons.preset: false` drops the platform business template and starts from
   a minimal bot base with explicitly declared scopes, events, and callbacks.
2. Omitting `preset: false` keeps the official one-click Personal Agent preset.

The official SDK source also states that the add-on capability can be gated by
platform rollout and that unknown items may be silently ignored. Therefore the
Provider Platform Gate in §14.1 must test the channel-only template on real
Feishu and Lark tenants:

- use the channel-only template when both brands honor it and the resulting
  grants pass the capability verification;
- otherwise use the unchanged official one-click preset as a bounded
  validation fallback;
- never append business-domain app or user scopes in this Channel plan.

The single source belongs in:

```text
services/core/src/message-channels/providers/lark-platform/permission-bundles.ts
```

It contains:

- one versioned channel-only scope/event/callback bundle per brand;
- the expected official preset capability projection used by the fallback;
- the source SDK/document revision;
- verification rules for the actual resulting configuration.

The connection records the requested bundle mode and version, the actual
granted capability groups, denied or unavailable requirements, and the last
successful verification. Raw scope details remain internal diagnostics.

Product capability is derived from **implemented Channel operation + actual
grant + current member authority**. A requested or granted scope alone never
makes an operation available or a connection healthy.

## 3. Non-Goals and Hard Boundaries

The initial implementation will not:

- replace or redesign the hosted Center Agent runtime;
- create a Lark- or Feishu-specific worker;
- duplicate Native Delivery, admission, quota, memory, or callback ledgers;
- mirror provider messages into OpenMeld Spaces;
- merge Slack, Lark, and Feishu transcripts;
- treat a provider display name as verified OpenMeld identity;
- treat a provider credential or scope grant as OpenMeld Organization
  authority;
- use OpenConnector for Channel ingress, identity, or final publication;
- deliver Remote Agent-generated output attachments into provider
  conversations in the first release; the originating conversation receives an
  explicit unsupported-delivery notice instead of an endless retry or a silent
  drop;
- implement Feishu/Lark Calendar, Docs, Drive, Tasks, Mail, Meetings, Contacts,
  approvals, attendance, OKR, or other business-action tools in this plan;
- collect or store a Feishu/Lark business-domain user OAuth token in the
  Channel connection;
- decide whether a future Feishu/Lark App uses OpenConnector or a reviewed
  first-party user-token executor;
- treat proactive cross-conversation messaging as an ordinary turn reply;
- make the Vercel Chat Adapter a production conversation engine;
- depend on a permanent WebSocket fleet for launch;
- support multiple Slack workspaces, multiple Lark apps, or multiple Feishu
  apps of the same provider in one Organization in the first release;
- ship a Store/ISV app before Personal Agent validation proves the product
  contract;
- publish a Store app, enable an external production tenant, or perform any
  external rollout beyond an explicitly authorized development/pilot tenant
  without Felix's approval;
- silently fall back from Webhook to WebSocket or from one Organization to
  another.

## 4. Architecture

### 4.1 Target flow

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Slack / Lark / Feishu                                               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ verified Webhook
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Gateway                                                             │
│ - HTTP receipt and three-second response                            │
│ - calls Core for connection-scoped verification/decryption          │
│ - enqueues only verified, normalized Message Channel events         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ durable Queue acceptance
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Core Message Channel ingress                                        │
│ - ingress idempotency and claim                                     │
│ - connection -> Organization                                        │
│ - external sender -> verified OpenMeld member                       │
│ - Center Agent designation and Binding                              │
│ - bounded ChannelContext                                            │
│ - durable Native Delivery request                                   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ service binding
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Existing hosted Center Agent                                        │
│ - same Profile, base tools, Apps, Memory, quota, worker, and Flue     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ durable callback
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Core publication coordinator                                        │
│ - final-publication claim                                           │
│ - provider adapter selected from frozen locator                     │
│ - completed / failed / outcome_unknown                              │
└───────────────┬───────────────────────┬─────────────────────────────┘
                │                       │
                ▼                       ▼
          Slack adapter          Lark/Feishu adapter
```

### 4.2 Canonical ownership

| Fact | Canonical owner |
| --- | --- |
| Organization and membership | Auth/Core Organization authority |
| Center Agent designation | Core `center_agent_designations` |
| Slack connection | Existing Slack binding repository |
| Lark/Feishu connection | New Lark-platform connection repository |
| Provider credentials | Provider credential repository, encrypted at rest |
| External identity link | Provider identity-link repository |
| Ingress acceptance and deduplication | Core Message Channel ingress ledger |
| Worker execution | Existing hosted Center Agent / Flue runtime |
| Final result locator | Core Native Delivery ledger |
| Provider publication | Provider adapter under a Core publication claim |
| Current provider transcript | Provider |
| Durable member/Organization memory | Existing Center Agent Memory owner |
| User-facing Channels list | Core read projection over provider owners |

### 4.3 Provider and transport terminology

Use these stable terms:

```ts
type MessageChannelProvider = "slack" | "lark" | "feishu";
type MessageChannelTransport = "webhook" | "websocket";
```

`lark` and `feishu` are different provider identifiers because they use
different platform domains, consoles, deployment regions, identifier
namespaces, and tenant governance. Their implementations share one internal
Lark-platform protocol package.

Do not use `connector` as the product or domain name for Message Channels.

### 4.4 Conversation identity

Every provider adapter creates a collision-proof OpenMeld conversation id:

```text
slack:<connectionId>:<channelId>:<rootMessageId>
lark:<connectionId>:<chatId>:<rootMessageId>
feishu:<connectionId>:<chatId>:<rootMessageId>
```

For Lark/Feishu:

- store both the provider thread identifier and the root/reply message
  identifier when both exist;
- use the root message identifier required by the Reply API;
- never assume the native `thread_id` is a valid reply target;
- keep provider identifiers opaque.

The conversation id selects the existing Flue Durable Object instance. Two
conversations may execute concurrently even when they target the same Center
Agent Profile.

## 5. Shared Contracts

All new cross-service and cross-process contracts belong in `packages/schemas`
and derive TypeScript types through `z.infer`.

### 5.1 New schemas

Add:

```text
packages/schemas/src/schemas/http/message-channels.ts
packages/schemas/src/schemas/runtime/message-channel.ts
packages/schemas/src/types/http/message-channels.ts
packages/schemas/src/types/runtime/message-channel.ts
```

Update the corresponding schema and type indexes.

### 5.2 Connection projection

The canonical Channels response is separate from Center Agent designation:

```ts
type MessageChannelConnectionProjection = {
  id: string;
  provider: "slack" | "lark" | "feishu";
  transport: "webhook" | "websocket";
  status:
    | "pending_registration"
    | "credentials_received"
    | "configuring"
    | "connected"
    | "repair_required"
    | "revoked"
    | "disconnected";
  externalAccountId: string | null;
  externalAccountName: string | null;
  permissionBundleVersion: string | null;
  grantedCapabilityGroups: string[];
  lastVerifiedAt: string | null;
  reasonCode: string | null;
};
```

`status` is the one public lifecycle fact. Web derives `connected` as
`status === "connected"`; Core does not persist or return a second boolean that
can disagree. Internal registration-attempt details map into this exact union
through one shared projection function rather than a second lifecycle enum.

The public response never includes provider secrets, raw scopes, raw provider
errors, or unbounded payloads.

Introduce a dedicated Organization Channels read endpoint. Keep the existing
optional `slackConnection` projection only for a bounded mixed-version
transition. It must be derived from the existing Slack owner and removed after
all Web consumers use the canonical list.

### 5.3 Normalized ingress event

Define a strict queue envelope:

```ts
type MessageChannelIngressEnvelope = {
  v: 1;
  kind: "remote_agent_message_channel_event";
  provider: MessageChannelProvider;
  connectionId: string;
  providerEventId: string;
  receivedAtMs: number;
  gatewayRequestId: string;
  event: NormalizedMessageChannelEvent;
};
```

The initial normalized event union includes:

- `message`;
- `card_action`;
- `bot_added`;
- `reaction`;
- `document_comment`.

Only these events create a Center Agent turn in the first release:

- verified direct message;
- verified group mention;
- explicitly supported card action.

Other events are handled as provider state or ignored with an observable
reason. They never invoke the model implicitly.

The message variant carries:

- provider message id and timestamp;
- external sender id;
- typed conversation locator;
- normalized text;
- mention classification;
- bounded resource descriptors;
- provider-safe metadata required for context and reply.

Raw credentials, unbounded provider responses, and message history do not enter
the queue.

### 5.4 Typed conversation locator

Define a shared discriminated union:

```ts
type MessageChannelConversationLocator =
  | {
      provider: "slack";
      connectionId: string;
      teamId: string;
      channelId: string;
      rootMessageId: string;
    }
  | {
      provider: "lark" | "feishu";
      connectionId: string;
      appId: string;
      tenantKey: string | null;
      chatId: string;
      rootMessageId: string;
      threadId: string | null;
    };
```

The provider adapter is the only component allowed to interpret its branch.

### 5.5 Turn envelope

Add a provider-neutral trigger:

```ts
{
  source: "message_channel";
  provider: MessageChannelProvider;
  connectionId: string;
  conversationId: string;
}
```

Provider-specific action authorization remains in provider-specific optional
fields or separate capability tokens. Do not place Slack search tokens or Lark
business-action tokens in the base message-channel trigger.

Add `message_channel_conversation` as the durable memory source and include the
provider as bounded descriptive metadata. Existing `slack_conversation` values
remain readable during migration.

The Remote Agent renderer must say `Channel conversation`, `Slack`, `Lark`, or
`Feishu`; it must not label an external provider conversation as an OpenMeld
Space.

## 6. Data Model

### 6.1 Preserve current Slack authority

Do not migrate or replace these current production owners in the first Lark
release:

- `openMeldRemoteAgent_slack_workspace_bindings`;
- `slack_workspace_tokens`;
- Slack OAuth state;
- Slack identity links;
- Slack thread context cursors.

They remain the single source of truth for Slack. Releases 1–5 leave the
current Slack path unchanged; beginning in Release 6, the shared Message
Channel layer consumes these same owners through a Slack adapter.

This avoids an unrelated high-risk Slack credential and workspace-move
migration while still giving every provider one canonical owner.

### 6.2 Lark-platform connection tables

Add a non-secret connection table:

```text
openMeldRemoteAgent_lark_platform_channel_connections
```

Required fields:

- `connection_id` primary key;
- `organization_id`;
- `provider` (`lark | feishu`);
- `app_id`;
- nullable `tenant_key`;
- nullable bot identity;
- `transport`;
- connection status;
- installed-by OpenMeld user id;
- permission bundle version;
- bounded granted capability groups;
- connection generation;
- last verified timestamp;
- bounded failure reason code;
- created and updated timestamps.

Required uniqueness:

```text
UNIQUE (organization_id, provider)
UNIQUE (provider, app_id)
```

Add a short-lived registration-attempt table:

```text
openMeldRemoteAgent_lark_platform_registration_attempts
```

It stores:

- attempt id, Organization id, initiating user id, and provider;
- encrypted device code;
- provider account domain and detected brand;
- poll interval, `next_poll_at`, expiry, and a short poll lease;
- requested Channel permission mode and bundle version;
- canonical lifecycle status and bounded failure reason;
- consumed timestamp, created timestamp, and updated timestamp.

Core permits at most one active attempt per Organization and provider. Web
polling reads this owner; it does not start an in-memory SDK poll loop. A Core
request may call the provider only when `next_poll_at` is due and after claiming
the attempt lease. `slow_down` advances the stored interval. Success consumes
the attempt exactly once before connection credentials become visible.

Add a separate secret table:

```text
openMeldRemoteAgent_lark_platform_channel_credentials
```

It stores:

- encrypted App Secret;
- encrypted verification token;
- encrypted event encrypt key;
- credential format version;
- created and updated timestamps.

The connection and credential write is one D1 batch. A failed credential write
must not create a connected projection.

Do not persist tenant access tokens. Mint and cache them only within their
published lifetime.

### 6.3 Business-action authorization storage boundary

Do not add a Lark-platform user-authorization table in this plan.

An unused Channel-owned refresh-token table would become a second credential
owner beside the shipped Apps/OpenConnector boundary while providing no
Channel behavior. It would also make a future action-surface decision harder to
reverse.

Consuming a Feishu/Lark user grant for business actions is out of scope and
requires a separate reviewed design. That design must choose exactly one
credential and execution owner, define Settings → Apps management, and settle
the boundary between:

- replying or updating progress in the originating Channel conversation;
- an explicitly requested Channel-local publication;
- proactive cross-conversation messaging;
- external business actions such as Docs, Calendar, Tasks, or Mail.

The current owner documents make OpenConnector the default App credential and
action executor. A first-party Feishu/Lark user-token executor would be a new
first-class architecture decision and must update those owner documents rather
than entering through this Channel plan.

### 6.4 External identity links

Add:

```text
openMeldRemoteAgent_lark_platform_identity_links
```

Key each identity link by:

```text
provider + connection_id + provider_user_id
```

It maps to:

```text
organization_id + openmeld_user_id + resolution_source
```

Allowed resolution sources:

- `installer`;
- `explicit`;
- `email_auto`.

An application-scoped `open_id` must never be stored without `connection_id`.
Display names never establish identity. An exact email match may link only when
the provider returned the email under a current grant and the matched user is a
current member of the same Organization.

### 6.5 Generic ingress ledger

Add:

```text
openMeldRemoteAgent_message_channel_event_ingress
```

The idempotency key is:

```text
provider + connection_id + provider_event_id
```

Store:

- state and claim lease;
- provider, connection id, and provider event id;
- Gateway request id and Queue message id;
- attempt counts and bounded retry metadata;
- native delivery id;
- failure reason code;
- timestamps.

Do not store message text, raw provider payloads, credentials, access tokens,
card tokens, or provider profile records.

The existing Slack ingress ledger remains readable during migration. New
generic Slack ingress is enabled only after Slack parity tests pass.

### 6.6 Native Delivery locator migration

Add these fields to the existing Native Delivery ledger:

- nullable `message_channel_provider`;
- nullable `message_channel_connection_id`;
- nullable `message_channel_locator_json`;
- provider publication idempotency key or UUID;
- provider publication result id.

Add `message_channel` to `conversation_kind`.

Legacy `slack` rows and Slack columns remain readable historical evidence. New
Message Channel deliveries write only the typed generic locator. Do not
dual-write new Lark/Feishu data into provider-specific ledger columns.

Reader behavior:

1. parse the generic typed locator when present;
2. adapt a legacy `slack` row from existing Slack columns;
3. fail closed on a malformed or incomplete locator;
4. never infer a provider from an arbitrary conversation-id prefix when a
   durable locator should exist.

## 7. Provider Adapter Boundaries

### 7.1 Shared adapter interfaces

Core owns these provider-neutral interfaces:

```ts
interface MessageChannelConnectionAdapter {
  readConnection(...): Promise<MessageChannelConnection>;
  listConnectionsForOrganization(...): Promise<MessageChannelConnection[]>;
  disconnect(...): Promise<void>;
}

interface MessageChannelIngressAdapter {
  verifyAndNormalizeWebhook(...): Promise<VerifiedIngressResult>;
  resolveMember(...): Promise<VerifiedOrganizationMember | LinkRequired>;
  readChannelContext(...): Promise<ChannelContext>;
}

interface MessageChannelPublicationAdapter {
  publishWorkingState(...): Promise<void>;
  publishReply(...): Promise<ProviderPublicationResult>;
  publishFailure(...): Promise<ProviderPublicationResult>;
  publishStreamUpdate(...): Promise<ProviderStreamResult>;
}
```

Core selects adapters from an explicit provider registry. No dynamic import,
model-authored provider name, or external payload selects arbitrary code.

### 7.2 Slack adapter

Do not refactor Slack ingress or orchestration in Releases 1–5. During those
releases:

- `slack-signal-service.ts` remains the Slack orchestration owner;
- the existing Slack Gateway route and Queue remain the only Slack producer;
- the existing Slack ingress ledger remains the only Slack ingress claim;
- shared locator readers may adapt legacy Slack rows, but no new Slack event
  enters the generic Message Channel envelope.

Release 6 moves current Slack behavior behind these interfaces without
changing:

- Add to Slack and workspace-move behavior;
- workspace ownership and token resolution;
- member identity linking;
- thread context cursor semantics;
- mrkdwn and Block Kit presentation;
- Slack search authorization;
- terminal publication fencing and `outcome_unknown`;
- current audit and diagnostics.

The Release 6 transition has a bounded dual-reader window, never two active
producers for the same event. The Slack migration is complete only when
existing Slack tests and real Slack smoke pass unchanged.

### 7.3 Lark/Feishu adapter

The Lark-platform adapter owns:

- provider API base URL;
- Personal Agent registration and app configuration;
- application token creation;
- verification and decryption;
- provider event validation and normalization;
- `open_id`, `union_id`, tenant, app, chat, thread, and message identifiers;
- message resource download;
- bounded thread context;
- CardKit formatting and streaming;
- send, reply, edit, recall, reaction, and card-update API errors;
- deterministic provider UUIDs;
- rate-limit classification;
- brand-specific diagnostics and user copy.

Shared implementation code may serve both `lark` and `feishu`, but provider
identity and API domain are explicit inputs and never guessed from an
identifier.

These low-level methods exist only for connection lifecycle, bounded context,
originating-conversation progress/final publication, and account-link UX. They
are not registered as general model-visible Feishu/Lark tools and cannot accept
an arbitrary model-authored destination.

## 8. Installation and Authorization

### 8.1 Connection state machine

Use:

```text
pending_registration
-> credentials_received
-> configuring
-> connected

configuring -> repair_required
connected   -> revoked
connected   -> disconnected
```

No UI may show `Connected` before Core has:

- encrypted and persisted credentials;
- verified the app identity;
- applied or verified the required event and callback configuration;
- verified the selected Channel permission bundle outcome;
- selected exactly one transport.

### 8.2 Personal Agent QR flow

1. An owner/admin starts `Connect Lark` or `Connect Feishu` from
   **Settings → Channels**.
2. Core creates a short-lived registration attempt bound to:
   - Organization;
   - OpenMeld user;
   - actor Human Profile;
   - provider;
   - return route;
   - requested permission bundle version.
3. Web presents the official QR code and polls the Core-owned attempt.
4. The provider returns or exposes the App ID/App Secret.
5. Core atomically stores the connection and encrypted credentials.
6. Core patches the application configuration:
   - selected event subscriptions;
   - selected callbacks;
   - Webhook request URLs;
   - verification and encryption configuration;
   - only visibility/contact range required for the bot to be usable;
   - the verified channel-only permission template, or the unchanged official
     preset when the Provider Platform Gate proves the channel-only template
     is unavailable for that brand.
7. Core verifies the resulting configuration.
8. Web invalidates the canonical Channels projection and displays the actual
   outcome.

QR completion, popup closure, redirect success, or possession of credentials
alone is not connection success.

### 8.3 Webhook URLs

Use opaque connection ids:

```text
POST /message-channels/lark/:connectionId/events
POST /message-channels/lark/:connectionId/callbacks
POST /message-channels/feishu/:connectionId/events
POST /message-channels/feishu/:connectionId/callbacks
```

The connection id is routing metadata, not a credential.

Gateway calls an internal Core verification RPC with the provider,
connection id, relevant headers, and bounded raw body. Core owns
connection-scoped credential lookup, decryption, signature/token validation,
payload decryption, and normalization. Gateway never receives the decrypted
App Secret or encrypt key.

### 8.4 App authorization handoff boundary

The Channel wizard ends when the Message Channel is connected. It does not
offer a second business-domain OAuth step and Core does not persist a user
refresh token for this Channel.

If OpenMeld later ships Feishu or Lark under **Settings → Apps**, the Channel
page may show only a read-only deep link to that separate management home. The
App connection must not reuse the Channel credential, infer authority from the
Channel connection, or change Channel health when App authorization fails.

The future App design must separately decide:

- OpenConnector provider versus a first-party user-token executor;
- member versus Organization-shared ownership;
- proactive messaging versus originating-conversation reply;
- business-action idempotency, audit, recovery, and confirmation policy.

Until that decision explicitly changes the current owner documents,
OpenConnector remains the App execution owner.

### 8.5 Permission updates

Channel permission bundle updates are versioned and treated as additive for an
existing app:

1. compare requested and current app grants;
2. show the user/admin the delta;
3. run the official registration/addon update;
4. verify actual grants and subscriptions;
5. update the Channel capability projection.

This plan never adds user-identity business scopes. Because an existing app
update cannot be trusted to remove previously granted items, moving an
existing connection from the official preset to a smaller channel-only bundle
requires an explicit reconnect with a newly created app. OpenMeld never reports
permissions as removed merely because the requested fixture became smaller.

Do not silently mark a newly requested capability available.

### 8.6 Development and production isolation

Development and production use completely different Personal Agent apps:

| Environment | App and endpoint rule |
| --- | --- |
| Local unit/integration | Captured fixtures only; no real provider credential. |
| Local real-provider development | An OpenMeld-owned development tenant and a dedicated QR-created development app. Use the WebSocket harness or an explicitly development-only HTTPS tunnel when local `wrangler dev` has no stable public ingress. |
| Shared development | A dedicated development app whose Webhooks point only to the deployed development Gateway. |
| Production | A separately QR-created production app per connected Organization whose Webhooks point only to the production Gateway. |

Development and production must never share:

- App ID or App Secret;
- verification token or encrypt key;
- connection row or connection id;
- Queue, D1 database, callback URL, or feature-flag scope;
- captured user or tenant authorization material.

Tunnel URLs are never written into production app configuration. Real-provider
development commands must print the effective environment, provider, app id,
and redacted callback host before mutating provider configuration.

## 9. Ingress, Acknowledgement, and Retry

### 9.1 Ordinary events

The provider response deadline is three seconds.

The handler must:

1. identify the provider and opaque connection;
2. call Core verification/decryption;
3. recognize challenge requests;
4. enqueue the verified normalized event;
5. return success only after Queue accepts it.

It must not:

- resolve full thread history;
- link users;
- call the model;
- wait for Center Agent execution;
- publish a final answer.

Target:

```text
p95 acknowledgement < 1 second
hard provider deadline < 3 seconds
```

### 9.2 Card callbacks

Card actions are synchronous and may not receive provider repush.

Gateway must still durably enqueue the verified action before acknowledging.
It returns a bounded immediate response such as an empty acknowledgement or
controlled toast. Long work runs asynchronously and updates the card through
CardKit.

If durable acceptance fails, return a controlled temporary-failure response
when the provider contract permits it and record the callback as not accepted.
Never acknowledge and discard.

Callback tokens are encrypted, bounded, and retained only for their documented
update lifetime. They never become model-visible.

### 9.3 Queue and redrive

Create:

```text
OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE
```

Core consumes the generic envelope and owns bounded retry/redrive. Keep the
existing Slack Queue active during migration. Retire it only after:

- generic Slack producer and consumer are proven;
- old backlog is empty;
- no deployment references the old binding;
- production diagnostics show no stranded ingress.

## 10. Identity and Authorization

### 10.1 Inbound sender resolution

For every turn:

1. resolve connection to exactly one Organization;
2. resolve provider sender through the provider-scoped identity link;
3. verify the mapped OpenMeld user is still an active member;
4. optionally perform exact-email auto-link;
5. otherwise send a provider-native account-link card;
6. fail closed before model admission.

The link route requires:

- current authenticated OpenMeld session;
- unexpired one-time token;
- exact provider, connection, and external user;
- exact Organization;
- current Organization membership.

### 10.2 Same person across providers

One OpenMeld user may have:

```text
Slack identity  -> OpenMeld user U1
Lark identity   -> OpenMeld user U1
Feishu identity -> OpenMeld user U1
```

These links are independently revocable. They share the same member
authorization and member-memory subject only after Core verifies current
Organization membership.

### 10.3 Move and disconnect

Moving or disconnecting one provider:

- changes only that provider connection;
- invalidates its identity links, cursors, and credential generation;
- does not move or disconnect Slack, Lark, Feishu, Apps, or the Center Agent;
- writes destination and previous-Organization audit evidence when a move is
  supported;
- fails closed on an ownership race.

The first Feishu/Lark release may require disconnect-and-reconnect instead of
cross-Organization move. If move is omitted, the UI and server both reject it;
do not hide only the UI control.

## 11. Message Context and Memory

### 11.1 Current conversation context

Each adapter produces the existing provider-neutral `ChannelContext`:

- `provider`;
- stable conversation id;
- current message id;
- snapshot or delta mode;
- explicit sync status;
- bounded ordered historical messages.

The current verified request is excluded from historical messages.

For Feishu/Lark, add:

```text
openMeldRemoteAgent_lark_platform_context_cursors
```

Key the provider-specific cursor by:

```text
organization
+ connection
+ chat
+ root message
+ connection generation
```

The cursor advances only after worker admission succeeds.

### 11.2 Durable memory

The same member and Organization Memory owners are used across providers.

Memory may recall a durable fact saved from another provider when policy allows
it. The prompt labels its source. It must not imply that the Center Agent read
the other provider's current transcript.

### 11.3 Cross-conversation search

Cross-conversation provider search is not part of this Channel plan. It may
ship only through the separate App/action-surface design, which must require:

- an implemented explicit tool;
- an independently authorized App connection;
- verified represented-member authority;
- bounded results;
- provider links;
- audit and privacy rules.

The Channel credential and bounded originating-conversation context are never
reinterpreted as general history-search authority.

## 12. Worker Admission and Native Delivery

### 12.1 Shared admission

Define a new provider-neutral orchestration service with Lark and Feishu as its
first consumers:

```ts
acceptMessageChannelTurn({
  connection,
  member,
  event,
  conversationId,
  locator,
  channelContext,
  turnEnvelope,
});
```

Build it from the existing provider-neutral Organization, Center Agent, quota,
Native Delivery, worker, watchdog, memory, and audit owners. Use the current
Slack behavior as a parity specification, but do not edit or route through
`slack-signal-service.ts` in Releases 1–5. Release 6 replaces the remaining
Slack-specific sequencing with this service and deletes the bounded transition
duplication only after parity proof.

It owns:

- Center Agent target and Binding resolution;
- Organization-wide quota;
- native-delivery ledger creation;
- durable worker request persistence;
- idempotency;
- runtime availability;
- worker submission;
- watchdog;
- memory recall/write scheduling;
- recovery.

Provider adapters do not call the Remote Agent worker directly.

### 12.2 Idempotency

Use namespaced identifiers:

```text
ingress: provider + connection + providerEventId
delivery: provider + connection + providerMessageId + CenterAgentProfileId
conversation: provider + connection + chat + rootMessage
publication: deliveryId + publicationKind + provider
```

Identical event or message strings from different providers cannot collide.

### 12.3 Result surface invariant

One Native Delivery row freezes one result surface.

The callback publisher:

1. reads the durable typed locator;
2. verifies Organization, Profile, Binding, trigger, dispatch, and submission;
3. acquires the final-publication claim;
4. selects the exact provider adapter;
5. publishes, or performs a bounded same-UUID retry for a provider-ambiguous
   Lark/Feishu result;
6. finalizes only with provider-confirmed result identity.

No callback payload or model output may select another provider or destination.

## 13. Publication, Streaming, and Resources

### 13.1 Final replies

Slack keeps its current controlled Markdown/Block Kit renderer.

Lark/Feishu use:

- native text or post for small non-streaming replies;
- CardKit for structured and streaming replies;
- provider resource upload for supported attachments;
- a controlled plain-text fallback only after a confirmed format rejection.

### 13.2 Provider idempotency

Lark/Feishu send and reply calls support provider UUID deduplication for exactly
60 minutes. Generate a deterministic UUID of at most 50 characters from the
OpenMeld delivery and publication identity and reuse it for ambiguous retries.
Persist the exact final payload or card identity, typed locator, provider
sequence, attempt count, next-attempt time, and ambiguity deadline in the same
Native Delivery ledger before retrying.

Contract evidence: the official
[Lark reply API](https://open.larksuite.com/document/server-docs/im-v1/message/reply)
defines `uuid` with a 50-character maximum and says that requests with the same
value execute successfully at most once within one hour.

Do not rely on the official Channel SDK's default ordinary-message retry if it
does not pass OpenMeld's deterministic UUID.

At the exact 60-minute deadline, an unresolved ambiguous outcome becomes
`outcome_unknown`; OpenMeld does not call the provider again or risk a duplicate
visible answer. Before that deadline, callback and queue replay remain retryable
and must not settle Agent Task completion or continuation.

### 13.3 Streaming

CardKit streaming is presentation, not execution authority.

Requirements:

- monotonic sequence numbers;
- deterministic update UUIDs;
- provider rate-limit aware throttling;
- propagation of provider `429` `Retry-After` backpressure through the
  worker-to-Core stream and terminal-callback response contracts, capped at
  five minutes and treated as a minimum retry delay;
- the existing product-wide 100,000-character completed-message ceiling;
- at most six 30,000-character provider cards, with Unicode-safe and
  Markdown-code-fence-aware rollover;
- durable source offset, rendered-segment hash, active card, and pending card
  before provider I/O;
- exact card, destination, and UUID reuse after an ambiguous send;
- terminal finalization only after the final card state is confirmed;
- controlled fallback to one final non-streaming message;
- no double final response.

### 13.4 Files and media

Provider resource references remain provider-owned until Core authorizes a
bounded download. Validate:

- resource kind;
- size;
- content type;
- current connection and conversation;
- current Organization member;
- SSRF and URL boundaries.

Do not persist raw provider resources in diagnostics or memory.

## 14. Official SDK and Adapter Use

### 14.1 Official Node Channel SDK

Package E and Package F product implementation may not start until two
prerequisite gates pass.

#### Gate 0A — Provider Platform Gate

Use a small Node/manual harness and real development tenants. Persist only
redacted evidence and captured provider fixtures.

Prove all of the following for both Feishu and Lark:

1. **Personal Agent registration**
   - start the device flow and receive a QR URL;
   - persist the device code, provider domain, poll interval, and expiry;
   - perform one due platform poll per independent Core poll request;
   - handle `authorization_pending`, `slow_down`, expiration, denial, and the
     Feishu-to-Lark domain switch;
   - obtain the App ID and App Secret without one long-running OpenMeld
     request.
2. **Permission template**
   - create one app with the explicit channel-only
     `addons.preset: false` template;
   - read back and compare actual scopes, events, and callbacks;
   - prove whether the brand honors or ignores the add-on payload;
   - if either brand does not reliably honor it, record that brand's unchanged
     official preset as the launch fallback.
3. **Application configuration**
   - use the current application-config Patch OpenAPI to change the QR-created
     app from its default long-connection configuration to Webhook;
   - configure event request URL, callback request URL, subscription types,
     verification token, and encryption key;
   - read back the configuration;
   - receive one real message event and one real card callback at a public
     probe endpoint.
4. **Mainland Feishu reachability**
   - use a real mainland Feishu tenant and a client on a mainland network;
   - trigger at least 100 message events and 30 card callbacks across three
     separated test windows;
   - measure provider-created timestamp to Gateway receipt, first-attempt
     delivery, provider retries, Gateway acknowledgement time, and user-visible
     card callback success;
   - require zero unrecovered events, at least 99% first-attempt event
     delivery, message-delivery p95 below 2 seconds, Gateway acknowledgement
     p95 below 1 second with no response at or above 3 seconds, and zero card
     callback timeouts.

The public probe may be a minimal development Worker. It must not contain model
execution, production credentials, or a production connection row. Its
captured payloads are sanitized before becoming Package H fixtures.

The current SDK publicly exports the long-running `registerApp()` helper, while
its resumable `begin` and `poll` functions are internal implementation details.
OpenMeld must not describe split polling as a stable public SDK API. If Gate 0
accepts the vendor-derived protocol, isolate it behind one registration client,
pin the reviewed SDK source commit and endpoint behavior, capture contract
fixtures, and fail closed when the provider changes the response. Do not import
an unexported SDK file by filesystem path.

Failure is explicit:

- an unsupported or unstable split-poll contract requires a reviewed
  persistent Node registration service using the public `registerApp()` helper
  before the QR product flow can proceed;
- failed application configuration blocks Webhook-first for that brand;
- ignored `preset: false` selects the unchanged official preset fallback, not
  a fabricated partial grant;
- failed mainland Webhook reachability triggers the WebSocket connector
  qualification in §14.3; it does not automatically promote WebSocket.

This gate follows the current official SDK's public registration behavior and
the current application-config Patch API. Re-pin the SDK commit and re-run the
gate if those external contracts change.

#### Gate 0B — Worker SDK Compatibility

Run a focused Cloudflare Worker compatibility spike for:

- public normalizers;
- OpenAPI Client;
- CardKit streaming helpers;
- resource download/upload.

The spike must prove:

- successful Cloudflare Worker bundle;
- acceptable bundle size;
- no unsupported Node filesystem/process lifecycle dependency on the selected
  import path;
- real workerd execution;
- captured Feishu and Lark event normalization;
- CardKit and media behavior.

If it passes, reuse the compatible public subset. If it fails, implement a
small Worker-native adapter from provider types and captured fixtures while
using the official SDK as the conformance oracle.

The official high-level Channel module may be used as a test oracle, but its
internal deduplication, stale-message filtering, per-chat locking, fallback
retry, and process-local state must not become OpenMeld execution truth. Those
behaviors can silently drop or redirect work and therefore remain behind
Core's durable ingress, locator, publication, and `outcome_unknown` contracts.

Do not import `WSClient` into a request-scoped Worker.

### 14.2 Vercel Chat Adapter

Use `@larksuite/vercel-chat-adapter` only as executable conformance evidence for:

- thread/root mapping;
- normalized message expectations;
- emoji/reaction behavior;
- history grouping;
- CardKit stream translation;
- unsupported feature boundaries.

Do not use it as a production dependency because its current design is
WebSocket-only, single-app, process-lifetime, and built around another
conversation state system.

### 14.3 WebSocket harness

Build a separate Node smoke harness with the official SDK:

- one Lark Personal Agent app;
- one Feishu Personal Agent app;
- real direct messages and group mentions;
- messages, resources, cards, callbacks, and reconnect tests;
- captured fixtures checked into the appropriate test fixture owner.

The harness may later become a dedicated sharded connector only when a
documented production requirement justifies it.

Production WebSocket promotion criteria:

- Webhook auto-configuration is not viable in real target tenants;
- a required event/callback is unavailable through Webhook;
- customer-hosted/private ingress requires outbound-only connectivity;
- the §14.1 mainland Feishu Webhook gate fails its delivery SLO;
- the candidate connector deployment region passes the same real-tenant
  delivery and callback SLO—the protocol alone is not accepted as mitigation;
- OpenMeld has an approved persistent connector runtime, sharding, restart,
  credential-loading, health, reconnect, deployment-region, and operations
  model.

Promotion is connection-scoped and explicit:

1. stop the old transport producer;
2. drain or expire its accepted work;
3. increment the connection generation;
4. verify the new transport and current credentials;
5. enable exactly one producer;
6. run duplicate-event and originating-result-surface smoke.

OpenMeld never runs Webhook and WebSocket as active producers for the same
connection and never changes transport automatically on a transient failure.

## 15. Web Experience

### 15.1 Settings

**Settings → Channels** renders one row per provider:

```text
Slack   Connected to Amplift
Lark    Connected to Amplift Global
Feishu  Not connected
```

Each row independently exposes:

- provider icon and native name;
- connection status;
- external tenant/app label;
- transport;
- capability/permission summary;
- `Connect`, `Manage`, `Repair`, or `Disconnect`;
- one clear error and one next action.

Owners/admins can mutate. Members see read-only status.

### 15.2 Connection wizard

The Lark/Feishu wizard contains:

1. provider and tenant-governance explanation;
2. exact Channel permission mode and capability explanation;
3. official QR;
4. live registration/configuration progress;
5. actual app permission and transport result;
6. real completion state.

Required error states:

- QR expired;
- user canceled;
- tenant administrator required;
- app creation denied;
- app credentials received but configuration failed;
- permission partially granted;
- Webhook verification failed;
- credential revoked;
- provider rate limited;
- OpenMeld Queue unavailable.

### 15.3 Organization onboarding

The optional Organization onboarding step may offer Slack, Lark, and Feishu.
It reads the canonical Channels projection and never treats popup/QR completion
as success.

Finish remains available when optional Channel setup is inactive or failed.
Failure must remain visible in Settings with a direct repair action.

### 15.4 Identity link card

An unknown provider user receives a provider-native card that:

- explains that OpenMeld Organization membership is required;
- opens an authenticated OpenMeld account-link route;
- names the Organization only when disclosure is authorized;
- uses an expiring one-time token;
- never exposes a credential or raw external identifier.

## 16. Observability and Diagnostics

### 16.1 Correlation chain

The minimum Message Channel chain is:

```text
provider
-> connection id
-> provider event id
-> Gateway request id
-> Queue message id
-> ingress claim
-> native delivery id and conversation id
-> worker submission and callback
-> final-publication claim
-> provider result message/card id
```

### 16.2 Required states

Diagnostics distinguish:

- request verification rejected;
- connection missing, revoked, or owned by another Organization;
- provider challenge;
- Queue unavailable or enqueue failed;
- queued but unclaimed;
- duplicate event;
- claim retry;
- identity link required;
- mapped user no longer a member;
- Center Agent unavailable;
- context complete, truncated, forbidden, rate-limited, or unavailable;
- worker admission rejected;
- worker submit outcome unknown;
- provider final publication failed;
- provider final publication outcome unknown;
- callback/card token expired;
- capability missing because scope was not granted.

### 16.3 Reason codes

New machine-readable codes use dot-separated snake case, for example:

```text
message_channel.connection_not_found
message_channel.identity_link_required
message_channel.lark.webhook_verification_failed
message_channel.feishu.permission_not_granted
message_channel.publication_outcome_unknown
```

### 16.4 Sensitive data

Never log:

- App Secret;
- verification token;
- encrypt key;
- tenant or user access token;
- OAuth refresh token;
- callback token;
- raw message text;
- raw card payload;
- raw provider profile;
- provider response body.

Logs may include bounded identifiers, state, attempt count, reason code,
duration, and provider request id.

## 17. Implementation Work Packages

### Gate 0 — Provider platform and runtime feasibility

Before Package A authorizes product implementation:

- run §14.1 Gate 0A for Feishu and Lark;
- run §14.1 Gate 0B against the exact official Node SDK version;
- record pass/fail evidence, SDK commit, provider configuration snapshots, and
  mainland Feishu measurements;
- sanitize and preserve real provider fixtures for Package H;
- select `channel_only` or `official_preset_fallback` independently per brand;
- select Webhook only when application configuration and reachability pass.

Gate 0 may add a bounded provider harness and development probe. It may not add
production routes, tables, credentials, or model execution.

### Package A — Owner documents and shared vocabulary

Update:

- `developing/product/organizations-and-center-agent.md`;
- `developing/product/remote-agent-runtime.md`;
- `developing/architecture/shared-contracts.md`;
- `developing/architecture/data-and-observability.md`;
- `developing/clients/web.md`;
- `developing/decisions.md`.

Settle Message Channel provider, connection, locator, result-surface, transport,
and Channel-versus-App vocabulary before implementation.

### Package B — Shared schemas and consumer-first worker support

Add the Message Channel schemas and update:

- `remote-agent-turn-envelope.ts`;
- Remote Agent envelope rendering;
- ChannelContext presentation;
- memory-source compatibility;
- schema and worker tests.

Deploy consumers before Core emits the new trigger.

### Package C — Database and repositories

Update:

- `packages/db/src/core/dispatch.schema.ts`;
- Core DB exports and physical requirements;
- generated migration and snapshots;
- new `lark_platform` registration-attempt, connection, credential, identity,
  and context-cursor repositories;
- the generic Message Channel ingress repository;
- Native Delivery generic locator read/write compatibility.

### Package D — Shared Core Message Channel orchestration

Add:

- provider registry;
- generic ingress claim service;
- generic member/Center Agent resolution;
- generic Native Delivery submission;
- generic publication coordinator.

Lark and Feishu are the first and only producers and orchestration consumers in
Releases 1–5. Do not change `slack-signal-service.ts`, the Slack Gateway
producer, Slack Queue, or Slack ingress claim in these releases.

The Slack adapter and orchestration migration is a distinct Release 6 slice
with its own parity gates.

### Package E — Lark-platform provider

Add:

- Feishu/Lark API host resolver;
- split begin/poll registration client;
- channel permission-template selector and actual-grant verifier;
- application-config Patch/read-back client;
- token and credential crypto;
- Webhook verification/decryption;
- normalizer;
- identity resolver and link token;
- ChannelContext reader/cursor;
- OpenAPI publication;
- CardKit streaming;
- error classifier.

### Package F — Gateway and Queue

Add:

- event and callback routes;
- internal Core verification RPC contracts;
- generic Queue producer;
- generic Queue consumer routing;
- Wrangler bindings, secrets, environment docs, and generated Worker types.

### Package G — Web and API client

Add:

- canonical Channels API/query;
- provider rows;
- QR/configuration wizard;
- connection result and repair surfaces;
- account-link route;
- onboarding integration.

### Package H — Conformance and real-provider harness

Add:

- official SDK Node harness;
- captured vendor fixtures;
- Webhook/SDK normalization equivalence tests;
- real Feishu and Lark smoke checklist;
- reconnect and callback tests;
- guarded real-provider command and environment-isolation assertions.

## 18. Test Plan

### 18.1 Contract and unit tests

Prove:

- every provider locator branch;
- provider-prefixed conversation identity;
- normalized message, resources, mentions, card actions, and callbacks;
- strict rejection of malformed or cross-provider locators;
- provider/event idempotency namespace;
- channel permission capability projection and preset fallback;
- canonical connection-state projection with no duplicate `connected` fact;
- user identity scope includes connection;
- deterministic provider UUID;
- legacy Slack locator compatibility;
- memory source compatibility;
- formatting and provider error classification.

External fixtures must come from:

- captured real provider payloads;
- official provider types;
- official SDK output.

Never shape fixtures after OpenMeld's implementation assumptions.

### 18.2 Core integration tests

Prove:

- one Organization owns Slack + Lark + Feishu simultaneously;
- another Organization cannot claim any of those external accounts;
- all three resolve to the exact same Center Agent Profile and Binding;
- Slack and Lark events with the same raw event id do not collide;
- simultaneous provider turns retain different locators;
- each final reply returns only to the originating provider;
- the Organization-wide quota is shared;
- replay does not consume quota twice;
- unknown/non-member senders fail closed;
- disconnecting one provider leaves the others active;
- callback identity mismatch is rejected;
- publication claim concurrency produces one visible result;
- ambiguous Lark/Feishu send reuses the deterministic UUID;
- expired provider UUID window becomes `outcome_unknown`;
- legacy Slack deliveries still complete after deployment.

### 18.3 Gateway tests

Prove:

- provider challenge;
- valid and invalid verification/encryption;
- opaque connection routing;
- Queue-unavailable response;
- enqueue-before-ack;
- bounded body;
- card callback immediate response;
- no secret leakage;
- three-second deadline behavior with injected clocks/timeouts.

### 18.4 Remote Agent tests

Prove:

- generic Message Channel trigger rendering;
- provider-neutral ChannelContext;
- current verified request separation;
- no external conversation labeled as an OpenMeld Space;
- same provider-neutral Center Agent and independently authorized App tool
  catalog from Slack, Lark, and Feishu;
- existing Slack-only Channel tools remain explicit Slack capabilities rather
  than becoming fake Lark/Feishu parity;
- no Feishu/Lark business-action tool exposed from a Channel credential;
- independently connected Apps remain governed by their existing App
  authorization and tool catalog.

### 18.5 Web tests and browser validation

Prove:

- Slack, Lark, and Feishu rows render simultaneously;
- provider mutations are independent;
- members cannot mutate;
- QR polling uses Core projection;
- partial permissions and repair states;
- disconnect confirmation names only the target provider;
- account link flow;
- onboarding optionality;
- keyboard, focus, reduced motion, narrow viewport, and error recovery.

Use the real browser at:

```text
1440x900
768x1024
390x844
```

### 18.6 Real provider smoke

Run in both Feishu and Lark using:

- an ordinary tenant member;
- a tenant administrator;
- an Organization owner/admin;
- an Organization member.

Smoke:

1. QR create a dedicated app.
2. Verify the selected channel-only or official-preset fallback outcome.
3. Read back and verify Webhook configuration.
4. Direct message.
5. Group mention.
6. Thread reply.
7. Image and file.
8. Card action.
9. CardKit stream and final state.
10. Unknown-user account link.
11. Known member identity.
12. Provider rate-limit/error presentation.
13. Disconnect and reconnect.
14. Slack remains usable throughout.
15. Lark and Feishu turns target the same Center Agent.

## 19. Verification Commands

Run focused tests first, then:

```sh
pnpm check
pnpm build
pnpm run check:affected
pnpm run test:affected
pnpm run test:integration:affected
pnpm run verify:release-ready
pnpm run verify:pr
```

Database work:

```sh
pnpm db:generate
pnpm db:check
```

Run the repository's local migration and physical-contract verification before
any real provider smoke.

After Wrangler bindings or secrets change:

- regenerate Worker types;
- run Cloudflare environment-contract verification;
- confirm every environment has the new Queue, service binding, vars, and
  required secrets.

Complete the Contract Impact Audit because this work changes shared HTTP, RPC,
Queue, runtime, and Webhook contracts.

The Message Channel contract does not require an existing CLI or OpenMeld
Service to update before current setup or Wake work can continue. However,
`packages/schemas` is packaged into the local component artifact, so its bundle
hash changes even though no local runtime contract changed. The release
worktree must use the base-aware stamp command with an advisory `available`
policy before publishing. This feature branch must not stamp or commit
unpublished release state.

Package H provides deterministic contract and Worker-bundle checks:

```sh
pnpm run test:lark-platform-provider
pnpm run verify:lark-platform-sdk-bundle
```

Guarded real-provider registration performs one explicit operation per process.
Use `--provider feishu` for the Feishu brand and `--provider lark` for the Lark
brand:

```sh
pnpm run verify:lark-platform-provider -- \
  --action begin \
  --provider <lark-or-feishu> \
  --environment development \
  --app-id <development-app-id> \
  --callback-host <development-callback-host> \
  --state-file <ignored-private-state-file>

pnpm run verify:lark-platform-provider -- \
  --action poll \
  --provider <lark-or-feishu> \
  --environment development \
  --app-id <development-app-id> \
  --callback-host <development-callback-host> \
  --state-file <ignored-private-state-file> \
  --credential-file <ignored-private-credential-file>
```

The command fails before provider mutation unless it can prove:

- the target is an OpenMeld development tenant and app;
- provider and effective callback host are explicit;
- no App ID, credential fingerprint, connection id, D1 database, Queue, or
  callback host matches production;
- Gate 0 evidence is written to the development evidence owner with secrets
  and message content redacted.

Before production enablement, read back both app configurations and verify that
development points only to the development Gateway and production points only
to the production Gateway.

## 20. Rollout Plan

Use feature flags independently:

```text
OPENMELD_LARK_CHANNEL_ENABLED
OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS
OPENMELD_FEISHU_CHANNEL_ENABLED
OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS
OPENMELD_GENERIC_SLACK_CHANNEL_INGRESS_ENABLED
```

Each Lark-platform brand requires both its global gate and an explicit
comma-separated Organization allowlist entry. `*` is reserved for an
intentional public rollout. An empty allowlist keeps the provider closed even
when its global gate is enabled. Core returns the resulting available-provider
projection so Web does not expose setup outside the selected pilot
Organizations.

Gate 0 is a precondition for Release 1 planning. A brand that fails Gate 0
remains disabled while the other brand may proceed independently.

### Release 1 — Consumers and dormant contracts

- add shared schemas;
- deploy Remote Agent support for the generic trigger and the bounded completed
  callback producer;
- deploy Core readers for generic and legacy locators;
- emit no new generic events.

This release has two Remote-Agent-before-Core dependencies:

- deploy the bounded completed-callback producer before Core enforces its
  ceiling, so the strict Core reader cannot receive an oversized callback from
  an older producer;
- deploy Remote Agent's optional `retryAfterMs` response consumer before Core
  emits provider backpressure, because the older strict response parser rejects
  unknown fields.

Old Core accepts the bounded callback and omits `retryAfterMs`; the new Remote
Agent accepts that omission. Keep both windows short and both provider flags
disabled until the two services are current.

### Release 2 — Database and infrastructure

- apply D1 migrations;
- create generic Message Channel Queue;
- add Wrangler bindings, secrets, and generated types;
- verify physical schema;
- keep provider flags off.

### Release 3 — Core and Gateway, disabled

- deploy Core connection, verification, ingress, and publication support;
- deploy Gateway event/callback routes;
- verify health and internal diagnostics;
- keep public connection UI disabled.

Core consumers and verification RPCs must exist before Gateway accepts provider
events.

### Release 4 — Web and internal pilot

- deploy Channels list and wizard;
- enable Feishu and Lark only for an internal Organization;
- complete real-provider smoke;
- keep Slack on its existing ingress path.

### Release 5 — Provider pilot

- enable selected pilot Organizations;
- monitor ingress, identity, admission, callback, publication, and scope
  diagnostics;
- fix provider differences without changing Core authority.

Slack producer, Queue, ingress claim, and `slack-signal-service.ts` remain
unchanged through Release 5.

### Release 6 — Generic Slack migration

- add the Slack provider adapter and prove fixture parity;
- stop the old Slack producer before enabling the generic producer;
- route new Slack events through the generic Message Channel envelope and
  orchestration only after that cutover;
- retain the old Slack Queue consumer only to drain its pre-cutover backlog;
- retain the legacy ledger reader for historical rows;
- prove no provider event can enter both producers;
- prove real Slack regression smoke;
- monitor both paths.

### Release 7 — General availability

- enable Lark and Feishu connection for eligible Organizations;
- retain provider-specific feature flags and kill switches;
- publish the actual capability and permission matrix.

### Release 8 — Legacy retirement

Only after backlog and deployment proof:

- remove the already-disabled old Slack producer route and code;
- verify the old Queue backlog is zero, then remove its binding and consumer;
- remove temporary Slack migration flags and compatibility environment vars;
- keep historical D1 evidence readable;
- remove temporary public compatibility projections.

## 21. Rollback

Rollback order is producer-first:

1. disable Lark/Feishu connection creation;
2. disable new event producers or return retryable provider responses;
3. stop generic Slack producer if affected;
4. keep Core consumers and generic schema readers deployed;
5. keep D1 migrations and historical rows;
6. restore the previous Slack path if required;
7. never roll back by deleting connection or ledger evidence.

For card callbacks that cannot be retried, return a controlled provider-visible
failure instead of pretending acceptance.

## 22. Performance and Reliability Targets

| Surface | Target |
| --- | --- |
| Webhook ordinary-event acknowledgement | p95 < 1 second, hard < 3 seconds |
| Card callback acknowledgement | p95 < 1 second, hard < 3 seconds |
| Queue acceptance durability | required before provider success |
| Ingress duplicate logical turns | zero |
| Cross-provider locator collision | zero |
| Final duplicate provider replies | zero under confirmed provider outcomes |
| Secret/raw message diagnostic leakage | zero |
| Slack behavioral regressions | zero |
| Disconnect cross-provider impact | zero |
| Mainland Feishu to Gateway reachability | must pass §14.1 Gate 0A before any Feishu pilot |

Failure of the mainland reachability row blocks Feishu Webhook rollout. It
starts the §14.3 connector qualification; it does not waive the SLO or
automatically approve WebSocket.

## 23. Final Architecture Decisions

These decisions are the implementation baseline:

1. **Cardinality:** one Slack + one Lark + one Feishu connection per
   Organization.
2. **One Center Agent:** all providers target the one Organization
   designation and hosted Binding.
3. **Result isolation:** reply only to the originating provider conversation.
4. **Production transport:** Webhook first only after Gate 0; WebSocket remains
   a qualified, connection-scoped connector option and never an automatic
   fallback.
5. **No OpenConnector for Channel routing:** direct OpenMeld Channel
   integration.
6. **Physical storage:** preserve current Slack connection tables; add a shared
   projection and provider adapters rather than migrating Slack credentials in
   the first Lark release.
7. **Native Delivery:** one generic Message Channel locator and publication
   coordinator; no Lark/Feishu ledger or worker.
8. **Channel permissions:** prefer the verified channel-only template; use the
   unchanged official preset only when the brand does not honor it. Do not add
   business-domain scopes or user OAuth in this plan.
9. **Two-grant boundary:** the Channel grant ships here; a User App grant is a
   separate Settings → Apps design with exactly one credential and action
   owner.
10. **SDK and platform gates:** Provider Platform and Worker compatibility
    gates precede Package E/F. Reuse only the compatible SDK subset; the Vercel
    Chat Adapter and high-level Channel module remain conformance evidence, not
    execution truth.
11. **Pilot versus GA:** Personal Agent QR flow first; Store/ISV distribution
    only after real value validation.
12. **Routine parity:** interactive Message Channel support ships first;
    Feishu/Lark Routine destinations require a separate explicit parity slice
    before being claimed as supported.

## 24. Definition of Done

The implementation is complete only when:

- one Organization visibly owns Slack, Lark, and Feishu connections at the
  same time;
- all three target the exact same Center Agent Profile and Binding;
- every provider turn uses one shared admission, worker, memory, quota,
  recovery, and audit path;
- every final result is fenced and returns only to its originating provider;
- unknown and cross-Organization identities fail closed;
- provider scopes and capabilities are honest and observable;
- Webhook acknowledgement meets the provider deadline;
- real Feishu, Lark, and Slack smoke passes;
- the Contract Impact Audit and database physical verification pass;
- owner documents match the shipped behavior;
- no new duplicate execution, routing, identity, or diagnostic source of truth
  exists.
