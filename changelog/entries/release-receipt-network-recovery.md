---
id: release-receipt-network-recovery
title: Recover interrupted release records without repeating completed deployments
kind: fixed
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Release commands can recognize a saved release record when its network response
is lost. An interrupted Worker upload can continue under the original release
attempt only after the command verifies that production still runs the exact
previous deployment. A changed or unverified deployment continues to block retry.
