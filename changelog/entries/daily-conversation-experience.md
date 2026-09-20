---
id: daily-conversation-experience
title: Smoother new chats, activity navigation, and Settings
kind: fixed
areas: ["center-agent", "spaces", "settings"]
audiences: ["members"]
publishedAt: 2026-09-16
release: v0.3.212
evidence: ["pr:1105", "pr:1133", "commit:b8dcd2b62dab99a9f852783550a913afe718abd4", "workflow:35133498793"]
---

New Center Agent chats support attachment previews, paste and drop, and saved
attachment drafts. The first message appears while the chat is being created,
even when sidebar settings are still loading. Attachments added while an existing
chat loads keep their previews and carry over into the conversation.
Sending while attachments finish preparing preserves any newer draft and files.
Removed or sent attachments stay out of the composer when an older draft finishes loading.
The welcome area and first message stay in place as the new chat finishes loading.

Sidebar activity indicators open the conversation or Thread where the agent is working.
Completed work stays finished when you close a Thread, add replies, or return
to a conversation. An older reply no longer hides a newer run by the same agent,
and activity links continue to open work that is still active.
Center Agent chat links retain both the selected session and Thread.
Message previews in the sidebar link directly to the displayed message, including
Thread replies. Conversation menus have clearer labels and action icons.
Settings keeps its navigation and dialog in place while a section loads.
Spaces and direct messages keep the conversation sidebar, header, and centered
message and composer layout visible while loading. Saved Members panel widths
and open states also apply to the loading placeholder.
