---
id: clear-final-candidate-control-refusals
title: Distinguish protected validation from CI failures
kind: improved
areas: ["engineering", "ci"]
audiences: ["contributors"]
---

Final Candidate checks now show a skipped hosted Runner with a clear protected
local validation instruction when a pull request changes trusted delivery
control. Real test, build, runner, and publisher failures remain red, while the
required merge status still stays blocked until the exact candidate passes the
protected local bootstrap.
