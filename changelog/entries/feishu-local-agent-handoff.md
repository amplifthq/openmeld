---
id: feishu-local-agent-handoff
title: Get Local Agent results in the original Feishu topic
kind: fixed
areas: ["channels", "center-agent"]
audiences: ["users"]
publishedAt: 2026-11-04
evidence: ["pr:380","commit:7623fa2e631caf6f75201bdefea1b9e539aad080","workflow:41844610834"]
---

A Center Agent can now hand a Feishu request to your Local Agent in an authorized Space and return the result to the original topic. When it waits for all delegated work to finish, it updates the existing reply card with the outcome.
