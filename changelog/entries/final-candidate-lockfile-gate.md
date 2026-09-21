---
id: final-candidate-lockfile-gate
title: Let ordinary lockfile PRs use hosted Final Candidate
kind: improved
areas: ["engineering", "ci"]
audiences: ["contributors"]
---

Hosted Final Candidate now treats the lockfile as install input, not as a
refuse-to-run control file. Ordinary dependency updates can pass the required
status when the selected checks pass. Changes that rewrite Final Candidate
workflows, install wrappers, package scripts, the Turbo task graph, or
workspace fields that decide which native code may run still refuse hosted
certification and use the documented local explicit bootstrap. That refuse
publishes one honest status instead of three lookalike product-test failures.
