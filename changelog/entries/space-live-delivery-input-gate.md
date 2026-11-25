---
id: space-live-delivery-input-gate
title: Keep Spaces responsive while a live message is being delivered
kind: fixed
areas: ["spaces", "inbox"]
audiences: ["members"]
---

A thread reply could be saved while its live delivery blocked other requests
to the same Space. The write now releases the Space input gate before waiting
for live delivery. Connected readers receive authorized messages in order,
and Inbox notifications still follow delivery of the corresponding message.
