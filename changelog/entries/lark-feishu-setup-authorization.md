---
id: lark-feishu-setup-authorization
title: Clear authorization steps for Lark and Feishu
kind: fixed
areas: ["channels"]
audiences: ["admins"]
---

New Lark and Feishu connections request the app-configuration permission during
initial setup. Existing connections missing this permission show Authorization
required and a Reauthorize button that opens consent for the existing bot.
OpenMeld finishes configuration after approval. Managers can cancel unfinished
setup, and expired requests no longer leave a Channel stuck on Connecting.
