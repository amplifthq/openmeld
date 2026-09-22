---
id: release-artifact-preflight-and-receipts
title: Verify production pages and release sources before deployment
kind: improved
areas: ["releases", "web", "desktop"]
audiences: ["contributors", "operators"]
---

Release checks run the production Web bundle in Workerd and verify the Desktop
renderer before deployment. Web health checks require a rendered page from the
expected source. Component receipts keep staged releases and recovery tied to
the artifacts actually deployed, including releases that use different sources
for different components.
