---
id: postgresql-foundation
title: Run OpenMeld locally on PostgreSQL
kind: new
areas: ["database", "development"]
audiences: ["contributors", "operators"]
---

Contributors can run the complete local OpenMeld product on PostgreSQL 18, including sign-in, workspaces, Projects, Agent Profiles, Spaces, and local Agent Wakes. The isolated development database preserves synthetic accounts and messages across restarts. Native migration, permission, concurrency, and recovery checks cover the shared database contracts.

Contributors can rehearse historical D1 data migration with isolated synthetic records. The rehearsal preserves account credentials, Profile ownership checks and Inbox ordering, checks every imported field, and verifies recovery after rejected data or an interrupted import. Production data capture remains unavailable.

Operators have separate Amplift foundation resources, a guarded cloud acceptance probe, and a documented cutover workflow. Production and shared staging remain on the deployed D1 revision. This candidate blocks product promotion until the separately reviewed data cutover and release support are implemented.
