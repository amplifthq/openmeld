---
id: postgresql-foundation
title: Run OpenMeld on PostgreSQL
kind: new
areas: ["database", "development"]
audiences: ["contributors", "operators"]
publishedAt: 2026-10-04
release: v0.3.241
evidence: ["pr:1460", "commit:d6978e1bec2ce90e27340f075a352ca978402c66", "commit:a2a57cb3fd04b2555575b60ace25a6d6dca315a4", "workflow:37203295108"]
---

OpenMeld now stores shared production data in PlanetScale PostgreSQL 18 through Cloudflare Hyperdrive. The cutover preserves existing accounts, organizations, Projects, Agent Profiles, and Inbox records. Space history and files retain their existing storage owners.

Contributors can run the complete local product on an isolated PostgreSQL database and rehearse D1 imports with synthetic data. The database preserves accounts and messages across restarts. Native migration, permission, concurrency, and recovery checks cover the shared database contracts.

The guarded production migration checks every imported field, the frozen-source write barrier, the native migration journal, and runtime permissions. Operators retain the frozen source and native backup evidence. Scheduled work resumes through an explicit restore action after product acceptance.

After the PostgreSQL cutover is complete, operators can publish the CLI through the existing GitHub Actions workflow and npm Trusted Publishing. Publication requires matching database and live service release evidence. The workflow does not need a local npm login, database migration credentials, or a private data snapshot.
