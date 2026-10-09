---
id: cloud-computer-command-observation
title: Bound automatic Cloud Computer command checks
kind: fixed
areas: ["center-agent", "computer"]
audiences: ["users", "agents"]
---

Cloud Computers check commands in small batches without reading all completed
receipts. Repeated observation errors delay automatic checks, then pause them.
The command may still be running. Its saved reference remains available for
manual inspection, and a successful check resumes automatic collection without
starting another command.
