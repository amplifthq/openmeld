---
id: keep-computer-sign-in-stable
title: Keep your Computer connected when setup cannot finish
kind: fixed
areas: ["connect", "cli", "web"]
audiences: ["members"]
---

Connect Computer now gives the Computer its own sign-in, verifies that Web and
the setup command belong to the same account, and keeps the existing Computer
connection working when a new setup attempt fails or is canceled. Switching a
Computer to another account also requires explicit confirmation. CLI requests
now refresh an expired local session when possible and never send a token that
is already known to be expired.
