---
id: worker-only-release-inactive-computers
title: Update the Remote Agent Worker while Computers are inactive
kind: fixed
areas: ["engineering", "remote-agent"]
audiences: ["contributors"]
publishedAt: 2026-10-14
evidence: ["pr:1718", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

The guarded Worker-only release can proceed when a complete platform check
finds no active Computers. It keeps the existing Container configuration and
checks that any original active instances remain present. File synchronization
still requires separate verification before a full Container rollout.
