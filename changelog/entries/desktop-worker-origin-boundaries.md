---
id: desktop-worker-origin-boundaries
title: Fix Web entry and private Desktop sidebar saves
kind: fixed
areas: ["web", "desktop", "api"]
audiences: ["developers"]
---

Organization entry can use the Worker runtime's fetch function without an
invalid receiver error. The shared transport preserves caller-bound fetch
functions and its existing cancellation and error behavior.

The private Desktop pilot's exact development origin can save sidebar ordering
through Auth's existing cookie-write guard. Production and untrusted origins
remain rejected. Account Space history still owns pin state; sidebar preferences
own grouping and order.

Native acceptance of the corrected candidate is pending. No package or release
is published by this change.
