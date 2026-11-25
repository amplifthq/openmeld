---
id: final-candidate-request-and-wait
title: Follow the correct Final Candidate run through publication
kind: fixed
areas: ["ci"]
audiences: ["contributors"]
---

Final Candidate waits follow the requested pull request and commit through
result publication. While polling, they read each failed job's annotations
once per run attempt. Concurrent requests check which confidence label took
effect. The merge queue verifies its base against protected main, and the
result verifier uses the Git objects already pinned for the run.
