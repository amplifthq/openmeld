---
id: reliable-magic-link-sign-ins
title: Finish magic-link sign-ins reliably
kind: fixed
areas: ["authentication", "web"]
audiences: ["members"]
---

OpenMeld now waits briefly for a newly confirmed session to become available,
so opening a valid magic link does not incorrectly ask someone to request
another link.
