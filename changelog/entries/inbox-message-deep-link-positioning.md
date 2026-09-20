---
id: inbox-message-deep-link-positioning
publishedAt: 2026-09-14
release: v0.3.205
evidence: ["pr:1044", "pr:1052", "commit:d913ca02e16ca64e934f967a8dd017d09982192e", "workflow:34879030368", "workflow:34879035286"]
title: Open Inbox notifications at the exact message
kind: fixed
areas: ["inbox", "spaces", "web"]
audiences: ["users"]
---

Inbox notifications scroll to and highlight their exact Space message without
being pulled back to the latest message as the conversation finishes loading.
Older links load the message and its surrounding conversation directly, without
stopping after a fixed number of history pages. Opening a main-message link
closes the previously selected Thread so the destination has room to display.
Thread notifications open the Thread header and composer while replies load,
then bring the linked reply into view. Closing or switching threads while a
request is pending keeps your latest selection.
