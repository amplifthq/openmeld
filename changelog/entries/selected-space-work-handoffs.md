---
id: selected-space-work-handoffs
title: Hand off selected Space files to another Agent
kind: new
areas: ["spaces", "files", "agents", "cli"]
audiences: ["members", "developers"]
evidence: ["pr:1164"]
---

Hand off specific file and Skill versions with a goal and next steps. Agents
save changes as revisions of the original Space files and choose which results
to include in their reply. Managed local working copies preserve edits when
uploads fail or another collaborator changes the same file.

The first version uses existing hosted Computers and macOS Codex App Server
for local continuation. It does not create a private user-owned Computer or
automatically synchronize folders.
