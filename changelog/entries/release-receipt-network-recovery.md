---
id: release-receipt-network-recovery
title: Recover interrupted release records without repeating completed deployments
kind: fixed
areas: ["releases"]
audiences: ["operators", "contributors"]
publishedAt: 2026-10-17
evidence: ["pr:221", "commit:e0401965d82c65845e9e432c77fe728d5e22d6d4", "release-receipt:8e6b31e288487367caf4e37606279230d6e12cb4", "https://github.com/amplifthq/openmeld/pull/220#issuecomment-6222943692"]
---

Release commands can recognize a saved release record when its network response
is lost. An interrupted Worker upload can continue under the original release
attempt only after the command verifies that production still runs the exact
previous deployment. A changed or unverified deployment continues to block retry.
