---
id: reliable-computer-setup-recovery
title: More reliable Computer setup and recovery
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
publishedAt: 2026-09-13
release: v0.3.200
evidence: ["pr:974", "pr:975", "commit:de0140fd0892ffb13fd6a670a30a5c96074b6c39", "workflow:34731853294", "smoke:update:5943d0df-fcd3-46b5-9662-340925b4dc06"]
---

Computer setup requests a macOS background Service start without restarting an
already running Service. Startup failures retain diagnostic details, and CLI
update and diagnostic commands remain available when an earlier connection
cannot recover.

Setup also migrates original local agent settings without requiring a reset.
An older npm installation that cannot update no longer blocks setup through
the new managed OpenMeld binary.

When setup starts a background Service update, it waits for that operation and
continues automatically instead of asking you to run setup a second time.
It verifies the running Service before continuing. If Terminal closes after the
update begins, the background worker finishes the same setup and Web updates
automatically when the computer is connected.

Web onboarding keeps an active Terminal connection flow in place while computer
status refreshes, so a successful connection can finish in the same flow.

On macOS, starting a stopped Service also re-enables its automatic update worker
before registering it, avoiding a startup failure caused by its disabled state.
