---
id: honest-codex-wake-start-status
title: Show when a Codex Wake actually starts
kind: fixed
areas: ["agents", "spaces", "wake"]
audiences: ["members"]
---

A Codex Wake now stays in its locally accepted state until Codex accepts the
exact provider turn. Process startup, protocol traffic, or another writer
holding the controller conversation no longer makes the Wake look like it is
already Working. When another Codex client is using that task, the Space now
shows `Waiting for Codex task` and a waiting sidebar indicator until the task
becomes available. OpenMeld also keeps one quiet waiter instead of repeatedly
starting Codex processes, and an uncertain resume no longer replaces the
selected Session with a new one.
