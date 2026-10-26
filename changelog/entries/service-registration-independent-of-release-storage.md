---
id: service-registration-independent-of-release-storage
title: Keep Service initialization and registration responsive when release storage stalls
kind: fixed
areas: ["local-service", "wake"]
audiences: ["users", "operators"]
---

Slow or stalled release-storage reads no longer hold the Service initialization
or registration gate open. Release policy refreshes in the background while
local connection state is restored and saved. New Wakes still require a valid
release policy, and expired policies cannot be kept in use by a failed refresh.
