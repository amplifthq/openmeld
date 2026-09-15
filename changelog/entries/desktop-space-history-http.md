---
id: desktop-space-history-http
title: Keep Space history updates on the shared API
kind: fixed
areas: ["desktop", "spaces"]
audiences: ["contributors"]
---

The private Desktop pilot uses the shared HTTP APIs to load profiles and Space
lists, update viewing history, pin Spaces and record removal. These operations
no longer depend on generated Web server-function calls, which the pilot
refuses for writes.

Space history uses the current Web environment even when the renderer was built
in a different local lane. The pilot still requires a matching Web fingerprint;
this change does not establish compatibility across different Web builds or
add protected Space password persistence.
