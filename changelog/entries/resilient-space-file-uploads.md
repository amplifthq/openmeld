---
id: resilient-space-file-uploads
title: Keep every Space file upload
kind: fixed
areas: ["spaces", "files", "center-agent"]
audiences: ["members"]
---

Uploading a file with an existing name now keeps both files and assigns a clear
numbered name automatically. Center Agent now keeps screenshots readable by
creating high-resolution temporary model copies, grouping up to five ordinary
screenshots when the visual and infrastructure budgets allow it, and combining
larger image sets across safe batches. Original image data never enters its
ongoing conversation context, and a missing source or unreadable model copy now
fails visibly instead of pretending the screenshot was understood.
