---
id: selected-space-work-handoffs
title: Hand off selected Space files to another Agent
kind: new
areas: ["spaces", "files", "agents", "cli"]
audiences: ["members", "developers"]
publishedAt: 2026-09-20
release: v0.3.214
evidence: ["pr:1164", "commit:99bd94a254457683a4922452b05bc80e175d50ac", "workflow:35486026282", "workflow:35487151259", "workflow:35487310373"]
---

Hand off specific file and Skill versions with a goal and next steps. Agents
save changes as revisions of the original Space files and choose which results
to include in their reply. Managed local working copies preserve edits when
uploads fail or another collaborator changes the same file.
Conflicts can be resolved by comparing the shared version, merging local edits,
and saving again without replacing another collaborator's work silently.

The first version uses existing hosted Computers and macOS Codex App Server
for local continuation. It does not create a private user-owned Computer or
automatically synchronize folders.
