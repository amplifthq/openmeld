---
id: plugin-git-connection-transport
title: Prepare Git transport for personal and organization Plugins
kind: improved
areas: ["plugins"]
audiences: ["developers"]
---

Plugins provides a host adapter for Git read streams through a selected personal
or organization GitHub connection. It checks current connection access on each
exchange and keeps provider credentials inside OpenConnector. Computer command
integration and the updated OpenConnector deployment are required before users
can use this path.

Action execution requests metadata by exact Action ID instead of transferring
the full service catalog when the connector supports the filter.
