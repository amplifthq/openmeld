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

## Remaining sequence

1. Native input/output files and authorized chat read/write tools.
2. Typed actions and current-chat Routine destinations through canonical owners.
3. Separately consented business Apps and native workflow cards/forms.

These rows remain pending until implemented and verified; a shared adapter does
not imply separate Feishu and Lark product acceptance.
