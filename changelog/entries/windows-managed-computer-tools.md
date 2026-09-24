---
id: windows-managed-computer-tools
title: Connect a Windows PC without installing Node.js
kind: improved
areas: ["computer-connection", "windows", "desktop", "cli"]
audiences: ["users"]
evidence: ["pr:1267"]
---

Windows x64 setup uses a readable PowerShell command and managed OpenMeld Tools,
without requiring a separate Node.js, Bun, or .NET installation. Desktop uses
the same Tools installer and existing account-checked Computer connection.

The background connection runs directly under the signed-in user's Windows
Task Scheduler. Closing the setup terminal does not make that terminal the
owner of the connection. Individual agents may still need their own software
and sign-in.

Web's platform tabs also use consistent label sizing.
