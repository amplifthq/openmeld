---
id: connector-gateway-upgrade
title: Updated connector management and provider actions
kind: improved
areas: ["apps", "integrations"]
audiences: ["admins", "integrators"]
publishedAt: 2026-10-09
evidence: ["pr:1612", "https://github.com/amplifthq/open-connector/pull/24", "deployment:openmeld-open-connector-prod/0cb2a7cd-19bf-40a1-aef9-b7a81169af45", "smoke:openconnector-run/ab51cbbf-4446-4dda-a80d-2adb0a2f2d1d"]
---

The connector gateway adds updated provider actions, authorization request management,
and event subscription management. Existing OpenMeld account selection and default
read-only Google access are preserved. Managed cloud authorization is optional and
requires separate configuration.
