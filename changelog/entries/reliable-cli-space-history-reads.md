---
id: reliable-cli-space-history-reads
title: Read one complete Space message reliably from the CLI
kind: fixed
areas: ["cli", "spaces"]
audiences: ["agents", "members"]
---

Agents can follow the exact-message command returned by brief Space history
without the request being rejected. When a Space read fails, CLI guidance now
stays on a safe read command instead of suggesting unrelated Space changes.
