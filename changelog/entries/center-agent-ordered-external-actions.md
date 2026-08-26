---
id: center-agent-ordered-external-actions
title: Complete multi-step external actions in order
kind: fixed
areas: ["center-agent", "channels"]
audiences: ["members"]
---

Center Agent can now carry out requests with multiple external writes in order,
while keeping every step independently safe to retry. This includes posting
multiple distinct messages to the same Slack destination in one task and
reporting partial outcomes precisely if a later step fails or remains unknown.
