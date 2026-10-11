---
id: continue-incomplete-production-releases
title: Continue a release without repeating completed deployments
kind: improved
areas: ["releases"]
audiences: ["contributors", "operators"]
---

The existing local release command can continue the remaining components of a
release from their verified deployment records. A completion check reports
missing components instead of treating a successful individual workflow as a
complete release. Desktop publication installs only its release tool dependencies;
candidate builds keep their full build environment.
