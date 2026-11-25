---
id: routine-mention-publication-recovery
title: Keep Routine reports from failing on teammate mentions
kind: fixed
areas: ["routines", "spaces", "center-agent"]
audiences: ["users"]
---

Agents validate report recipients before preparing their final reply. Reports can
mention a teammate who belongs to the Organization but has not joined the Space,
with a distinct identity label and a minimal notification that does not expose
the report or grant access.

Invalid mention targets now produce a specific failure instead of repeatedly
retrying the same rejected report. Routine history keeps the safe explanation,
and a retry of the failure notice does not restart the original work.
