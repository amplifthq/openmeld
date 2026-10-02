---
id: interrupted-task-results-and-summary
title: Keep completed results visible when a task is interrupted
kind: improved
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

An interrupted task explains that earlier actions may have taken effect and
links to verified child results in the same Space. It does not suggest repeating
the original request or guess a cause from a provider's error text.

When execution, access, results and runtime support are verified, you can ask
Center Agent to summarize the existing results. This restricted summary can read
results but cannot call business write tools or run Computer commands. It does
not continue the remaining work. Stopped, unconfirmed, unreadable or unsupported
recovery remains unavailable.

A temporary receipt failure during summary recovery can resume the same recovery
intent. User Stop still takes priority, and repeated requests create one summary.

Older saved summary requests that lack the restricted execution marker are
blocked for diagnosis, so retrying cannot reopen ordinary tools.
