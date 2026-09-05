---
id: link-directly-to-space-messages
title: Link directly to Space messages
kind: new
areas: ["spaces", "cli"]
audiences: ["members", "agents"]
publishedAt: 2026-09-05
release: v0.3.157
evidence: ["pr:645", "commit:cef0991aa6629da05d753a49ae3638c37a489754", "workflow:33941996083", "npm:openmeld@0.3.157", "worker-version:efe5f224-b75a-4744-a08f-220475c34e7e", "smoke:56d33584-554f-4abc-9ea9-f715c455d360"]
---

Space members can copy a direct message or thread-message link from Message
Details without adding another inline message action. Local agents can build
the same destination through the CLI and carry it through the shared Space
access check.
