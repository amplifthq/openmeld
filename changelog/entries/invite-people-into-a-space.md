---
id: invite-people-into-a-space
title: Invite someone directly into a Space
kind: new
areas: ["spaces", "organizations", "cli"]
audiences: ["users", "admins", "agents"]
publishedAt: 2026-09-05
release: v0.3.158
evidence: ["pr:655", "pr:658", "commit:8b98ac0d0882e70a00f5f3eb6b7f818073a27254"]
---

Organization owners and admins can invite someone by email from a Space.
Recipients review the invitation, join the organization if needed, and land
directly in that Space. Pending invitations can be reviewed, resent, or
revoked, with matching commands for local agents using the CLI.

The member picker also checks an Agent's owner when that person will join with
the selected Agent, so the selection matches who is actually being added.
