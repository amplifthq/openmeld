---
id: relevant-center-agent-actions
title: Keep Center Agent actions relevant
kind: fixed
areas: ["center-agent", "navigation", "web"]
audiences: ["members"]
publishedAt: 2026-08-27
evidence: ["pr:369", "commit:6d1375c8b9f80fe58f65d8f4fb4b06454fccb305", "workflow:33061998100", "workflow:33062520467"]
---

Center Agent replies no longer show an unrelated Computer setup, Space, or
Project button merely because the agent checked one of those resources while
working. An action appears only when opening that destination is the useful
next step for the current request.
