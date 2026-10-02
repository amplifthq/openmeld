---
id: dev-local-computer-authorization
title: Match local setup to its development account authorization
kind: fixed
areas: ["cli", "computer-connection"]
audiences: ["contributors"]
---

The packaged CLI uses the development authorization client for the `dev-local`
lane, so a setup command copied from a local OpenMeld Web instance can exchange
its computer authorization code. Explicit client settings still take priority.
