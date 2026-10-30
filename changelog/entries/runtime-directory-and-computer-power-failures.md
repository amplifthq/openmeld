---
id: runtime-directory-and-computer-power-failures
title: Keep Agent directories available during runtime interruptions
kind: fixed
areas: ["agents", "computers"]
audiences: ["users", "integrators"]
---

Organization directories and Agent runtime overviews remain available when a
member's runtime status cannot be checked. The affected Agent remains unavailable
until a fresh check succeeds, without repeating the failed check for each Agent.

Computer sleep-prevention requests now distinguish a Service timeout, a missing
response, and an invalid response instead of showing a schema error. Updates are
never automatically replayed after an uncertain result.
