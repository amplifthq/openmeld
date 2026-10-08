---
id: connector-results-and-continuation-inbox
title: Accurate App results and task continuation notices
kind: fixed
areas: ["apps", "inbox", "center-agent"]
audiences: ["members"]
---

App actions accept the provider's documented successful response and retain its
execution result schema. Completed writes are no longer reported as unknown
just because the response includes that schema.

Task continuation failure notices open the failed continuation's own Space
message or thread. A failure without an available recovery action appears as a
normal update, rather than an urgent request to retry completed work.
Replaying a known legacy notice repairs its destination and classification
without resetting your read or removal choices. Startup notices distinguish an
unconfirmed execution from a confirmed task that never started.

Startup diagnostics record each continuation attempt's send, acknowledgement,
timeout, and retry schedule separately, preserving the task's correlation IDs.
They retain a confirmed receipt even when later handling stalls or fails, and
separate queue, preparation, Worker response and postprocessing timings.

When continuation startup attempts are exhausted, notices explicitly say that
automatic recovery has stopped and warn that a new request may repeat earlier
actions. Routine execution failure notices distinguish a missing result from
proof that no actions ran, and retain the link to the Run.

Task continuations identify missing published child results explicitly, so the
Agent can summarize the available evidence without inventing a result or
repeating a completed child task. Result access checks remain unchanged.
