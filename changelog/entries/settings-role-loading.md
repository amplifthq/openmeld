---
id: settings-role-loading
title: Load organization settings without waiting for Agent status
kind: fixed
areas: ["web", "settings"]
audiences: ["users", "admins"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

Organization settings, including Invitations, resolve your member role without
waiting for organization-wide Agent status checks. Slow Agent status reads no
longer delay the role check needed to display invitation controls and requests.
