---
id: agent-native-final-candidate-delivery
title: Validate one final candidate without blocking every push
kind: improved
areas: ["engineering", "delivery", "github"]
audiences: ["contributors", "operators"]
---

Coding agents can now iterate and push freely, then request one exact,
risk-based Final Candidate check when a pull request is ready. The same
inspectable validation and shared evidence work locally when GitHub Actions is
unavailable, while production releases remain scoped and available through
either the hosted or guarded local lane. Both release lanes now use the same
cross-machine component lease, so another computer cannot overlap the same
production scope.
