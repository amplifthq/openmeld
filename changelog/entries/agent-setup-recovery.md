---
id: agent-setup-recovery
title: Recover incomplete Agent setup
kind: fixed
areas: ["agents", "center-agent", "computer"]
audiences: ["members"]
---

Invalid model selections are rejected before an Agent is created. If setup
fails later, you can review the model and retry the same Agent without losing
its original Project or overwriting settings you changed afterward.

Custom and OpenMeld-managed folder changes correctly clear Default Project.
Center Agent setup results keep local folder paths private and show which
steps still need attention.

Missing or unavailable working folders now lead to the affected Agent’s folder
settings. Center Agent can check a Project’s connection on that Agent’s Computer
without receiving local paths.

Cloud commands return their exact receipt reference and execution phase. Owner
inspection can query the original Remote command, and a missing receipt reports
an unknown acceptance state instead of an unreachable service.
If the native execution result is unavailable, the saved receipt remains
available for inspection. This failure is distinct from an unreachable service
and does not restart the command.

Linux commands see new file changes after synchronization, including renames,
deletions, size changes and same-size replacements. Sync retries preserve files
recreated or modified afterward on the receiving Computer.
Applying this native update preserves workspace files and saved command
references. A process interrupted by a container replacement is reported as
unavailable and is not restarted automatically.
