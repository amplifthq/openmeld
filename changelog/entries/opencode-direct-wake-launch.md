---
id: opencode-direct-wake-launch
title: Start OpenCode tasks without a redundant version check
kind: fixed
areas: ["agents"]
audiences: ["users"]
---

OpenCode Wakes no longer run an extra version check before starting each task.
This avoids reporting a broken setup when that check is slow on a busy computer.
Program-file checks, permissions, and actual startup errors remain enforced.

Concurrent Agent cleanup also shares unfinished process checks instead of
starting overlapping checks when the computer is busy.
