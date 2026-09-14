---
id: space-action-receipt-recovery
title: Preserve saved reply receipts after local expiry
kind: fixed
areas: ["cli", "agents", "spaces"]
audiences: ["users", "integrators"]
---

An Agent retrying the same saved reply after its local context expires can
recover the original receipt. New actions remain blocked after expiry, and
existing records are preserved when their state cannot be verified.

Space Action tools return structured receipts that distinguish a locally saved
proposal, a rejected new action, and an unknown result. A local receipt never
claims that the reply has been accepted or published to the Space.
