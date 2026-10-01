---
id: binary-update-availability
title: Match computer updates to the installed binary channel
kind: fixed
areas: ["web", "windows"]
audiences: ["users"]
---

Computer update checks use the installation's verified channel and platform.
Windows previews no longer inherit a newer macOS-only stable update target.
Unavailable release information remains unconfirmed, and automatic updates
require an installable CLI and Service pair. Minimum compatibility checks
continue to protect work independently of release availability.
Required CLI updates remain visible when the installed channel has no suitable
release, so an older preview cannot be reported as up to date.
