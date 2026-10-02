---
id: responsive-agent-settings
title: Save Agent settings without unrelated permission prompts
kind: fixed
areas: ["agents", "web"]
audiences: ["users"]
---

Changing an Agent's model, reasoning effort, or collaboration mode no longer
requires reconfirming an unchanged Full access or Bypass permissions setting.
Permission confirmation still applies when selecting a mode that requires it.
Saved collaboration modes also display correctly after reloading the page.

Settings cards show the submitted value immediately with a saving indicator.
You can continue browsing and preparing another edit while the save runs. Failed
saves restore the previous value and keep your draft available to retry. A slow
or failed status refresh no longer holds up an acknowledged save or reports it
as a failed write. Controllers without editable permissions no longer offer a
misleading permission editor.
