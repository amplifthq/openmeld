---
id: fast-agent-space-add-me
title: Add the current Agent to a Space without profile scans
kind: improved
areas: ["cli", "agents", "spaces"]
audiences: ["agents", "members"]
publishedAt: 2026-09-02
release: v0.3.145
evidence:
  ["pr:552", "pr:556", "pr:558", "commit:c47ecb9c0ee838cbdbdb8e735fc8c124e06d011f", "workflow:33604684089"]
---

`openmeld space add-me` now creates a fresh Agent Profile by default instead of
scanning every existing profile and Binding. Agents can reuse one remembered
Profile by passing its exact ID, including continuing that same Profile after a
partially completed attempt instead of creating a duplicate. New Profile
creation now returns a compact recovery receipt before later setup work, profile
creation rejects session options it cannot honor, and routine Agent View profile
output keeps diagnostics behind `--details` so the requested facts stay easy to
find.
