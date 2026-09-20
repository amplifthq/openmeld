---
id: progressive-loading-agent-dashboard
title: Clearer page loading and Agent usage at a glance
kind: improved
areas: ["web", "desktop", "agents", "computers"]
audiences: ["users"]
publishedAt: 2026-09-20
release: v0.3.214
evidence: ["pr:1161", "commit:99bd94a254457683a4922452b05bc80e175d50ac", "workflow:35486026282", "commit:7fd7cd5faca0f24826471a336374235a9507734d", "artifact:desktop-d266d57edbd064073263c2226c8d436bb1b577c42416430ab8af08c8c0adf77f"]
---

Agent pages retain navigation while their content loads, with placeholders
matching the sections being fetched. Provider usage appears beside Agent
configuration cards, using the familiar quota ring and clear reset information.

Computer inventory no longer waits for a duplicate routing-preference request.
Other independent sections, including channel connections and personal Computer
lists, can appear without waiting for unrelated data. Settings, histories, and
lazy Space panels use local placeholders rather than bare loading text. Unknown
preferences no longer appear as saved defaults while their values are loading.
