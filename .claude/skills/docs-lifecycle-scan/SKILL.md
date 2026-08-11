---
name: docs-lifecycle-scan
description: Use when closing out a feature, tidying developing/ documentation, or asked to check docs health — runs the lifecycle linter and applies the README deletion rules.
---

# Docs Lifecycle Scan (thin router)

Read `developing/README.md` before acting. It owns document classification,
lifecycle markers, deletion conditions, and remediation. Do not restate those
rules here.

## Run

```
pnpm run verify:docs
```

Use `pnpm run verify:docs -- --strict` when a blocking result is required.
Interpret every result through the owner standard above.
