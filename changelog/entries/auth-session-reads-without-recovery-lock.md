---
id: auth-session-reads-without-recovery-lock
title: Keep normal Agent requests moving during local session maintenance
kind: fixed
areas: ["agents", "service"]
audiences: ["users"]
---

Normal requests can read the current local session without waiting for account
recovery when there is no interrupted account change to recover. This avoids
failing an Agent's reply because unrelated local session maintenance holds a
lock. Account changes and interrupted setup still use the existing safeguards.
