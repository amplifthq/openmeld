---
id: simpler-release-execution
title: Release with fewer manual handoffs
kind: improved
areas: ["developer-workflow"]
audiences: ["contributors"]
---

The existing deployment command can use the local environment or GitHub with
`--lane github`. CLI publication runs through GitHub and continues automatically;
completed components are skipped when a release resumes.

Desktop candidates build and upload in one job. Promotion reuses the verified
published candidate without a second installer download and native inspection.
Publication tools no longer restore the full workspace dependency cache.
