---
id: agent-native-final-candidate-delivery
title: Validate one final candidate without blocking every push
kind: improved
areas: ["engineering", "delivery", "github"]
audiences: ["contributors", "operators"]
---

Coding agents can now iterate and push freely, then request one exact,
risk-based hosted Final Candidate check when a pull request is ready. Compact
terminal progress keeps successful test logs out of agent context, while the
complete redacted logs remain available in the shared evidence artifact. The
same inspectable validation and shared evidence work locally as a fallback when
GitHub Actions is unavailable. Trusted current-main control remains separate
from untrusted candidate code before package configuration or validation can
run, and an explicit recorded bootstrap covers intentional delivery control
changes. Each responsible agent can use those transparent facts to complete its
own review, merge, release, and smoke path; CI/CD does not appoint a central
coordinator, require another Agent reviewer, or freeze unrelated work.
When a real dependency does require coordination, coding agents can use the
callback transport available in their environment without making Codex App or
any other vendor-specific tool mandatory.
Production releases remain scoped and available through either the hosted or
guarded local lane. Both release lanes use the same authenticated cross-machine
component lease, while historical release sources use current trusted release
controls so exact-SHA recovery remains available.
