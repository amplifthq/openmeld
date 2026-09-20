---
id: windows-computer-and-desktop
title: More reliable Windows Computer connections and Desktop controls
kind: fixed
areas: ["computers", "desktop", "local-agents"]
audiences: ["users"]
evidence: ["pr:1163"]
---

Windows Computer connections use the Windows CLI installation and preserve
arguments and environment settings when launching local agents. File access
checks handle Windows paths, and cancelling a Wake cleans up its owned process
tree rather than leaving tool subprocesses behind.

Desktop uses native Windows window controls and Ctrl navigation shortcuts.
Windows installers and updates have separate architecture-specific channels and
require a verified publisher; a missing Windows release never selects a Mac
installer. Node.js with npm remains required to connect a Windows Computer.
