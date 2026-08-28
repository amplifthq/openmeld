---
id: reuse-unchanged-integration-evidence
title: Avoid repeating unchanged integration tests
kind: improved
areas: ["developer-experience", "ci"]
audiences: ["contributors"]
---

Final Candidate can reuse successful affected integration-test evidence after a
pull request moves onto an unrelated newer `main`. Any relevant code,
configuration, dependency, runtime, command, or test-input change still runs the
integration tests again.
