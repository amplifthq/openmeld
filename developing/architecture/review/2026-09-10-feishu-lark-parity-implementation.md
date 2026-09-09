# Feishu and Lark parity implementation

The user accepted the first conversation-feedback slice and authorized sequential
implementation of native-channel parity and differentiated Feishu/Lark workflows.
PR 864 remains draft; this is not merge or deployment authorization.

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
tests cover both provider variants. Browser acceptance for this slice is pending.

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

## Contract impact and rollout

The optional `trigger.resources` field and file RPC are shared cloud contracts.
New readers accept old envelopes without resources. Old strict envelope readers
do not accept the new field. Deploy the compatible Remote Agent reader first,
then Core's RPC and resource-producing ingress together. Before new Core writes
resource evidence, new Remote Agent cannot call this RPC: execution requires that
evidence. Keep compatible readers when rolling back behavior; do not roll Core
back to a parser that rejects resource-bearing durable requests. Drain affected
turns or use a reader-preserving revert.

CLI, Service, managed Skills, Prepare, workstation Wake and diagnostic payloads
keep their existing execution contracts, so their contract versions and published
local artifacts need no bump. Audit action set v22 adds `read_channel_file`;
all older action sets exclude that action before querying, preserving old audit
readers. No migration or Cloudflare binding changes. Normal frozen result placement,
RuntimeCoordinator ownership and separate business-App consent remain unchanged;
this does not violate the scoped architecture contracts. Real native-client file
smoke is pending and is not replaced by the permission and byte-handling tests.

## Pending sequence

1. Native output files and authorized chat read/write tools.
2. Typed actions and current-chat Routine destinations through canonical owners.
3. Separately consented business Apps and native workflow cards/forms.

These rows remain pending until implemented and verified; a shared adapter does
not imply separate Feishu and Lark product acceptance.
