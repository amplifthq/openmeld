---
id: connector-write-result-recovery
title: Report completed App writes accurately
kind: fixed
areas: ["center-agent", "apps"]
audiences: ["members"]
---

Completed App actions now return their result to the Center Agent, including GitHub writes that previously appeared to fail after taking effect. When a write's result cannot be confirmed, the Agent is told to stop retrying and help you verify it in the connected App. Reusing an operation ID alone does not guarantee safe replay after the provider's records expire.

Native GitHub tools and other App tools retain the output contract returned with
that execution, including when recovering an earlier write without fetching a
new action catalog.

Requests that are still processing return an awaiting-confirmation receipt to
both direct tools and Code Mode. The receipt preserves the original operation
ID instead of suggesting an internal provider key as a new request.
