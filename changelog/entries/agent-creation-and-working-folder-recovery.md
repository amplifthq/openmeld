---
id: agent-creation-and-working-folder-recovery
title: Open newly created Agents without waiting for background refreshes
kind: fixed
areas: ["agents", "web"]
audiences: ["users"]
---

After an Agent is created, its details open without waiting for background
directory and availability refreshes. Those refreshes still run so the Agent
appears in selection lists.

Working folder settings can save the displayed choice even when it has not
changed, allowing you to apply the configuration again when the local folder
has not been initialized. Changes remain unavailable while the Agent is working.

Reopening Working folder loads the saved folder choice from the Agent's
Computer. Changing that Computer while settings are open keeps your draft and
asks you to reopen settings before saving. Folder paths retain meaningful
spaces and Unicode characters.

Folder errors now open Working folder settings from both Profile and Space
recovery. Missing or stale local-agent reports lead to Computer status rather
than another connection flow.

Update Local Agent opens the affected Profile so its bound Computer and Agent
remain available. Computer status actions still open Computer settings.

Newly imported local conversations keep the folder observed during import.
If that folder disappears, settings explain how to restore the original worktree
or choose a folder for new work. OpenMeld does not replace the saved folder
automatically, and a later manual choice survives import retries.
