---
id: consistent-center-agent-avatar-colors
title: Consistent Agent avatars in Spaces
kind: fixed
areas: ["center-agent", "settings", "spaces"]
audiences: ["users", "admins"]
publishedAt: 2026-10-09
release: v0.3.250
evidence: ["pr:1610","commit:2de34997f690f3c6bc87c396a2a40e040a96051c","deployment:openmeld-web-prod/105bd493-2203-4b23-bafe-100ed7fd4e76"]
---

The Center Agent avatar preview now matches its colors in Spaces. Avatars that
use Appearance colors no longer show Original as a saved choice. Selecting
Original saves that color choice for the Agent. Appearance also retains its
Original and Balanced color selections.

New Agent Direct Messages now show the current Agent avatar in the sidebar as
soon as the conversation opens. Remote Agents use the selected model provider's
logo without waiting for a later directory refresh.
