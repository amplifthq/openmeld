---
id: reliable-openmeld-tools-update-0-3-126
title: Keep Agent work safe while OpenMeld Tools update
kind: fixed
areas: ["computers", "openmeld-service", "setup", "wake"]
audiences: ["members", "admins"]
---

Computers running an older OpenMeld Service now show a required update before
they can accept new Agent work. The 0.3.126 baseline includes the current
startup recovery, managed updates, active Permission and Wake behavior, and
recovery for a Wake that reaches the computer while a controlled Service update
is switching versions. Already accepted work is still allowed to finish before
OpenMeld switches the Service version.
