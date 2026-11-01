---
id: openclaw-space-session-ownership
title: Keep OpenClaw Space sessions tied to their own Space
kind: fixed
areas: ["cli", "spaces"]
audiences: ["members", "operators"]
---

OpenClaw-backed Spaces now key and recognize their Agent Controller sessions
by the complete Space id instead of an eight-character prefix, so a Wake can
no longer resume a different Space's session when two Space ids begin alike,
and short Space ids no longer collapse onto one shared placeholder key. A
session stored under the earlier prefix form is treated as legacy, so each
Space derives its own session key on its next Wake.
