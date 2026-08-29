---
id: reliable-composer-sending
title: Keep Composer messages moving past file and mention conflicts
kind: fixed
areas: ["composer", "spaces", "files", "wake"]
audiences: ["members"]
---

OpenMeld now wakes an Agent only once when that Agent is mentioned more than
once, while preserving every mention in the message text. Selected files stay
temporary until Send, and one failed file no longer blocks the message text or
other files that are ready to send. If OpenMeld cannot yet confirm a send,
published files stay with that pending message instead of becoming available
for a duplicate send.
