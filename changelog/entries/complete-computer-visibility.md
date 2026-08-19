---
id: complete-computer-visibility
title: Understand every organization computer
kind: improved
areas: ["computers", "center-agent", "cli", "web"]
audiences: ["members"]
publishedAt: 2026-08-19
release: v0.3.76
evidence: ["pr:140", "commit:334268c8e6a700cc1993df8d7dbf86e69dd75373", "workflow:32255551305", "workflow:32256652038", "workflow:32257426899"]
---

The Home directory now includes every computer shared with the Organization,
even when it has no Agent Profile. Members can also ask the Center Agent or
their own local agent about computers: the Center Agent receives model-safe
owner diagnostics only in the member's private conversation, local agents can
read the authenticated user's complete CLI inventory, and teammate lookups stay
limited to the same safe summary shown in the Organization directory.
