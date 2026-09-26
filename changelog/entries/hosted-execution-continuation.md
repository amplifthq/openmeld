---
id: hosted-execution-continuation
title: Continue connected tasks and read longer Agent results
kind: improved
areas: ["plugins", "center-agent", "remote-agents"]
audiences: ["users", "admins"]
---

Hosted Space replies can offer an explicit continuation after Plugin setup,
keeping the original requester, Agent and Thread. Setup itself does not start
work or grant Agent permissions. Older clients retain an ordinary connection
link instead of receiving an unsupported message action. The selected account is
kept throughout execution, and edited or recalled original requests cannot
silently resume through an old connection card.

Local Agent replies can now offer the same connection card through
`plugins connect`. Slack, Feishu and Lark can privately guide the original
requester to the same secure setup and explicitly continue in the original
channel. Duplicate clicks keep one delivery, changed original requests are
refused, and successive Plugin setups keep each selected account separate.

Hosted Computers separate admitted conversation audiences. Large received
tool results can be read or searched through bounded, expiring references under
current access checks, including results inside Code Mode. Reading more output
does not rerun the original tool or repeat a completed write. Private source
checks survive runtime conversation rollover and apply to retained output too.
Revoked results are withheld rather than returned as excerpts; long shell and
Code Mode logs preserve their received middle content before display shortening.

Hosted Agents can prepare a private GitHub snapshot working copy, edit and test
with the existing Computer, and publish its exact tree to a dedicated task
branch through the selected Plugin connection. Credentials remain in the
connection service. Publication checks current access and reconciles uncertain
outcomes rather than force-pushing or repeating a completed update. Full Git
history, LFS data and submodule repositories are not part of the snapshot. An independently
verified default-branch snapshot supplies the baseline for build checks without
turning candidate code into its own trust source. Known size-limit failures are
rejected before claiming a provider write.
