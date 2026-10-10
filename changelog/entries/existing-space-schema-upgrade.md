---
id: existing-space-schema-upgrade
title: Keep existing Spaces readable after an update
kind: fixed
areas: ["spaces", "releases"]
audiences: ["members", "operators"]
---

Existing Spaces apply the database upgrade for deleted Space history when they
next open. Their members, settings, and messages remain available. Repeated
starts preserve the saved history and deletion state.
