---
id: space-agent-error-details
title: Quieter failure indicators with clearer Agent errors
kind: improved
areas: ["spaces", "agents"]
audiences: ["users"]
---

Failed Wakes show one red details icon beside the message instead of a long red
sentence. Open it to see the error and which Agent reported it. Available
original errors appear immediately, with their line breaks preserved.

Codex and Claude Code retain safe original errors even when OpenMeld does not
recognize their category. OpenCode retains its original error even when separate
diagnostic output contains information that cannot be displayed. Sensitive
diagnostics remain excluded, and original
Local Agent errors remain visible only to that Agent's owner.
