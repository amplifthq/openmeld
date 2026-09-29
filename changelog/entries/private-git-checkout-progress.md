---
id: private-git-checkout-progress
title: Make progress on larger private Git checkouts
kind: improved
areas: ["center-agent", "github"]
audiences: ["agent-users"]
---

Private Git checkouts now transfer files in bounded parallel batches and return
preparation progress as time runs low. Retried calls reuse the verified
repository tree instead of downloading it again.
