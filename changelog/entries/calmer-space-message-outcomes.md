---
id: calmer-space-message-outcomes
title: Keep Space message outcomes calm and concise
kind: improved
areas: ["spaces", "web", "cli"]
audiences: ["members"]
---

Space messages now place Copy, Reply, Thread, Addressing, Message details, and
time in a stable footer that does not cover message text or shift the timeline.
Compact layouts move secondary actions into More, while failed messages keep a
short persistent summary and leave complete error context and available
recovery actions in Message details. Long system notices also wrap cleanly
between visible dividers without framing the full conversation.

Messages omit redundant Wake receipts, while CLI-authored Wake, Reference, and
Human Mention instructions publish the member's current `@Name` without losing
exact structured targeting for agents. Agents can privately select a member by
stable Profile ID without exposing that machine ID or a relation suffix in the
public message. Structured Agent Wakes are easier to scan on Web with a compact
Agent icon and bold name directly in the message, and their targets remain
available from the message's Addressing action.

Space members now show `Active here` with an explanation that the time reflects
activity in this Space, so it is not confused with Organization activity in
People.
