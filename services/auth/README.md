# OpenMeld Auth Worker

OpenMeld Auth Worker is the Better Auth-backed authentication service for OpenMeld.

Cross-package Cloudflare env governance lives in [docs/cloudflare-workers-env.md](../../docs/cloudflare-workers-env.md).

## Local Development

Copy the local secret templates first:

```bash
cp .dev.vars.example .dev.vars
cp .dev.vars.prod.example .dev.vars.prod
```

Run the worker:

```bash
pnpm -C services/auth dev
pnpm -C services/auth dev:prod
```

Local secret files:

1. `wrangler dev` reads `.dev.vars`
2. `wrangler dev --env prod` reads `.dev.vars.prod`
3. Keep auth secrets only in `.dev.vars*` locally, never in `wrangler.jsonc`

## Cloudflare Types

```bash
pnpm -C services/auth cf-typegen
```

If you change `wrangler.jsonc`, bindings, or required secrets:

1. update the shared Wrangler version in the workspace
2. `pnpm install`
3. `pnpm cf-typegen`

## Production Sync

```bash
pnpm -C services/auth run sync:secrets:prod
pnpm -C services/auth run sync:config:prod
pnpm -C services/auth run sync:prod
```

Auth secret contract:

1. `BETTER_AUTH_OPENMELD_SECRET`
2. `GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`
3. `GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`

These secrets live in `.dev.vars*` locally and Cloudflare Worker secret storage
in production. Non-sensitive auth config stays in `services/auth/wrangler.jsonc`.
Transactional auth email uses the `AUTH_EMAIL` Cloudflare Email Service
`send_email` binding declared in `wrangler.jsonc`; it is a Worker binding, not a
Worker secret.
