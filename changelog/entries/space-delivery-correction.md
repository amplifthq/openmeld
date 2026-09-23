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

Large Space history, shared-file and Task-list results can be read in pages
through the same tools, without a shell or access to a local spill file.

Codex can use direct native Space tools while retaining the MCP path for older
controllers or native approval policies. Each run exposes one reply interface;
resumed and forked conversations use the current Wake's authority, and an
unconfirmed submission is not replayed through a different interface.

Delivery correction keeps the user's selected mode and runs only where the
controller can enforce a restricted operation scope. Claude, Codex, OpenCode
and OpenClaw have native correction paths with explicit permission and receipt
checks. Grok Build can correct delivery in a separate native session with only
final tools, preserving native approvals and blocking file-backed tool inputs. OpenClaw also uses the common paged reads and correctable tool errors.
Current Cursor ACP and Antigravity CLI paths stop safely when a final
action is missing, rather than rerunning business work with full capabilities.
Their normal reply tools remain available. This is not a promise of automatic
correction on every controller or version.

