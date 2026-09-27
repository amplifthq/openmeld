---
id: connector-write-result-recovery
title: Report completed App writes accurately
kind: fixed
areas: ["center-agent", "apps"]
audiences: ["members"]
---

Completed App actions now return their result to the Center Agent, including GitHub writes that previously appeared to fail after taking effect. Retrying the same operation can recover its result without making the write again.
