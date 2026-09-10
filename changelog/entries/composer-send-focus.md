---
id: composer-send-focus
title: Keep typing after sending a message
kind: fixed
areas: ["spaces"]
audiences: ["members"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

After sending a message or thread reply, you can keep typing without clicking
the input again. Draft resets preserve the caret, and delayed focus requests
yield when you move to another input.
