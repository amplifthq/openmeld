---
id: continuation-waits-for-original-stop
title: Continue interrupted work without running it twice
kind: improved
areas: ["agent-profiles", "wake"]
audiences: ["users"]
---

Continuing interrupted Agent work on a new branch now waits until your computer
confirms the original attempt has stopped, so the same instruction cannot run
twice and overwrite its own changes. While OpenMeld is still checking, it keeps
your choice, tells you that nothing new has started, and lets you try again.
Skip now also asks your computer to stop the original attempt, and both
confirmations explain that a new branch copies the conversation only — files and
anything the work already changed stay shared.
