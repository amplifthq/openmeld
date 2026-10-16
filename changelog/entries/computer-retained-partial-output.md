---
id: computer-retained-partial-output
title: Read saved output after a Computer command is lost
kind: fixed
areas: ["computer", "agents"]
audiences: ["users"]
publishedAt: 2026-10-14
evidence: ["pr:1718", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

If a Computer command is lost when its runtime is replaced, polling its original
reference returns any output already saved with the command. Agents can use that
evidence to explain what was done and what remains unknown without repeating the
command. The result still identifies the loss; saved output does not prove a
successful exit or that files finished synchronizing.
