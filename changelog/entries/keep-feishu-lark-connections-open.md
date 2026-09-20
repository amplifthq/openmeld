---
id: keep-feishu-lark-connections-open
title: Keep Feishu and Lark connections open after setup
kind: fixed
areas: ["channels", "center-agent"]
audiences: ["users"]
---

Feishu and Lark connections no longer disconnect when the initial connection
timeout expires after setup has already succeeded. Connected bots can keep
receiving messages without repeatedly reconnecting.
