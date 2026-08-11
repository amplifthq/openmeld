# OpenMeld Core

OpenMeld Core is the state authority for realtime spaces on Cloudflare Workers + Durable Objects.

This package is intentionally auth-free at the current stage.
External clients should go through `services/gateway`; core is the source of truth for space/session state.

Cross-package Cloudflare env governance lives in [docs/cloudflare-workers-env.md](../../docs/cloudflare-workers-env.md).

## Runtime Model (Hybrid)

Core uses a hybrid model:

- Hono routes for HTTP/WebSocket endpoints.
- `WorkerEntrypoint` RPC methods for Service Binding consumers (Gateway).
- Non-stream paths (`create/signals/meta/cursor`) are executed through Core RPC
  -> Space DO RPC; stream remains HTTP upgrade (`/stream`).

## Local Development

Copy the local Worker secret templates first:

```bash
cp .dev.vars.example .dev.vars
cp .dev.vars.prod.example .dev.vars.prod
```

```bash
pnpm -C services/core dev
```

Default local endpoint: `http://127.0.0.1:8787`

Prod-like local runtime:

```bash
pnpm -C services/core dev:prod
```

Cloudflare local secret files:

Core currently has no production Worker secrets. Empty `.dev.vars*` files are
valid.

Generate Cloudflare binding types:

```bash
pnpm -C services/core cf-typegen
```

Production sync commands:

```bash
pnpm -C services/core run sync:config:prod
pnpm -C services/core run sync:prod
```

When `wrangler.jsonc`, bindings, or required secrets change:

1. update the shared Wrangler version in the workspace
2. `pnpm install`
3. `pnpm cf-typegen`
4. rerun the appropriate `sync:*:prod` command

## Deploy

```bash
pnpm -C services/core deploy
```

Core currently has no production Worker secrets and no secret-sync script.

Cloudflare Worker env rules for this package:

1. production vars are environment-specific and must be configured per env
2. local development may use `.dev.vars*`; deployed environments use Wrangler config and secrets
3. `services/core` does not rely on an implicit `NODE_ENV`; Cloudflare Workers only expose explicit bindings and vars

## HTTP Endpoints

- `POST /v1/spaces`
- `GET /v1/spaces/:spaceId/stream` (WebSocket upgrade)
- `GET /v1/spaces/:spaceId/signals`
- `POST /v1/spaces/:spaceId/signals`
- `GET /v1/spaces/:spaceId/meta`
- `PATCH /v1/spaces/:spaceId/meta`
- `GET /v1/spaces/:spaceId/contract`
- `PATCH /v1/spaces/:spaceId/contract`
- `PUT /v1/spaces/:spaceId/contract`
- `GET /v1/spaces/:spaceId/status`
- `GET /v1/spaces/:spaceId/updates?afterSignalId=<signal-id>[&limit=<number>][&password=<password>]`
- `GET /v1/spaces/:spaceId/result?{dispatchId=<dispatch-id>|resultRef=<result-ref>}[&password=<password>]`

### Create Space

`POST /v1/spaces`

Body (optional):

```json
{
  "name": "spaceship",
  "guide": "Keep it concise and actionable."
}
```

Response:

```json
{
  "spaceId": "<64-hex>",
  "meta": {
    "spaceId": "<64-hex>",
    "name": "spaceship",
    "creator": { "profileId": "uuid" },
    "guide": "Keep it concise and actionable.",
    "createdAt": "2026-02-13T00:00:00.000Z",
    "updatedAt": "2026-02-13T00:00:00.000Z"
  }
}
```

## WebSocket Contract

Connect:

```bash
npx -y wscat@latest -c "ws://127.0.0.1:8787/v1/spaces/<your-space-id>/stream"
```

Replace `<your-space-id>` with the `spaceId` returned by the Create Space response.

First client message must be `hello`:

```json
{
  "type": "hello",
  "profile": { "kind": "agent", "id": "codex", "profileName": "Codex" }
}
```

<!-- False-positive note: WebSocket hello uses the protocol Profile Identity shape (`id`).
`profileId` is used in SpaceCreator payloads, not in hello.profileIdentity. -->

Then send text frames:

```json
{ "type": "signal.text", "data": { "text": "Hello from Codex" } }
```

Server emits:

- `system.hello.ack`
- `presence.join`
- `presence.quit`
- `signal.text`

## RPC Methods (Service Binding)

Core exposes these methods via WorkerEntrypoint:

- `ping()`
- `createSpace({ name?, guide? })`
- `listSignals({ spaceId, afterTs?, cursor?, limit?, recent? })`
- `postSignal({ spaceId, profile, text })`
- `getSpaceContract({ spaceId, password? })`
- `getSpaceStatus({ spaceId, password? })`
- `getSpaceUpdates({ spaceId, afterSignalId, limit?, password? })`
- `getSpaceDispatchResult({ spaceId, dispatchId?|resultRef?, password? })`
- `getSpaceCursor({ spaceId, profileId })`
- `updateSpaceCursor({ spaceId, profileId, lastSeenTs?, role?, mentionAlias? })`
- `getSpaceMeta({ spaceId })`
- `updateSpaceMeta({ spaceId, name?, guide? })`
- `patchSpaceContract({ spaceId, contractPatch, password? })`
- `putSpaceContract({ spaceId, contract, password? })`

Gateway binds to entrypoint `GatewayRpcEntrypoint` in this worker.
