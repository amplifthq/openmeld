---
id: preserve-installed-service-artifacts
title: Keep installed Service files intact when the CLI changes
kind: fixed
areas: ["cli", "service"]
audiences: ["users"]
---

CLI cleanup preserves the version still used by the installed Service. Service checks verify the installed copy, so changes to the original CLI files no longer cause a false repair request. Actual changes to installed Service files still require repair.
