---
id: release-contract-receiver-evidence
title: Check each receiver contract before a production release
kind: fixed
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Production release checks require evidence for every changed receiver contract.
An unchanged AI usage receiver can be verified from its recorded deployment
source, while other pending contracts still require their own evidence or a
receiver deployment. This prevents one compatible contract from admitting
unverified changes between the same services.

Center Agent working-folder updates require the new Core receiver to deploy
before their Remote caller. Unrelated AI usage evidence cannot admit these
updates while that receiver is still pending.

Agent setup and folder recovery also wait for their Database, Auth, Core and
Gateway receivers. Cloud command references and detailed lists require Core
and Remote Agent before Gateway exposes them, then Gateway before the CLI.
The checks apply to caller-only changes and reject unavailable source evidence.

Saved working-folder reads require Core before the new Service registration,
Core's read methods before Gateway, and Gateway's GET routes before Web.
Other folder or runtime evidence cannot substitute for this read contract.
