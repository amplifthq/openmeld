---
id: people-lightweight-agent-configuration
title: Load People and Agent card configuration without runtime checks
kind: improved
areas: ["web", "people", "agents"]
audiences: ["users", "admins"]
---

People and member profile popovers load Agent Controller and model configuration
alongside identity data, without requesting organization-wide Agent runtime
checks. Configuration changes refresh the summaries, and unavailable model
information is kept distinct from the default model. Wake availability continues
to use its existing authoritative checks.
