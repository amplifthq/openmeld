---
id: docs-development-foundation
title: Develop and release the documentation site independently
kind: new
areas: ["documentation", "development"]
audiences: ["contributors", "operators"]
publishedAt: 2026-10-06
evidence: ["pr:1543", "commit:ba042bf55c7ea2ce6911d813aa6b482bdf9d14fe", "workflow:37489038522"]
---

Contributors can preview the Fumadocs template in its own workspace.
Docs has separate Cloudflare environments, artifact checks, and a guarded
release scope. Documentation changes can ship independently of the Website
and Web App. The initial pages are template examples. Product content follows
in a separate change.
