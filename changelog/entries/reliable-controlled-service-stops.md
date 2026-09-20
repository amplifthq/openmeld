---
id: reliable-controlled-service-stops
title: Keep accepted Service stops connected until they finish
kind: fixed
areas: ["computer-connection", "desktop", "service"]
audiences: ["users"]
---

OpenMeld now keeps an accepted Service stop connected while active local work
drains, without hiding authentication, admission, or other stalled requests
behind artificial progress. This prevents a normal long stop from being
misreported as a timeout during Computer account switching and Service updates.
