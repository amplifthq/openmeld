---
id: plugin-git-connection-transport
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1536","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","pr:1554","commit:0b048940e491d46ab4a03d7317b4259b1176ef26","worker-version:59b1b4ec-4357-41aa-a156-ec9bd1aab1bc","https://github.com/amplifthq/open-connector/pull/22","worker-version:510065a1-61e4-47fd-86e3-a95b431c6e36"]
title: Use connected accounts with native Git
kind: improved
areas: ["plugins"]
audiences: ["developers"]
---

Agents can clone and fetch private GitHub repositories on your cloud Computer
through an existing personal or organization Plugin connection. Git transfers
the repository directly. Provider credentials stay inside OpenConnector.

The Plugin catalog now uses each provider's available connection methods,
including alternate credential methods and multiline keys. New providers do not
need a separate OpenMeld service list entry.

Action execution requests metadata by exact Action ID instead of transferring
the full service catalog when the connector supports the filter.
