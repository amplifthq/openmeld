---
id: worker-only-release-inactive-computers
title: Update the Remote Agent Worker while Computers are inactive
kind: fixed
areas: ["engineering", "remote-agent"]
audiences: ["contributors"]
---

The guarded Worker-only release can proceed when a complete platform check
finds no active Computers. It keeps the existing Container configuration and
checks that any original active instances remain present. File synchronization
still requires separate verification before a full Container rollout.
