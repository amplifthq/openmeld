---
id: member-agent-session-recovery
title: More reliable Agent setup and conversations
kind: fixed
areas: ["agents", "authentication", "spaces", "cli"]
audiences: ["members"]
---

One-time-code CLI sign-in keeps the browser session separate, so owners can
continue approving requests on the web. Completed conversations forked into
another folder can continue after the original folder is removed.

Chats with a colleague's Agent use the same archive state in the conversation
menu, sidebar, and Agent page. New personal Remote Agents join their hosted
Agent group, and interrupted Agent setup retries its initial chat without
recreating chats that were deliberately deleted or converted into Spaces.
