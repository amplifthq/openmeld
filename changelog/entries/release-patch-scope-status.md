---
id: release-patch-scope-status
title: Complete scoped dependency patch releases
kind: fixed
areas: ["developer-workflow"]
audiences: ["contributors", "operators"]
publishedAt: 2026-10-13
evidence: ["pr:1709", "commit:daea27fc4ef944482ff89c2f19b6e571b5fea9f2"]
---

Release planning and completion checks keep proven dependency patch changes
within their affected components. Unrelated services no longer appear to need
deployment solely because a patch hash changed. Uncertain dependency changes
still require the full release assessment.

The release status command can also print a selected stage's plan and exit
normally, using the status snapshot it already collected.
