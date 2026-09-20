---
id: account-checked-service-control
title: Check the account when controlling a connected Service
kind: improved
areas: ["cli", "service"]
audiences: ["developers", "operators"]
---

CLI integrations can pass `--expected-account` with JSON Service start and stop
commands to refuse a mismatched account. Accepted work keeps its original
account if the CLI sign-in changes. On macOS and Linux, a native Service command
also retains its lifecycle lock if its requesting CLI exits unexpectedly.

This applies to an already connected Service. Desktop pilot controls remain
disabled, and account-checked control is not yet available on Windows.
