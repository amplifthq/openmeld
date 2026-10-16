---
id: computer-preparation-stage-timing
title: See where Computer preparation spends time
kind: improved
areas: ["computer", "diagnostics"]
audiences: ["operators", "contributors"]
publishedAt: 2026-10-13
evidence: ["pr:1707", "commit:9213ea6b5544d5309c9d6872dd2bc85f9b56b35a", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40"]
---

Computer preparation logs now report each synchronization block's elapsed
stages and transfer counts. Operators can investigate long preparation without
clearing files or restarting commands. The logs keep file contents, paths and
commands private, and do not treat elapsed time as CPU usage.
