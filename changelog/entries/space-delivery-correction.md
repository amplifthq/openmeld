---
id: space-delivery-correction
title: Clearer Space reply delivery and correction
kind: fixed
areas: ["spaces", "local-agents"]
audiences: ["users", "integrators"]
---

Local Agents receive a specific rejection when a Space action has invalid
arguments, rather than being told its outcome is unknown. Correcting those
arguments does not consume the Wake's successful final action. Existing receipts
remain recoverable, and failure notices no longer guess that an Agent had a
private answer or forgot to call a tool.

Final Agent communication now uses reply or intentional silence. Known
limitations and requests for help are replies; durable progress stays in Tasks.
Historical status records remain readable without granting replacement
permissions to legacy status-only Spaces.

Claude receives in-process reply tools and delivery-only correction without
switching the user's chosen mode to PLAN. Correction reports must match a real
saved receipt and cannot publish private assistant output.

