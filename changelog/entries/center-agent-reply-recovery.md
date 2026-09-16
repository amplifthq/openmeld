---
id: center-agent-reply-recovery
title: Recover missing Center Agent replies
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["users"]
publishedAt: 2026-09-13
release: v0.3.201
evidence: ["pr:969", "pr:980", "pr:983", "pr:986", "commit:e08cf7a051c497eb2ce3074280ab65484d7b7655", "workflow:34739338298", "workflow:34740351553"]
---

Center Agent retries eligible missing replies automatically without repeating
completed actions. If it still cannot answer, your message stays saved and the
failure is shown clearly. When the original conversation is available, Continue
conversation can prepare a reply from its saved results without running tools or
other actions again.
