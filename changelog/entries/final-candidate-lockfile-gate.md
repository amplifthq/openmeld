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
workflows, install wrappers, project `.npmrc`, package scripts, the Turbo task
graph, or workspace fields that decide which native code may run still refuse
hosted certification and use the documented local explicit bootstrap. That
refuse publishes a required status that names the control drift and the local
explicit bootstrap. The runner job also stays red; the publisher job does not
add a third lookalike product-test failure.
