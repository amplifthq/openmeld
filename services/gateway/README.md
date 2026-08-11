# OpenMeld Gateway

OpenMeld Gateway is the public ingress worker for OpenMeld.

Cross-package Cloudflare env governance lives in [docs/cloudflare-workers-env.md](../../docs/cloudflare-workers-env.md).

It fronts core with:

- Non-stream HTTP endpoints forwarded through Service Binding RPC.
- WebSocket proxying for realtime stream.
- Protocol guardrails (first frame must be `hello`).
- Request context propagation and audit logging.

## Public Endpoints

- `POST /v1/spaces`
- `GET /v1/spaces/:spaceId/stream`
- `POST /v1/spaces/:spaceId/signals`
- `GET /v1/spaces/:spaceId/signals`
- `GET /v1/spaces/:spaceId/meta`
- `PATCH /v1/spaces/:spaceId/meta`
- `GET /v1/spaces/:spaceId/cursors/:profileId`
- `PATCH /v1/spaces/:spaceId/cursors/:profileId`

## Route Behavior

- HTTP routes call Core RPC methods through Service Binding `OPENMELD_CORE_WORKER`.
- Cursor routes proxy `getSpaceCursor` / `updateSpaceCursor` through
  `OPENMELD_CORE_WORKER` at `/v1/spaces/:spaceId/cursors/:profileId`.
- The stream route keeps HTTP upgrade semantics and uses upstream
  `OPENMELD_CORE_WORKER.fetch(...)` for WebSocket relay.
- If first client frame is not `hello`, gateway closes with `1008` and `hello_required`.

## Root Service Document

`GET /` returns:

```json
{
  "service": "openmeld-gateway",
  "endpoints": {
    "createSpace": "POST /v1/spaces",
    "joinSpace": "GET /v1/spaces/:spaceId/stream",
    "postSignal": "POST /v1/spaces/:spaceId/signals",
    "listSignals": "GET /v1/spaces/:spaceId/signals",
    "getSpaceMeta": "GET /v1/spaces/:spaceId/meta",
    "updateSpaceMeta": "PATCH /v1/spaces/:spaceId/meta",
    "getSpaceCursor": "GET /v1/spaces/:spaceId/cursors/:profileId",
    "updateSpaceCursor": "PATCH /v1/spaces/:spaceId/cursors/:profileId"
  }
}
```

## Local Development

Run gateway:

```bash
pnpm -C services/gateway dev
```

Default local endpoint:

- `http://127.0.0.1:8080`

Gateway expects Service Binding:

- `OPENMELD_CORE_WORKER` -> `openmeld-core` (entrypoint: `GatewayRpcEntrypoint`)

Generate Cloudflare binding types:

```bash
pnpm -C services/gateway cf-typegen
```

Production sync commands:

```bash
pnpm -C services/gateway run sync:config:prod
pnpm -C services/gateway run sync:prod
```

Gateway does not own any Cloudflare Worker secrets. Its production sync path is
only `wrangler.jsonc` config plus deploy-time service bindings.

## Quality Gates

```bash
pnpm turbo run check --filter=@openmeld/gateway
pnpm turbo run test --filter=@openmeld/gateway
```
