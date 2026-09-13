---
id: preserve-installed-service-artifacts
title: Keep installed Service files intact when the CLI changes
kind: fixed
areas: ["cli", "service"]
audiences: ["users"]
---

CLI cleanup preserves the version still used by the installed Service. Service checks verify the installed copy, so changes to the original CLI files no longer cause a false repair request. Actual changes to installed Service files still require repair.

When a release selects a separate Service version, binary setup installs the correct CLI and Service artifacts, and Computer details report their installed versions separately. Updating only the CLI keeps the selected Service running.
