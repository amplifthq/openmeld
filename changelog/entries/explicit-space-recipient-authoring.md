---
id: explicit-space-recipient-authoring
title: Choose Space recipients independently of message text
kind: improved
areas: ["spaces", "cli"]
audiences: ["users", "developers"]
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
