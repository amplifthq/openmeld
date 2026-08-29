---
id: keep-computer-sign-in-stable
title: Keep your Computer connected when setup cannot finish
kind: fixed
areas: ["connect", "cli", "web"]
audiences: ["members"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:469", "commit:dd680a248c14a84424856f29fb5edc9c0807febb", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:acb7e69e-ffed-4ef2-96e7-c734a2598961", "worker-version:c56b9578-6712-4996-969e-ecf553b32066"]
---

Connect Computer now gives the Computer its own sign-in, verifies that Web and
the setup command belong to the same account, and keeps the existing Computer
connection working when a new setup attempt fails, is canceled, or is interrupted
by a closed Terminal, process crash, or computer restart. Switching a Computer
to another account also requires explicit confirmation. That confirmation stays
bound to the exact Computer sign-in the user reviewed. If another process
changes the sign-in before setup starts the switch, OpenMeld
stops and asks the user to review again. The new candidate sign-in remains
private to setup and its candidate Service until Prepare succeeds. If setup is
interrupted while OpenMeld Service is already offline, a fresh repair can now
restore the previous Computer connection instead of getting stuck on a missing
local control socket. If account validation offers a refreshed token while that
recovery is still in progress, OpenMeld keeps the restored sign-in untouched
until Service repair finishes. Recovery also closes the unused temporary
sign-in correctly, so later status and repair checks do not leave the
interrupted handoff deferred.
Sign-in and Service status remain available for diagnosis. CLI and OpenMeld
Service requests now refresh an expired local session when possible, then stop
locally with clear auth diagnostics instead of continuing without authentication
when stored credentials are expired or malformed.
