---
id: release-status-component-receipts
title: Keep verified component releases visible during staged rollouts
kind: fixed
areas: ["releases"]
audiences: ["contributors"]
---

Release status now evaluates each component from its own deployment receipt and
source changes, so an unrelated deployment-order conflict cannot hide a verified
release. Release planning and admission still require safe component ordering
and verified receiver deployments.
