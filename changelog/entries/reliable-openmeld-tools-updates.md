---
id: reliable-openmeld-tools-updates
title: Keep Agent work safe while OpenMeld Tools update
kind: fixed
areas: ["computers", "openmeld-service", "setup", "wake"]
audiences: ["members", "admins"]
---

Computers running an unsupported OpenMeld Service now show a required update to
the current installable release before they can accept new Agent work. The
current release includes startup recovery, managed updates, active Permission
and Wake behavior, and recovery for a Wake that reaches the computer while a
controlled Service update is switching versions. Already accepted work is
still allowed to finish before OpenMeld switches the Service version.

The Computer page now keeps update progress honest until both OpenMeld Service
and CLI report the installed target version. If Web cannot verify the result,
it stops checking automatically and keeps a clear **Update manually** fallback;
older Services that cannot manage their own update show only that manual path.
An offline Service now uses **Reconnect manually** everywhere instead of
suggesting that Web can control a disconnected process.

Connected Production Computers with automatic updates enabled now receive the
current release over their existing Service connection. The Computer page only
offers an update action after that release is available to install.
