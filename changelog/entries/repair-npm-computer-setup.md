---
id: repair-npm-computer-setup
title: Restore npm-based computer setup
kind: fixed
areas: ["cli", "setup", "windows", "release"]
audiences: ["users", "contributors"]
---

OpenMeld's npm release path now resolves workspace dependency references and
verifies the actual installation package before publishing it. This repairs the
dependency error that prevented Windows Command setup and other npm-based
installation paths from starting the CLI.

Setup checks supported Node versions and distinguishes invalid package
dependencies from network failures. Windows validation exercises the generated
PowerShell command and a clean npm installation, including the native database
reader.

Windows background Service and hourly update tasks use a console-free launch
host to prevent the brief black window at sign-in or scheduled updates, while
preserving ordinary user permissions, automatic updates and task failure logs.
