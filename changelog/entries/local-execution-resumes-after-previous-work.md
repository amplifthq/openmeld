---
id: local-execution-resumes-after-previous-work
title: Resume local work when the previous session's agents finish
kind: fixed
areas: ["service", "agents"]
audiences: ["users", "operators"]
---

When OpenMeld Service restarts while local agent work from its previous session
is still finishing, this computer now accepts new tasks again automatically once
that work ends, instead of staying paused until a restart. Work that OpenMeld
cannot confirm has stopped still requires restarting the computer, and the
Service log now records why local execution is paused.
