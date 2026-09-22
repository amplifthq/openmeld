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

Each stage checks the artifacts required by its declared release train before
changing production. Independent releases remain independent, and a deployment
with a retained, verified identity can resume its failed health check without
deploying again. Web and Desktop keep separate checked artifact snapshots so
building one does not force the other to rebuild.

CLI trains also install the packed npm artifact before any production change
and retain those verified bytes for publication. Compatibility checks require
the working-folder cancellation receiver before the new CLI/Service, and the
verified CLI before the Web installer, without requiring unrelated components
to ship together.
