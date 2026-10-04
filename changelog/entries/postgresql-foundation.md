---
id: postgresql-foundation
title: Run OpenMeld locally on PostgreSQL
kind: new
areas: ["database", "development"]
audiences: ["contributors", "operators"]
---

Contributors can run the complete local OpenMeld product on PostgreSQL 18, including sign-in, workspaces, Projects, Agent Profiles, Spaces, and local Agent Wakes. The isolated development database preserves synthetic accounts and messages across restarts. Native migration, permission, concurrency, and recovery checks cover the shared database contracts.

Contributors can rehearse historical D1 data migration with isolated synthetic records, then start the complete local product on the imported database. Each snapshot gets a separate database that preserves later writes across restarts, while the original database and existing Space files remain available. The import checks every field, account credentials, Profile ownership and Inbox ordering, and verifies recovery after rejected data or interruption. Startup can recover a missing local receipt after a committed import, including after later database migrations, using the original completion evidence. Missing or mismatched database evidence keeps startup closed. Read-only reconciliation and native backup/restore checks help preserve later PostgreSQL writes. Production capture requires the registered frozen source and a separately authorized maintenance window.

The migration tooling also accepts an identified frozen D1 source. It checks the complete write barrier and retains its maintenance history as evidence, while importing only business data into PostgreSQL. Operators can prepare a remote capture, verify the native import and use the existing guarded release for a coordinated maintenance window. Deployment keeps scheduled jobs paused until an explicit restore action; it does not reopen traffic automatically.

Operators have separate Amplift foundation resources, a guarded cloud acceptance probe, and a read-only cutover preparation plan in the existing release workflow. The probe can check actual Profile and Project operations through Hyperdrive, including later-request reads and ownership or permission refusal. The existing foundation history is preserved before applying the native product schema. The plan shows the target, migration hashes, required maintenance checks and recovery boundaries. Release planning no longer mistakes private storage changes for opposing Core and Remote protocol dependencies. Production and shared staging remain on the deployed D1 revision. First product promotion requires frozen-source reconciliation, committed native import evidence and coordinated Auth/Core deployment through the existing release owner.
