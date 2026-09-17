# Feishu and Lark parity implementation

## Agent Context

- Purpose: Record PR 864's native-channel parity implementation, rollout dependencies and acceptance limits.
- Read this when: Validating or releasing PR 864 and continuing its deferred native acceptance.
- Update this when: The implementation, rollout evidence or deferred acceptance changes.
- Do not use this for: A new release authorization or business-App permissions.
- Source of truth: This review owns scoped implementation evidence; shared-contracts and runtime owner documents own permanent contracts.

Status: ready for independent release; local acceptance is bounded below.
Remove when staged rollout and deferred native acceptance are complete and permanent contracts have been absorbed into their owner documents.

The user accepted the first conversation-feedback slice and authorized sequential
implementation of native-channel parity and differentiated Feishu/Lark workflows.
PR 864 is ready for its separately authorized release after the main batch.

## Rich-message input

Received `post` messages now preserve titles, paragraphs, links, mention keys,
code indentation and image resource references. History reads use the same post
parser. Where supplied, `content_v2` preserves original Markdown; legacy nodes
still supply resource provenance. Unsupported rich nodes are explicitly marked,
and unsupported media still enters the existing truthful attachment failure path.

The implementation follows the official [received message structure](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/message_content),
which differs from the locale-wrapped [outgoing structure](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json).
No SDK dependency or upgrade is needed for this bounded provider payload parser.
No competitor code is copied. Bot addressing remains derived only from verified
provider mention identity, never from display names or model text.

This preserves existing architecture ownership: no new execution truth, credentials,
resource authority, wire schema, or database state. Focused parser and signed-ingress
tests cover both provider variants. Native Feishu rich-message input passed local
acceptance; separate Lark conversation acceptance remains deferred.

## Current-message file reads

`openmeld_read_channel_file` reads only resource keys frozen by Core from the
current admitted message. The Core RPC rechecks designation, Organization,
profile, dispatch, conversation, connection and active delivery before using the
existing [message resource download API](https://open.feishu.cn/document/server-docs/im-v1/message/get-2).
File IDs or names supplied by a model never grant access. Credentials remain in
Core. The Native Delivery request retains bounded descriptors, not file bytes.

Files use the same 5 MiB bound as Slack, bounded text previews and exclusive,
non-symlink Computer writes. The Computer handoff now names its actual common
responsibility; Slack retains its existing directory and behavior. Binary files
are saved for Computer processing, not falsely claimed to have been understood.
No Computer means an explicit binary-inspection limitation. Image admission
retains its existing magic-byte checks. Audio/video-specific processing is not
implemented merely because an opaque file can be downloaded.

## Exact thread history

History uses the provider's `thread` container when the admitted event supplies a
thread ID. The official [history API](https://open.feishu.cn/document/server-docs/im-v1/message/list)
specifies that chat reads return only topic roots in ordinary groups. Thread
reads do not support time filters, so later concurrent messages are excluded
against the admitted event timestamp after retrieval. Chat reads round the
upper bound up to retain earlier messages in the same second. The existing
bounded history and frozen conversation checks remain in place. Both provider
variants have focused coverage; this does not grant access to other chats.

## Native file output

`openmeld_send_channel_file` sends a selected Computer file only to the current
admitted conversation. It follows the official [file upload example](https://open.feishu.cn/document/server-docs/im-v1/file/create)
and native message reply contract. Core verifies the represented member, active
delivery, destination and SHA-256 digest. Files remain bounded to 5 MiB. The
existing Slack publication ledger owns claims and replay, extended with the
`message_channel_file` destination. Private uploads precede visible publication;
a lost, malformed or server-error reply response preserves an unknown outcome.
Completed retries return the saved receipt without a second upload.

This sends ordinary native file attachments, not inline image cards or automatic
callback attachments. It does not grant arbitrary chat or Routine publication.
Native Feishu local smoke verified a real file and its preview in the original
topic. The first natural-language request generated invalid Code Mode calls;
an explicit-tool follow-up succeeded. This is not first-attempt task success.

## Contract impact and rollout

The optional `trigger.resources` and `trigger.filePublicationSupported` fields
and file RPCs are shared cloud contracts.
New readers accept old envelopes without resources. Old strict envelope readers
do not accept the new field. Apply migration 0165, deploy the compatible Web and
Gateway readers, then Remote Agent, then Auth and Core. File reading is exposed
only with nonempty Core-frozen resources; sending requires Core's explicit
capability. Old-Core requests therefore expose neither new file tool, cannot call
the new RPCs, and cannot emit their new work-activity keys while old Core is live.
New Core installs the RPCs and activity readers before producing resource/capability
evidence. Keep compatible readers when rolling back behavior; do not roll Core
back to a parser that rejects resource-bearing durable requests. Drain affected
turns or use a reader-preserving revert.

CLI, Service, managed Skills, Prepare, workstation Wake and diagnostic payloads
keep their existing execution contracts and contract versions. Shared schemas
are still bundled into the local artifacts: Core preflight rejected the stale
Service bundle hash, so release PR 881 stamped compatible CLI/Service 0.3.194.
It preserved the CLI required floor at 0.3.193. Audit action set v22 adds `read_channel_file` and
`post_channel_file`; older action sets exclude both before querying. Migration
0165 preserves existing publication rows and widens the destination check; its
table rebuild uses D1-compatible deferred foreign keys. No binding changes.
Normal frozen result placement,
RuntimeCoordinator ownership and separate business-App consent remain unchanged;
this does not violate the scoped architecture contracts. Local Feishu file
read/publication and rich input were observed in the native client. Lark creation
and connection passed; Lark conversation and production product smoke are deferred
by the user. Boundary tests are separate evidence, not substitutes for these paths.

## Shared authorization-update reminders

The existing Inbox item and email-delivery tables project source-owned permission
requirements to current Organization owners/admins. No new grant ledger or D1
migration is introduced. A source predicate is evaluated in the same D1 batch as
creation/resolution; delayed work cannot reopen an already-recovered requirement
or resolve a newer requirement from a stale snapshot. Fanout is atomic per
Organization. Background discovery admits at most 20 Organizations per tick and
excludes already-projected requests. Verified connection completion also reconciles
immediately. The current single operational database permits these guarded writes;
a future source-database split must replace the cross-table guard with the source's
transactional outbox, not copy authorization truth into Inbox.

Slack uses the exact shared OAuth scope list and records unknown grants as unknown.
Feishu/Lark compare the verified bundle and explicit consent failures. A connected
older bot can reuse the existing registration repair/configuration transaction to
update permissions. Its app ID and encrypted credentials are retained. Configuration
must verify the actual provider grants before connected status clears the reminder.
Any current manager may finish the shared connection's consent flow.

Web exposes permission updates without treating an otherwise connected Slack bot
as disconnected or changing direct-message readiness. Existing connection projection
reason strings carry the action. Registration responses additionally allow explicit
authorization-update and permission-bundle-mismatch reasons with a consent URL.
Deploy updated Web readers before Core produces those responses. Existing CLI,
Service, Skills, Gateway request and workstation Wake contracts are unchanged.

Tests cover manager-only visibility/email checks, duplicate suppression, stale
creation/resolution, all-recipient read/resolution, both provider variants and
updating the original bot with another manager. Browser evidence remains separate.

## Remaining native product capabilities

The current-main integration assigns native attachment tools their own shared
work-activity keys and Web presentation. Deploy the compatible Core and Web
readers before Remote Agent emits `message_channel.file.read` or
`message_channel.file.send`; older strict activity readers reject these keys.
The request-evidence gates above allow the Remote Agent receiver to deploy first
without exposing those producers to an old Core. Do not remove these gates when
changing capability discovery.
This remains a cloud-native tool path, with no new CLI or Service producer.

1. Broader authorized chat read/write tools and inline output images.
2. Typed actions and current-chat Routine destinations through canonical owners.
3. Separately consented business Apps and native workflow cards/forms.

These rows remain pending until implemented and verified; a shared adapter does
not imply separate Feishu and Lark product acceptance.
