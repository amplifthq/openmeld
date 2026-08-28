---
id: keep-computer-sign-in-stable
title: Keep your Computer connected when setup cannot finish
kind: fixed
areas: ["connect", "cli", "web"]
audiences: ["members"]
---

Connect Computer now gives the Computer its own sign-in, verifies that Web and
the setup command belong to the same account, and keeps the existing Computer
connection working when a new setup attempt fails, is canceled, or is interrupted
by a closed Terminal, process crash, or computer restart. Switching a Computer
to another account also requires explicit confirmation. CLI and OpenMeld Service
requests now refresh an expired local session when possible, then stop locally
with clear auth diagnostics instead of continuing without authentication when
stored credentials are expired or malformed.
