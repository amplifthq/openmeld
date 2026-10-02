---
id: connector-replay-access-and-summary-receipts
title: Check current account access on retries and report finished summaries
kind: fixed
areas: ["center-agent", "apps", "spaces"]
audiences: ["members"]
---

Retrying an App or GitHub action checks access to the original account again.
Revoked access, reduced permissions, and a changed account cannot be bypassed
by reusing an operation ID. Pending reads keep their normal retry behavior.

A repeated summary-recovery request now reports cancellation, failure, or
completion instead of asking the Agent to wait for work that has ended. A
completed summary points to its existing Space reply when that publication
and the requester's current access can be verified.
