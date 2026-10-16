---
id: service-result-recovery
title: Recover retained results and failed computer connections
kind: fixed
areas: ["computer", "local-agents"]
audiences: ["users"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1723", "workflow:38595947657", "commit:4a84cdbcdfeddeaf2a12b8f6bd5dc990afb78b9d"]
---

OpenMeld can publish recovery notices for results that arrive after a task loses
its computer connection. OpenMeld Service also resumes its reconnect flow when
a connection fails without a close notification, while keeping saved results
available for replay.
