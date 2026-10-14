---
id: release-patch-scope-status
title: Complete scoped dependency patch releases
kind: fixed
areas: ["developer-workflow"]
audiences: ["contributors", "operators"]
---

Release planning and completion checks keep proven dependency patch changes
within their affected components. Unrelated services no longer appear to need
deployment solely because a patch hash changed. Uncertain dependency changes
still require the full release assessment.

The release status command can also print a selected stage's plan and exit
normally, using the status snapshot it already collected.
