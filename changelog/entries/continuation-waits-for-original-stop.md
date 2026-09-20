---
id: continuation-waits-for-original-stop
title: Continue interrupted work without running it twice
kind: improved
areas: ["agent-profiles", "wake"]
audiences: ["users"]
---

Continuing interrupted Agent work on a new branch now waits for your computer to
answer that the original attempt has been withdrawn, instead of starting a
second attempt as soon as the choice is saved. While OpenMeld is still checking,
it keeps your choice, tells you that nothing new has started, and lets you try
again. Skip now also asks your computer to stop the original attempt. Both
confirmations explain that a new branch copies the conversation only: files, and
anything the work already changed, stay shared.
