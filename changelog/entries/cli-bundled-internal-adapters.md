---
id: cli-bundled-internal-adapters
title: Keep internal adapters inside CLI releases
kind: fixed
areas: ["cli", "releases"]
audiences: ["users", "operators"]
---

The CLI includes the Grok Bot adapter without requiring an unpublished internal
package during npm installation. Release checks now reject internal packages
listed as external runtime dependencies before attempting consumer installation.
