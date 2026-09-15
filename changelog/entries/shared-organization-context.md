---
id: shared-organization-context
title: Share Organization entry reads across Web and Desktop
kind: improved
areas: ["desktop", "web", "api"]
audiences: ["developers"]
---

Web and Desktop can read the current account's Organizations and default entry
through one stable, credential-free API. Organization entry and route scope no
longer depend on generated server-function identifiers. Membership checks,
account isolation, and Organization switching preferences retain their existing
owners.

The Auth route must ship before the new consumers. Other Desktop pilot reads
still require matching builds; this change does not remove that restriction.
