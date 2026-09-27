---
id: faster-release-preparation
title: Prepare releases with fewer repeated checks
kind: improved
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Release candidates can include a matching CLI and Service stamp with the source
and compatibility update it describes, so operators do not need a separate PR
just for version metadata. Production status also stops reading older job
histories once newer verified deployment records cover every component.
