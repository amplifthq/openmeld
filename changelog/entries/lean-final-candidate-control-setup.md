---
id: lean-final-candidate-control-setup
title: Reduce Final Candidate setup overhead
kind: improved
areas: ["engineering", "ci"]
audiences: ["contributors"]
---

Final Candidate control tools install only their runtime dependencies, and
result publication no longer restores the full development dependency cache.
The optimization applies across PR scopes and keeps the same checks, exact
candidate verification, and permission boundaries.
