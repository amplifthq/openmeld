---
id: center-agent-evidence-reads
title: Ask the Center Agent about past work and remembered decisions
kind: improved
areas: ["center-agent", "routines", "agent-activity", "memory"]
audiences: ["members", "admins"]
evidence: ["pr:1199"]
---

The Center Agent can read its recent organization actions on behalf of a verified
member, return a bounded coding-activity overview, and inspect older Routine Runs
without confusing execution with publication. Routine diagnostics follow the
recorded result owner across continuations and state when evidence is missing,
unavailable, or redacted.

Members can also search already retained memory from an OpenMeld conversation.
Remembered summaries include readable source-message references and occurrence
times; they are not quotes or proof of the latest approved decision. Every
supporting source must be authorized for both the member and the current reply
audience, so private context is not disclosed into a shared conversation.

These reads do not recover or replay work, create memory graphs, or expand
conversation capture. Slack and Lark/Feishu memory provenance and channel
Routine destination references are not supported by these new source readers.
