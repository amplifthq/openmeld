---
id: preserve-computer-command-tail-output
title: Keep command output when a process exits
kind: fixed
areas: ["computer", "remote-agent"]
audiences: ["users"]
publishedAt: 2026-10-14
evidence: ["pr:1718", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

Computer retains the last stdout and stderr from a command before reporting its
exit. Output that arrives after the process exits no longer crashes the Computer
or interrupts other commands.

Stop and command timeouts also reach ordinary child processes after the main
process exits, while the Computer continues to collect their final output.
