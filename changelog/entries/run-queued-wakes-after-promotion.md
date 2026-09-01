---
id: run-queued-wakes-after-promotion
title: Run queued Wakes after the previous task finishes
kind: fixed
areas: ["agent-profiles", "wakes"]
audiences: ["members"]
---

Queued Wakes now keep the same dispatch identity when they move to the front of
an Agent Profile's work queue, so they start automatically after the previous
task finishes instead of getting stuck behind a false conflict.
