---
id: hosted-wake-admission-recovery
title: Recover interrupted cloud Agent requests
kind: fixed
areas: ["spaces", "center-agent"]
audiences: ["users"]
---

Cloud Agent requests interrupted before execution is confirmed can resume their
original delivery instead of remaining stuck while waiting for a workstation
owner. Recovery continues after queue handoff until cloud admission is confirmed.

Spaces now distinguish sending, waiting to start, connecting, and retrying
delivery from an Agent that is working, including grouped progress and sidebar
activity.
