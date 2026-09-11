---
id: people-lightweight-agent-configuration
title: Load People and Agent card configuration without runtime checks
kind: improved
areas: ["web", "people", "agents"]
audiences: ["users", "admins"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

People and member profile popovers load Agent Controller and model configuration
alongside identity data, without requesting organization-wide Agent runtime
checks. Configuration changes refresh the summaries, and unavailable model
information is kept distinct from the default model. Wake availability continues
to use its existing authoritative checks.
