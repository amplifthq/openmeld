---
id: desktop-acceptance-computer-lane
title: Check the Computer lane before packaging Desktop acceptance builds
kind: fixed
areas: ["desktop", "development"]
audiences: ["contributors"]
---

Signed Desktop acceptance builds now require the existing test Computer lane
before packaging begins. Missing configuration stops the build with a clear
error instead of producing a notarized app that cannot connect to that Computer.
