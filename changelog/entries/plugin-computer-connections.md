---
id: plugin-computer-connections
title: Reuse Plugin accounts from Computer
kind: improved
areas: ["plugins", "computer", "agents"]
audiences: ["users", "developers"]
---

Agents can reuse a connected personal or shared Plugin account for supported
native HTTP reads on your cloud Computer. Provider credentials stay on the
server, and each request checks the account's current Agent access. Cloudflare
Workers supports bounded runtime-log and invocation-metric queries, plus
deployment and version reads.

Plugin discovery and settings now distinguish expired authorization from a
stored account. When reconnection is needed, reconnect the same account in
Plugins instead of signing in again on the Computer.

Agents now receive guidance to reuse project repositories and create separate
Git worktrees for concurrent changes. Computer capability checks report
persistent storage usage and near-limit guidance before large downloads or
builds. Capacity errors explain how to preserve files and inspect the failure
without blindly repeating a command.
