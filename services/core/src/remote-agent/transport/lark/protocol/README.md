# Lark frame codec

Unmodified generated frame codec from the official `larksuite/node-sdk`, revision
`af41737d1e9d0fdb08bdbbbe3019a7c64b3d9513`, `ws-client/proto-buf/pbbp2.*`.
The upstream MIT license is included. No provider application logic is vendored.

Workers does not implement the Node HTTP `upgrade` event required by the SDK's
`ws` dependency. The owning Durable Object uses the native Workers WebSocket API
and this protocol codec, following the official WSClient handshake, heartbeat,
fragmentation and acknowledgement contract. Do not patch SDK private state or
load the complete Node transport into a request-scoped Worker.
