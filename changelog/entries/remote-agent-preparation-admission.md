---
id: remote-agent-preparation-admission
title: Avoid a false task-start failure
publishedAt: 2026-10-02
release: v0.3.236
evidence: ["pr:1442","commit:7eba5b84b75cd655b508a8f3cf5959281a11eab3","workflow:37023562187","workflow:37026574132"]
kind: fixed
areas: ["agents"]
audiences: ["members"]
---

Remote Agents confirm their accepted execution before preparing Computer access,
preventing a newly started task from being mistaken for an inactive execution.
Stop requests and current access checks still apply during preparation.
A temporary follow-up check failure no longer prevents an already accepted
task from starting.
