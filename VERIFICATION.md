# Verification Guide

This file is the canonical validation map for this repository. Use it to choose
the smallest gate that proves a change, then run the broader release gates
before pushing, deploying, or declaring production smoke clear.

## Canonical Gate Order

1. Check ownership before running edits or staging:
   `git status --short`. Do not touch or stage unrelated dirty or untracked
   files.
2. Refresh workspace dependencies when workspace shape changed:
   `pnpm install`.
3. Run formatting and static checks for the files or packages you touched:
   `pnpm exec ultracite check <paths>` or the package `check` script.
4. Run the owning typecheck for typed code changes. Apply the Practical Test
   Standard in `developing/engineering/development-workflow.md`; when the change
   has behavior or risk that needs a test, run the focused test at the owning
   seam. Use package-local commands first, for example
   `pnpm -C clients/web run typecheck` or
   `pnpm -C services/core run test`.
5. Expand to affected checks or tests when the change crosses package boundaries.
   Run a registered integration suite only when it proves a real boundary changed
   by this work.
6. Run `pnpm build` before committing any package wiring, export, schema, or
   import-path change.
7. Run the narrowest applicable pre-push or PR gate from the table below.
   `pnpm test:full` is an exhaustive diagnostic, not a mandatory local closeout
   for every change.
8. Before any manual production deploy, use the guarded deploy entrypoint:
   `pnpm run deploy`. Do not bypass `verify:release-ready`.
9. After deployment, run the production smoke checklist in
   `docs/architecture/production-smoke.md` and record the result in
   `docs/architecture/smoke-log.md`.

## Root Entrypoints

| Command | Meaning |
| --- | --- |
| `pnpm build` | Builds every package through Turbo. Use this after package exports, imports, generated types, or build surfaces change. |
| `pnpm test` | Runs package unit tests through Turbo. This excludes root-level integration and runtime gates. |
| `pnpm run test:integration` | Runs package integration tests through Turbo. This is separate from `pnpm test`. |
| `pnpm run test:runtime` | Runs runtime-oriented tests through Turbo. |
| `pnpm test:full` | Exhaustively runs unit, integration, and runtime suites in that order. Use for deliberate whole-repository diagnosis, not routine narrow closeout. |
| `pnpm run check:affected` | Runs affected package checks from the current base ref. Fetch or set `OPENMELD_AFFECTED_BASE` if the base cannot be inferred. |
| `pnpm run test:affected` | Runs affected package unit tests from the current base ref. |
| `pnpm run test:integration:affected` | Runs affected package integration tests from the current base ref. |
| `pnpm verify:pre-push` | Runs workspace consistency, release-workflow, Cloudflare environment-contract, retired-identifier, and local-component release-readiness guards. It does not run broad affected tests. |
| `pnpm run verify:pre-push:full` | Runs affected `check` and unit `test` with limited concurrency, then local-component release readiness. Use when a push needs broad affected-package confidence. |
| `pnpm run verify:pr` | Runs affected `check` and unit `test` with limited concurrency. It does not run integration suites. |
| `pnpm run verify:pr:full` | Runs affected `check`, unit `test`, and `test:integration` with limited concurrency. Use only when the changed boundary needs affected integration coverage. |
| `pnpm run verify:release-ready` | Verifies local component release readiness. It is mandatory before manual deploys that touch CLI, OpenMeld Service carrier files, managed skills, daemon schemas, or `release/local-components.json`. |
| `pnpm run deploy` | Runs `verify:release-ready -- --force`, then deploys Cloudflare workers and web through the guarded deployment path. |

## Package Test Entrypoints

| Package | Command | Meaning |
| --- | --- | --- |
| `clients/openmeld-cli` | `pnpm -C clients/openmeld-cli run test` | CLI unit test suite only. It does not run CLI integration tests. |
| `clients/openmeld-cli` | `pnpm -C clients/openmeld-cli run test:integration` | CLI integration suite. Use when CLI command, setup, local-service, Space, or human/agent view behavior crosses process, filesystem, or service boundaries. |
| `clients/openmeld-cli` | `pnpm -C clients/openmeld-cli run test:full` | CLI unit suite plus CLI integration suite. |
| `clients/web` | `pnpm -C clients/web exec vitest run --config vitest.config.ts` | Web unit suite. |
| `clients/web` | `pnpm -C clients/web exec vitest run --config vitest.integration.config.ts src/components/agents/agents-page.integration.test.tsx` | Agents page integration baseline. |
| `clients/web` | `pnpm -C clients/web exec vitest run --config vitest.integration.config.ts src/components/spaces/space-landing.integration.test.tsx` | Space landing integration baseline. |
| `services/core` | `pnpm -C services/core run test` | Core boundary tests. |
| `services/core` | `pnpm -C services/core run test:integration` | Core Workers integration tests. |
| `services/gateway` | `pnpm -C services/gateway run test` | Gateway Vitest suite. |
| `runtime/local-service` | `pnpm -C runtime/local-service run test` | Builds local-service and runs its Node test suite. |
| `runtime/local-execution` | `pnpm -C runtime/local-execution run test` | Local execution Vitest suite. Use the narrower runtime scripts when validating scheduler, replay, observability, or task orchestration behavior. |

## False-Green Traps

- `pnpm -C clients/openmeld-cli run test` is not enough for CLI changes. It excludes
  `clients/openmeld-cli` integration tests, so CLI command changes can look green
  while interactive setup, Space, service, or trace flows are broken.
- A known-red suite is not a pass by itself. Compare the exact failure set
  against a clean-worktree baseline at the same HEAD and fail the gate on any
  new failure. See Baseline Discipline below.
- Do not prove absence with truncated output. Use `git ls-files` scope for
  repository inventory and avoid `| head` when the result supports a deletion
  or "no references" claim.

## Baseline Discipline

Do not hardcode suite counts or failure lists in documentation; they rot and
then mislead. When a suite is not fully green at HEAD, capture the baseline
live instead of quoting a recorded one:

1. Create a clean temporary worktree at the same HEAD.
2. Run the identical command sequence there.
3. Compare exact failure names between the clean worktree and your change.
4. Fail the gate on any new failed file or failed test, record the evidence in
   the handoff, and remove the worktree.

A change is only clear when its failure set is identical to the clean baseline
or strictly smaller.

## Canary Gates

Canary gates validate local component behavior without touching the user's
production `~/.openmeld` lane. Use them when a change touches OpenMeld CLI packaging,
OpenMeld Service lifecycle, daemon/local-service contracts, local execution carrier
behavior, setup handoff, service state repair/reset, managed skills, or any path
where `verify:release-ready` is required before deploy.

Run the canary gates from the repository root:

```bash
pnpm run openmeld:canary:verify-service
pnpm run openmeld:canary:verify-journey
pnpm run openmeld:canary:verify-release
```

Canary success does not replace production smoke. Production smoke must still
use user-accessible entrypoints such as OpenMeld Web UI, the published `openmeld` CLI,
installed OpenMeld Service commands, Space Wake, and supported trace commands.
