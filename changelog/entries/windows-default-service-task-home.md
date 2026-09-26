---
id: windows-default-service-task-home
title: Complete Windows Service setup without a custom home directory
kind: fixed
areas: ["cli", "setup", "windows"]
audiences: ["users"]
---

Windows computer setup can start its background Service when installed in the
normal user directory. New tasks record that directory explicitly; tasks
created by the earlier Windows preview remain eligible for guarded repair
without deleting the computer's local state.
