# Feishu and Lark product gap audit

Status: research and prioritization only; no implementation or release requested by this audit.

## Evidence boundary

Audited on September 10, 2026 (Asia/Taipei). OpenMeld source inspected in the task-owned checkout at `75957c9cd0aac0d4beb7de82ddb2d5317ed87310`, including the merged 0.3.191 changes. Compared with freshly fetched `origin/main` at `7fe6dc4fec3b7ced5f9329a5c46a9e81ac89e3ce`: the relevant Core, Remote Agent, and Channels UI paths have no intervening differences; shared Prepare schema changes are unrelated. The user's main checkout was older and dirty and was not changed or used as the current implementation baseline.

Own production Feishu smoke from the preceding phase proves new bot setup and visible replies, not all capabilities below. Post-release direct replies B and C succeeded 161.505 seconds apart. B was still Working at +28.504 seconds and complete by +50.405; C was complete by +30.348. The connector acknowledged B durably in 22 ms. An earlier no-tools request A was incorrectly delegated. These observation bounds are not a latency distribution or proof of a particular model bottleneck. The log collector lost its connection, so the sample does not establish uninterrupted lifetime stability. Lark's equivalent new-version production matrix has not been run.

Agents Router reference: local source at `e195dba629d4efe82d55888c5c57c88551628797`. Its simpler local, single-owner Codex routing product is a useful interaction reference, not a replacement for OpenMeld's multi-member authorization and execution model.

## Main conclusion

The next step is to finish the channel as a product, not replace its transport again. OpenMeld already has WebSocket ingress, durable acknowledgement, CardKit 2.0 streaming, long-answer segmentation, identity-link cards, and the common Center Agent tool and permission layer. The current gaps are late feedback, a Markdown-only card presentation, incomplete native actions and attachments, missing Feishu/Lark tools and scheduled destinations, and incomplete onboarding and acceptance.

Connecting a messaging Channel must remain distinct from granting an App access to documents, calendars, directories, or approvals. Shared Center Agent tools are not absent merely because the initiating message came from Feishu. Conversely, having the same agent does not supply missing provider-native tools.

## Gap matrix

P0: make current conversations reliably understandable and controllable. P1: native-channel parity for daily work. P2: differentiated office workflows after the main path works. This is sequencing, not a promise to ship every row in one release.

| Area | Current OpenMeld evidence | User-visible gap and proposed outcome | Priority |
| --- | --- | --- | --- |
| Receipt and Working | Feishu reads identity, bounded history and attachments before native delivery prepares its Working card. Slack sets thread status after admission and before rich-context loading. | Show a lightweight received/working indication after the appropriate verified durable admission, without waiting for history, downloads, or the model. Distinguish receipt from execution; clear or replace it on failure. | P0 |
| Rich response card | CardKit schema 2.0 already streams one Markdown element; initial content and summary say Working. Sequence/UUID handling and rollover exist. | Add a restrained status area, final-answer area, relevant artifact links, and task actions. Keep one coherent response surface; avoid status-message spam. | P0 |
| Actual response latency | Production still showed tens of seconds despite a 22 ms durable ACK. Current evidence does not isolate every downstream stage. | Track ingress, queue, authorization, context, feedback publication, model first output, tool work and final publication separately. Improve the demonstrated blocking stages; do not hide the delay behind animation or assume China networking explains it. | P0 |
| Intent and delegation | Production A said not to use tools, but the agent reported waking another agent instead of replying directly. B/C with stronger wording replied correctly. | A direct answer request stays direct. Delegation requires the user's requested outcome to justify it. Add the failed scenario to common cross-channel acceptance; changing card styling will not fix this. | P0 |
| Stop, retry, choices and approval | Native card parsing only admits `openmeld.center_agent.submit`; identity/navigation cards primarily open URLs. No equivalent typed Stop/Retry/approval callback family was found. | Real buttons backed by canonical Task/execution operations; actor authorization, target binding, expiry, replay deduplication, stale-state rejection and visible confirmation. Never implement approval by turning arbitrary card text into an unconstrained model prompt. | P0/P1 |
| Incoming files and rich messages | Normalizer recognizes resource descriptors, but input preparation only accepts JPEG/PNG images up to 5 MB. Other resource types fail explicitly. No `post` rich-message branch was found. | First support common PDF/text/CSV/office-file workflows and mixed rich messages; retain filenames, captions, mentions and exact resource provenance. Audio transcription/video are later additions. | P1 |
| Outgoing files and images | Slack has exact-file read/send tools. Feishu/Lark generated callback attachments are explicitly not delivered; the user gets a notice. | Return actual images and files in the original conversation, with a download/open action and truthful partial-failure handling. A URL or a claim that a file was created is not file delivery. | P1 |
| Native chat discovery and reads | Slack has channel listing, member reads, bounded history and message search. Feishu has only bounded automatic current-chat context. | Authorized chat/member discovery, exact thread/history reads, message-link resolution and search where platform permissions allow. Do not promise full-tenant search from a bot's limited visibility. | P1 |
| Native publication and mentions | Slack has named-channel/exact-thread publication, verified mentions, file sending and teammate invitation flows. No Feishu/Lark counterparts were found in the agent's native tool inventory. | Explicitly requested writes to verified chats/threads, real user mentions, files, and private invitation/onboarding actions. Preserve current-turn result placement and durable operation identity. | P1 |
| Conversation continuity | DM and addressed group messages, typed chat/root/thread locators and bounded context already exist. Unaddressed group messages are ignored deliberately. | Validate quoted replies, native topic threads, follow-ups, simultaneous requests and context truncation. Use exact thread history rather than assuming a bounded chat page contains it. Keep addressing rules explicit; do not silently listen to all group traffic. | P1 |
| Routines in the current chat | Routine destination schema contains only `space` and `slack_thread`; non-Slack current-conversation resolution falls through to a Space target. | A request such as “send the report here every morning” must resolve to a supported canonical Feishu/Lark destination or explain the limitation. Implement the provider-neutral destination contract before promising this workflow. The fallback is a source-level risk, not a reproduced production incident. | P1 |
| Setup to first value | Official Personal Agent/WebSocket setup, scope verification, Repair and identity-link continuation exist. Connected summary mainly presents transport and status. Bot-added events are subscribed but not handled by the normalizer's admitted event branches. | Offer Open bot / Send first message, first-use guidance and a small set of useful examples. Show which bot/workspace was connected, what it can do, and what needs separate authorization. Repair the existing bot before asking users to recreate it. | P1 |
| Failure and recovery UX | Typed setup reason handling improved; raw `errorMessage` strings still render in several dialog states. Working and terminal delivery have durable state. | A short cause and one useful next action; expandable diagnostics for operators. Separate OpenMeld storage, provider authorization, connectivity and publication ambiguity. No indefinite Working or false “connected means end-to-end verified.” | P0/P1 |
| Native office tools | Generic App tools exist, but the allowed App service catalog lists Google services, Notion, Linear, Figma, PostHog and Cloudflare services; it does not include Feishu/Lark. | Add separately authorized Feishu/Lark Apps: document/wiki and Drive reads first, then document creation/editing, Sheets/Base, calendars, tasks and selected approval/meeting workflows. Start from concrete customer work, not an indiscriminate API dump. | P2 |
| Rich workflow results | Current provider card body is an undifferentiated Markdown response. Common Task/Space/Computer/business facts already have owners elsewhere. | Render compact task progress, artifact/document previews, source links, authorized person/project selectors and forms in the conversation. Project or task cards can reduce trips to Web while retaining Web for detailed management. | P2 |
| Regional and client quality | API hosts are separately configured for Feishu and Lark; only the own Feishu path has recent smoke evidence. | Separate acceptance for both products, mobile/desktop, linked/unlinked users, internal/guest groups, long Markdown/code/tables, localization and permission differences. A shared adapter is not proof of product parity. | All releases |

## Source evidence

OpenMeld paths are relative to the audited checkout; these are implementation evidence, not production acceptance:

- `services/core/src/remote-agent/application/message-channel-event-service.ts:360` — participant resolution; `:410` — context before submission; `:437` — attachments before submission; `:576` — addressed-message/card-action admission.
- `services/core/src/remote-agent/application/message-channel-native-delivery-service.ts:161` — Working-card preparation after delivery admission.
- `services/core/src/remote-agent/application/message-channel-working-card-service.ts:126` — initial Working text and durable create/send ownership.
- `services/core/src/remote-agent/application/slack-signal-service.ts:1342` — Slack status precedes rich context.
- `services/core/src/remote-agent/application/lark-platform-openapi-client.ts:70` — bounded history; `:831` — streaming card body; `:550` and `:585` — identity/navigation cards; `:1157` — existing token cache and request coalescing. Do not add a second token cache based on an assumption that none exists.
- `services/core/src/remote-agent/application/lark-platform-event-normalizer.ts:79` — admitted provider event types; `:106` — sole card prompt action; `:239` — message content handling.
- `services/core/src/remote-agent/application/message-channel-input-attachments.ts:59` — input attachment restriction; `lark-platform-message-channel-adapter.ts` independently restricts download to image resources.
- `services/core/src/remote-agent/application/stream-delta-service.ts:98` — provider text stream; thinking deltas are not displayed. Product progress should show real work summaries, not private chain-of-thought.
- `services/remote-agent/agent-core/tools.ts:1267` — common and Slack-specific native tools; `:4809` — shared connected Apps; `:4826` — verified Slack search gating; `:5480` — Routine destination resolution.
- `packages/schemas/src/schemas/http/connector-connections.ts:3` — supported App catalog.
- `packages/schemas/src/schemas/http/center-agent-routines.ts:54` — supported destinations and publication grants.
- `clients/web/src/components/organizations/lark-platform-channel-dialog.tsx:482` — connected/repair summary and raw error presentation.
- `config/message-channels/lark-platform-channel-only-permission-bundle.json` — Channel scopes and subscriptions.
- `developing/product/remote-agent-runtime.md:579` — shared capability/identity boundary; `:596` — provider card and attachment contracts; `:625` — persistent setup and ingress ownership.

Agents Router references, local root `/Users/felix/Desktop/felix-projects/agents-router`:

- `docs/providers/feishu-lark-app-bot.md` — official Personal Agent setup; `/new`, `/bind`, project rooms and thread continuation.
- `src/providers/feishu_lark.rs:40` — existing textual Working placeholder; `:733` — progress coalescing with 350 ms minimum interval and 24 new bytes; `:1358` — CardKit streaming; `:2390` — structured notification cards; `:2412` — Create a room / Use existing room / Ignore actions.
- Its reusable advantage is short, explicit interactions around a real project/thread, not a claim that merely choosing WebSocket makes the entire agent fast. Do not copy absolute local paths into shared organization cards or replace OpenMeld Project identity with a local folder string.

## External reference findings

- OpenClaw's [pinned reaction implementation](https://github.com/openclaw/openclaw/blob/ef37c4f3755d4a424c12530d9339d48f2fbcdc8d/extensions/feishu/src/typing.ts) creates/removes a native Typing reaction on the incoming message independently of the response card. This is a relevant pattern for prompt feedback, not evidence of a guaranteed competitor response time. Its [card interaction envelope](https://github.com/openclaw/openclaw/blob/ef37c4f3755d4a424c12530d9339d48f2fbcdc8d/extensions/feishu/src/card-interaction.ts) binds actor/chat/expiry; native actions need equivalent OpenMeld-owned authorization.
- The [official reaction API](https://open.feishu.cn/document/server-docs/im-v1/message-reaction/create.md) accepts either broad `im:message` or the dedicated reaction-write permission. Our declared Channel bundle already includes the former; do not assume another permission request is automatically needed. Actual grants and target-chat membership still require verification.
- The [official CardKit guide](https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview.md) documents structured streaming and lifecycle constraints: JSON 2.0/client compatibility, per-card rate limits, explicit streaming completion, and preview summary updates. During streaming a callback cannot immediately update the card. Controls must account for that lifecycle rather than treating the card as arbitrary HTML.
- OpenClaw's [official channel overview](https://docs.openclaw.ai/channels/feishu) documents DM/groups, streaming cards and document/wiki/Drive/Base tools. The audit uses pinned current source rather than assuming a release named OpenClaw 2.0.
- Hermes's [pinned first-party guide](https://github.com/NousResearch/hermes-agent/blob/e74c4a00ca77c662ffb44bc2986cf877df196dd3/website/docs/user-guide/messaging/feishu.md) describes Typing/failure reactions, native media and approval choices. These are documentation-verified, not implementation-tested; source retrieval was incomplete. Do not claim Hermes CardKit streaming parity or a complete office-tool suite from this evidence.
- Official [Feishu](https://open.feishu.cn/llms.txt) and [Lark](https://open.larksuite.com/llms.txt) catalogs separate application and user-token authority. Document/Base/calendar integration requires explicit business access, not merely a connected messaging bot. Detailed numeric CardKit constraints were checked against Feishu; verify Lark specifics before claiming identical limits.

## Implementation sequence

1. Keep the current connector and provider adapter. Build the first coherent vertical slice around prompt verified feedback, a useful response card, and correct terminal cleanup. Use the current Native Delivery owner; do not introduce a parallel card/task state authority.
2. Add native media plus the highest-value chat read/write tools. Tool names, shared schemas and provider capability declarations should cover the actual operations; keep provider-specific limits explicit. Do not force a simultaneous Slack migration merely to obtain a uniform file layout.
3. Add typed actions and scheduled current-chat delivery against canonical Task, execution and Routine owners. A displayed card or button is never authorization or execution truth.
4. Add selected business Apps with separate consent. Channel credentials remain inaccessible to model-authored arbitrary business requests. Shared versus member connections, guests and requester identity retain existing policies.
5. Add richer document/Base/task workflows after the above is accepted. Feishu/Lark can exceed today's Slack experience through native forms, record/table views and actionable artifacts, not by filling every card with controls.

Suggested acceptance target, to confirm against provider behavior before treating as an SLO: visible truthful acknowledgement around 1–2 seconds on the ordinary path, measured separately from model response time. Establish a representative p50/p95 baseline rather than using two smoke messages as performance statistics.

Each shipped slice must exercise Feishu and Lark separately through real DM and group/thread entry points, account linking and permission denial, a long-running tool, direct no-tools answer, files, duplicate delivery/repeated clicks, interruption, rate limiting and final publication. Add only the cases touched by that slice. Screenshots prove presentation; protocol, permission and durability checks prove the other contracts.

## Architecture and scope review

No product code, resource configuration, PR, merge or deployment changed in this audit. The proposed direction preserves the scoped architecture rules: one Center Agent, canonical identities and Tasks, RuntimeCoordinator execution authority, one frozen normal response destination, and separate Channel/App authority. Routines and typed card actions need explicit shared-contract changes before implementation. Immediate feedback must never claim execution has started before the owning state says so.
