---
id: leaner-release-preparation
title: Reduce repeated work when preparing releases
kind: improved
areas: ["developer-workflow"]
audiences: ["contributors", "operators"]
---

Documentation-only Final Candidate runs install root tooling without installing
the full application workspace or rebuilding native dependencies. The same
documentation and Changelog checks still run.

Release guidance selects the Core/CLI path and Desktop build lane before costly
work starts, and accepts an already verified Core activation after Windows
preview publication without requiring another deployment.
