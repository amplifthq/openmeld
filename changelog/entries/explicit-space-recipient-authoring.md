---
id: explicit-space-recipient-authoring
title: Choose Space recipients independently of message text
kind: improved
areas: ["spaces", "cli"]
audiences: ["users", "developers"]
publishedAt: 2026-09-08
release: v0.3.174
evidence: ["pr:742", "pr:759", "workflow:34213867447", "commit:db625a228bbdf18cb5b0a7caec3a1cb498877c65"]
---

Space messages no longer interpret `@Name(wake)` or similar text as an action.
Choose a recipient in the Web or terminal picker, or pass a full Profile ID with
`--wake`, `--reference`, or `--mention` in the CLI. Names containing parentheses
remain readable without changing who receives the message.

Pasting ordinary member names also keeps them as plain text. Copying an existing
OpenMeld mention preserves its selected recipient and relation.

Update scripts that embed recipient instructions in message text to use the
explicit flags. The optional `--plain` flag asserts that no recipients were
provided. Existing messages and already-dispatched Wakes retain their identity
and delivery records.
