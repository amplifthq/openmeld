---
id: stop-accepted-wake-publication
title: Stop a Wake while its reply is waiting to publish
kind: fixed
areas: ["spaces", "wake"]
audiences: ["users"]
---

Stop can finish a Wake whose local work is complete but whose reply has not
published, even when the original computer is offline. Space keeps Stop
available in this stage without requiring a fresh computer capability report.
A stopped notice and a
concurrent reply cannot both become the final outcome. Interrupted publication
remains retryable, including older Wakes with a recoverable accepted result.
