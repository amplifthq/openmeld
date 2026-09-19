---
id: release-status-component-evidence
title: Keep release status accurate after partial deployments
kind: fixed
areas: ["development", "releases"]
audiences: ["developers", "agents"]
evidence: ["pr:1156"]
---

Release status now reads paged deployment history and compares actual completion
times. It explains missing or conflicting evidence instead of silently choosing
an older deployment or aborting the whole report. Guarded local releases retain
each component's progress and verified result when a later component fails,
without presenting a partially completed release as successful.

Receipt failures no longer trigger a blind redeployment on retry. Proven applied
work resumes verification; uncertain work stops for reconciliation. Worker
receipts identify the version returned by the guarded deployment rather than
adopting whichever version happens to be running. They also require one uniquely
new platform deployment before recording its ID, so an older or concurrent
same-version deployment cannot be attributed to the guarded command.
