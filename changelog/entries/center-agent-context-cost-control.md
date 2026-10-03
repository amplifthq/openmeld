---
id: center-agent-context-cost-control
title: Lower context overhead in long Center Agent conversations
kind: improved
areas: ["center-agent", "usage"]
audiences: ["users", "admins"]
publishedAt: 2026-10-03
release: v0.3.237
evidence: ["pr:1453", "commit:a34b1544f955570b2b320fa79801e96ffa3e9443", "workflow:37044018284", "commit:804c71e113016556a8d1bfbb95e3d2faa2f2eb89"]
---

Center Agent compacts long conversations earlier for reviewed models with higher
long-prompt prices, without changing the model you selected. Large tool results
use shorter previews with permission-checked access to retained details. The
usage ledger separately identifies compaction costs while Usage totals remain
compatible with existing clients.
