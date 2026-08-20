---
id: message-channel-identity-corrections
title: Correct connected account identity safely
kind: fixed
areas: ["channels", "identity"]
audiences: ["members", "admins"]
---

Members can correct a Slack, Lark, or Feishu account that was connected to the
wrong OpenMeld profile without a recent setup action blocking the change. An
audit failure now rolls the identity change back, and OpenMeld reports a
replacement only when that confirmation actually moved the canonical account
mapping.
