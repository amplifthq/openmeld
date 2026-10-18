---
id: service-stops-promptly-and-restarts
title: Stop and restart OpenMeld Service promptly
kind: fixed
areas: ["cli", "local-service"]
audiences: ["users", "contributors"]
---

`openmeld service stop` no longer waits for background checks of installed
agent CLIs to finish, so an idle Service stops promptly instead of timing out
and suggesting a forced stop. When a Service is still finishing its
stop, the warning now says so. In development or isolated lanes with a custom
`OPENMELD_HOME`, starting again while the previous Service is still stopping
reports it as running instead of asking for a repair.
