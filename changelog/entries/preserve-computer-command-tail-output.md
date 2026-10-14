---
id: preserve-computer-command-tail-output
title: Keep command output when a process exits
kind: fixed
areas: ["computer", "remote-agent"]
audiences: ["users"]
---

Computer retains the last stdout and stderr from a command before reporting its
exit. Output that arrives after the process exits no longer crashes the Computer
or interrupts other commands.
