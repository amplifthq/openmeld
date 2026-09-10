---
id: mention-dismissal-and-compact-replies
title: Easier mentions and clearer replies
kind: improved
areas: ["web", "chats", "spaces"]
audiences: ["users"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

Typing `@` after Chinese, Japanese, Korean, or sentence punctuation now opens
member suggestions without an extra space. A close button lets you dismiss
suggestions and keep your `@` and entered text as ordinary text, just like Escape.

Reply context now sits inside the composer as a compact line with the person's
name, a short message preview, and a leading cancel button. Quotes in sent
messages use quieter, single-line previews so the new reply is easier to distinguish.

Unavailable Wake targets now appear muted in the composer, with a shorter
explanation and an action to reconnect the computer or resolve the current issue.
