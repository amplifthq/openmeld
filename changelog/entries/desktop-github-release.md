---
id: desktop-github-release
title: Release macOS Desktop candidates through GitHub
kind: improved
areas: ["desktop", "releases"]
audiences: ["contributors", "operators"]
---

Release operators can choose GitHub Actions or the local Mac release lane.
Both use the same signing identity, notarization, and candidate checks. After
installed acceptance, a separate action promotes the reviewed signed files
without rebuilding them or changing the existing update channel contract.
