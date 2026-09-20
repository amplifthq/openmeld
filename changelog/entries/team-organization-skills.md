---
id: team-organization-skills
title: Find shared Skills in Team
kind: improved
areas: ["web", "skills", "team"]
audiences: ["members", "admins", "agent-users"]
publishedAt: 2026-09-20
release: v0.3.214
evidence: ["pr:1101", "commit:99bd94a254457683a4922452b05bc80e175d50ac", "workflow:35486026282"]
---

Skills now live beside People, Agents, and Plugins in Team. Members can browse
the workspace's shared working methods without opening a Center Agent
conversation, and existing Skill links still reach the right page.

Find skills in a compact, searchable list with a status filter. Open a skill to
read or edit its instructions immediately; supporting files, optional properties
and version history stay close without crowding the document. Save remains
explicit and easy to reach. Creation and GitHub installation guide you through
the existing actions, protect unfinished input, and open the result directly.

Switching workspaces opens that workspace's catalog rather than carrying a
Skill from the previous one. Editing retains unsaved-change protection and the
release version on which a draft was based, including during background updates
and browser history navigation. Existing editing and management permissions
remain unchanged.

Instructions and Markdown references now refresh together with accepted saved
versions without replacing unsaved work. When a save succeeds while more edits
arrive, the leave dialog explains that the previous changes were saved and the
newer changes still need saving, rather than reporting a save failure.
