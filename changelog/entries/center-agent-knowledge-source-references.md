---
id: center-agent-knowledge-source-references
title: Trace Center Agent guidance to its current source
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
publishedAt: 2026-10-29
evidence:
  - "pr:335"
  - "commit:118d473bf33805b0fc4541d2780d2392f3d116b4"
  - "workflow:40878018633"
  - "workflow:40879073266"
  - "workflow:40883355215"
---

The Center Agent can reread a Space's current Guide and identify the returned
content version. Guide snapshots, published Organization Documents, pending
drafts, and historical memory remain distinct sources. Current Brief and document
reads include references to their actual published content, while draft-only
content and identities stay out of automatic context.
