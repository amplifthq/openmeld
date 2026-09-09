---
id: fix-onboarding-invitation-requests
title: Invite teammates with fewer steps
kind: fixed
areas: ["onboarding", "organizations", "inbox"]
audiences: ["users", "admins"]
publishedAt: 2026-09-08
release: v0.3.174
evidence: ["pr:755", "pr:759", "workflow:34213867447", "https://github.com/amplifthq/openmeld/pull/759#issuecomment-5583540970"]
---

Open Invite people from your avatar menu to send an email invitation or share a
link. The same controls appear first in Invitations settings, with empty review
and acceptance lists hidden.

Links created by owners and admins let verified recipients join directly.
Ordinary members can request invitations; every owner and admin receives an urgent
Inbox item and review email, and one approval is enough. People who request to
join through a link can enter after approval without accepting a second invitation.
Setup now shows the correct Join or Request to join action. New links expire after
30 days; existing request links continue to require approval.
