# Development

OpenMeld uses a pnpm and Turborepo monorepo.
Start with a docs change if you do not have access to the team's development environment.

## Prerequisites

- Git.
- [Node.js 24](https://nodejs.org/en/download).
- Corepack, which selects the pnpm version in the root `package.json`.

From your checkout:

```sh
corepack enable
corepack install
pnpm install --frozen-lockfile
```

If `corepack` is unavailable, follow the [official Corepack installation instructions](https://github.com/nodejs/corepack#manual-installs).
The install also enables repository Git hooks.

## Preview the public docs

No database, app account, or team secrets are required:

```sh
pnpm --filter openmeld-docs dev
```

Open `http://127.0.0.1:3600/docs`. Edit pages in
[clients/docs/content/docs](../clients/docs/content/docs).
The sidebar groups guides into Start, Work, Team, Help, and Reference.

If the port is busy, choose a free port:

```sh
pnpm --filter openmeld-docs dev --port 3691
```

Check the docs before submitting:

```sh
pnpm --filter openmeld-docs check
git diff --check
```

Stop the preview with Ctrl+C. See the [Docs README](../clients/docs/README.md)
for build and content details.

## Run the full application

The standard full-stack workflow requires access to OpenMeld's Doppler development
projects and local PostgreSQL 18 tools. It is a team development environment,
not a public self-hosting installer.

Follow [Environment and secrets](../developing/engineering/environment-and-secrets.md#start-in-one-minute)
for access and setup, and [PostgreSQL tools](../developing/engineering/postgresql.md#tools-and-local-development)
for database prerequisites. Once those requirements are met:

```sh
pnpm dev:doctor
pnpm dev:postgresql
```

The launcher starts Web, Workers, and PostgreSQL together.
Use its printed URLs. Each worktree has separate ports and local state.
Docker is needed only for the Sandbox-enabled workflow described in the owner guide.

If you cannot access the required development configuration, stop at that boundary.
You can still edit docs and run checks that do not need those services.
Describe any unverified application behavior in your PR so a maintainer can validate it.

Use `pnpm dev:status` to inspect this checkout's stack and `pnpm dev:stop` to stop it.
Keep test data separate from your installed OpenMeld account.

## Repository map

| Location | Responsibility |
| --- | --- |
| `clients/web` | Web application |
| `clients/desktop` | Desktop application |
| `clients/openmeld-cli` | Published CLI and local Service entry points |
| `clients/website` | Public website |
| `clients/docs` | Public product guides |
| `services/` | Cloud services, authentication, gateway, and hosted agents |
| `packages/` | Shared schemas, database code, product catalog, and UI |
| `runtime/` | Local execution and agent adapters |
| `developing/` | Engineering rules and architecture owners |

## Validate and submit

Use the affected package's scripts and focused tests.
Check [Code standards](../developing/engineering/code-standards.md) for formatting
and the [development workflow](../developing/engineering/development-workflow.md) for validation boundaries.
The [delivery workflow](../developing/engineering/agent-native-delivery.md) owns merge and release requirements.

Return to [Contributing](../CONTRIBUTING.md#open-a-pull-request) when the change is ready.
