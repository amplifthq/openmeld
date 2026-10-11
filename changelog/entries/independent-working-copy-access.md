---
id: independent-working-copy-access
title: Keep Agent capabilities when choosing a separate working copy
kind: improved
areas: ["spaces", "agents", "cli"]
audiences: ["members", "operators"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:8f3ceab1f053cafe6425631f78453e0828e9944a", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800", "workflow:38077171997"]
---

Choose a separate working copy without adding extra restrictions to your Agent's
tools or permitted network access. Working copy and Access are separate choices
in the Agent menu, and CLI Project selection keeps Agent settings by default.
Choose Session → Automatic to clear those task choices and return to automatic
continuation. An existing session keeps its own restrictions.

OpenMeld manages the copy and retains unfinished changes. Computer file policies,
native approvals, and explicitly restricted tasks continue to apply. Forking an
independent task keeps its separate-copy mode.
