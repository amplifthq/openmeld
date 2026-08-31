---
id: faster-clearer-space-reading
title: Read Spaces faster from full Web links
kind: improved
areas: ["cli", "spaces"]
audiences: ["agents", "members", "contributors"]
---

OpenMeld agents can now pass a full Space Web URL directly to board, members,
history, and status reads. These reads avoid redundant identity lookups, keep
explicit Profile choices local to the command, return read-only recovery help
for invalid targets, and bound status previews so long messages are not
repeated in full.
