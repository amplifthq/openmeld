---
id: cli-bundled-internal-adapters
title: Keep internal adapters inside CLI releases
kind: fixed
areas: ["cli", "releases"]
audiences: ["users", "operators"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1732", "workflow:38595947657"]
---

The CLI includes the Grok Bot adapter without requiring an unpublished internal
package during npm installation. Release checks now reject internal packages
listed as external runtime dependencies before attempting consumer installation.
