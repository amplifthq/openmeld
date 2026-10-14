---
id: computer-retained-partial-output
title: Read saved output after a Computer command is lost
kind: fixed
areas: ["computer", "agents"]
audiences: ["users"]
---

If a Computer command is lost when its runtime is replaced, polling its original
reference returns any output already saved with the command. Agents can use that
evidence to explain what was done and what remains unknown without repeating the
command. The result still identifies the loss; saved output does not prove a
successful exit or that files finished synchronizing.
