---
id: remote-agent-preparation-admission
title: Avoid a false task-start failure
kind: fixed
areas: ["agents"]
audiences: ["members"]
---

Remote Agents confirm their accepted execution before preparing Computer access,
preventing a newly started task from being mistaken for an inactive execution.
Stop requests and current access checks still apply during preparation.
A temporary follow-up check failure no longer prevents an already accepted
task from starting.
