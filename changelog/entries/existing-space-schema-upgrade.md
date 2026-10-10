---
id: existing-space-schema-upgrade
title: Keep existing Spaces readable after an update
kind: fixed
areas: ["spaces", "releases"]
audiences: ["members", "operators"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["pr:1646", "commit:fc6eb00082a13f7199b419f233f04059014d545e", "workflow:38077852859", "commit:490573c59101b1844b54c136ebaf9bcd4a61175c"]
---

Existing Spaces apply the database upgrade for deleted Space history when they
next open. Their members, settings, and messages remain available. Repeated
starts preserve the saved history and deletion state.
