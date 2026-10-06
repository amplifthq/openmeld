---
id: plugin-git-connection-transport
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
