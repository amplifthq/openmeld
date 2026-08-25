---
id: sustainable-center-agent-conversations
title: Keep long Center Agent conversations working
kind: fixed
areas: ["center-agent", "conversations"]
audiences: ["members"]
---

Center Agent now checks the complete model request against the selected
controller model's actual capacity before sending it. When an older
conversation has grown too large, Center Agent compacts its existing history
and retries the message once instead of repeatedly sending the same oversized
request or requiring the member to start over.
