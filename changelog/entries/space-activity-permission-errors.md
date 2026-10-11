---
id: space-activity-permission-errors
title: Keep Space permission errors clear
kind: fixed
areas: ["web", "spaces"]
audiences: ["members"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:5586c1ba9e455e3986f0ec954a3d596c895de906", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

When a Space denies a visit activity update, OpenMeld now reports a permission
error instead of a service connection failure.
