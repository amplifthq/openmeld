---
id: windows-default-service-task-home
title: Complete Windows Service setup without a custom home directory
kind: fixed
areas: ["cli", "setup", "windows"]
audiences: ["users"]
---

Windows computer setup can register its background Service and maintenance
task when installed in the normal user directory. Their launch definitions now
carry that directory explicitly, so ownership validation does not reject the
new task before registration.
