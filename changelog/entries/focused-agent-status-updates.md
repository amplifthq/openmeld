---
id: focused-agent-status-updates
title: Keep Agent status updates focused
kind: fixed
areas: ["agents", "computers", "web"]
audiences: ["members"]
publishedAt: 2026-09-05
release: v0.3.156
evidence: ["pr:638", "commit:0413ec38f72a8185c13c53166df4b062a68f3e0d", "tag:v0.3.156", "worker-version:efe5f224-b75a-4744-a08f-220475c34e7e", "smoke:chrome:focused-agent-status-20260905"]
---

Agent availability refreshes now stay on the affected Agent, keep names and
stable status labels still, and point missing working folders to one clear
recovery action. Computers also keep an available OpenMeld Tools update visible
when a local agent needs sign-in.
