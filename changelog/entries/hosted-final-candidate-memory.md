---
id: hosted-final-candidate-memory
title: Final Candidate avoids overlapping memory-heavy checks
kind: improved
areas: ["developer-experience", "ci"]
audiences: ["contributors"]
---

Final Candidate now runs affected workspace checks and unit tests in separate
phases. Packages still share safe parallelism within each phase, while large
packages no longer run type-checking and unit tests at the same time on one
hosted runner and fail with an out-of-memory error after otherwise healthy
tests. The isolated runner also gives large Node checks an explicit heap budget
instead of relying on Node's smaller default.
