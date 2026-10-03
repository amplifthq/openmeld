---
id: dev-setup-client-identity
title: Connect a Computer in an isolated development lane
kind: fixed
areas: ["cli"]
audiences: ["developers"]
---

The packaged CLI now uses the development lane's OAuth client when redeeming
a Web setup command. This fixes the repeated "Client ID mismatch" failure
without requiring a different account or a manual credential change.
