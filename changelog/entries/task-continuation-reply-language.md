---
id: task-continuation-reply-language
title: Keep the chosen language when Center Agent continues
kind: fixed
areas: ["center-agent", "wake"]
audiences: ["users"]
---

When Center Agent chooses a reply language while delegating or watching a task,
the continuation instructions and corresponding failure notices preserve that
choice, including Routine continuations. Without a task language choice, notices
use the Organization preference, then English. Initial Routine failures and
workstation child-failure notices do not yet receive this task language fact.
