---
id: postgresql-foundation
title: Run OpenMeld locally on PostgreSQL
kind: new
areas: ["database", "development"]
audiences: ["contributors", "operators"]
---

Contributors can run the complete local OpenMeld product on PostgreSQL 18, including sign-in, workspaces, Projects, Agent Profiles, Spaces, and local Agent Wakes. The isolated development database preserves synthetic accounts and messages across restarts. Native migration, permission, concurrency, and recovery checks cover the shared database contracts.

Contributors can rehearse historical D1 data migration with isolated synthetic records, then start the complete local product on the imported database. Each snapshot gets a separate database that preserves later writes across restarts, while the original database and existing Space files remain available. The import checks every field, account credentials, Profile ownership and Inbox ordering, and verifies recovery after rejected data or interruption. Production data capture remains unavailable.

Operators have separate Amplift foundation resources, a guarded cloud acceptance probe, and a read-only cutover preparation plan in the existing release workflow. The plan shows the target, migration hashes, required maintenance checks and recovery boundaries. Release planning no longer mistakes private storage changes for opposing Core and Remote protocol dependencies. Production and shared staging remain on the deployed D1 revision. This candidate blocks product promotion until the separately reviewed data cutover and release support are implemented.
