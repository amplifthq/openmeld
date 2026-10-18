---
name: release-runbook
description: Use when asked to deploy, release, publish, or ship OpenMeld to production — workers, Web, CLI, or local components. Routes to `pnpm run deploy`; never deploy raw.
---

# Release Runbook (thin router)

Read `developing/engineering/production-release.md` before acting. If the scope
includes CLI distribution, also read
`developing/engineering/cli-binary-release.md`. Those files own every release
rule; do not restate them here.

## Entry points

- `pnpm run deploy -- --scope <auto|names> --lane <local|github|auto> --dry-run`
- `pnpm run verify:release-ready`

Select the actual lane and remaining commands from the owner document, not
from this router.
