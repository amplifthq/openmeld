---
id: hosted-release-receipt-auth
title: Read private release evidence in GitHub checks
kind: fixed
areas: ["releases"]
audiences: ["contributors", "operators"]
---

GitHub production preflight checks can read private release receipts using the
workflow's existing credentials. Missing access still stops publication, and
credentials are never saved in the release checkout.
