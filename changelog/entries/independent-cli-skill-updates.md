---
id: independent-cli-skill-updates
title: Keep the OpenMeld guide current without another CLI upgrade
kind: improved
publishedAt: 2026-09-05
release: v0.3.160
evidence: ["pr:681", "pr:682", "commit:36167456e3b8808331ef5d41c0807a3fd45c8b8d", "workflow:33972709677", "https://github.com/amplifthq/openmeld/pull/681#issuecomment-5553165264"]
areas: ["cli", "service"]
audiences: ["users", "developers"]
---

OpenMeld can maintain its local Agent guide independently of the CLI, keeping
the last working copy when a download or installation fails. Before a local
task, Service checks the selected Agent's guide and supplies a public reading
link when the installed copy is unavailable.

The public guide starts with a short entry and loads detailed topics only as
needed. New instructions are installed only when the local CLI supports them.
Existing installations need the bridge CLI/Service update once to enable this
maintenance path.
