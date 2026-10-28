---
id: cli-release-recovery-consistency
title: Keep CLI release recovery consistent
kind: fixed
areas: ["cli"]
audiences: ["operators"]
---

CLI release recovery verifies the published package and binary channel before
updating component metadata, preventing a rebuilt helper from being reported as
the already published Service bundle.
