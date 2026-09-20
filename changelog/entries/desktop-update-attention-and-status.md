---
id: desktop-update-attention-and-status
title: Clearer Desktop update status and reminders
kind: fixed
areas: ["desktop", "settings"]
audiences: ["users"]
publishedAt: 2026-09-20
release: v0.3.214
evidence: ["pr:1160", "commit:99bd94a254457683a4922452b05bc80e175d50ac", "commit:7fd7cd5faca0f24826471a336374235a9507734d", "artifact:desktop-d266d57edbd064073263c2226c8d436bb1b577c42416430ab8af08c8c0adf77f"]
---

Desktop update reminders now point from Settings to Updates with matching blue
indicators. The Updates page puts the current result and next action first, and
the compact reminder offers a full-width action with Later at the top right.

Downloads show their actual progress, repeated checks do not revive dismissed
reminders, and errors explain the appropriate recovery step. Download and restart
remain separate choices, with existing draft and installation protections intact.
