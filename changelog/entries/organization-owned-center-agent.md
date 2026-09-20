---
id: organization-owned-center-agent
title: Center Agents belong to their organizations
kind: security
areas: ["center-agent", "organizations", "spaces"]
audiences: ["members", "admins"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

Center Agents belong to their organizations, including Personal Workspaces.
Current organization owners and admins can manage, pause, and resume them.
Removing the person who originally created the agent preserves its identity
and conversations.

Pausing a Center Agent now correctly stops its running tasks. Resuming it allows
new work without restarting cancelled tasks.

A Center Agent's Space membership no longer gives its original creator access
to a private Space. Members keep their own conversations and Space permissions.

Team lists the Center Agent first under Online instead of in a separate group.
Its card labels it as the Center Agent and names its owning organization without
adding height.

This change requires an updated CLI to read organization directories containing
Center Agents.
