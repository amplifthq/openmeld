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
