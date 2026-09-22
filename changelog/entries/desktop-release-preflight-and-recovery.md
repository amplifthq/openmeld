---
id: desktop-release-preflight-and-recovery
title: Check Desktop publishing readiness before signing
kind: improved
areas: ["desktop", "releases"]
audiences: ["operators"]
---

Desktop release operators can check the selected Cloudflare publishing account
and bucket before signing. Production Desktop builds now use a Desktop-specific
memory budget, and failed candidate uploads or promotion checks explain which
step stopped and whether the public update pointer may have changed.
