---
id: editor-caret-snapshot-refresh
title: Keep the cursor in place while editing
publishedAt: 2026-10-02
release: v0.3.236
evidence: ["pr:1448","commit:7eba5b84b75cd655b508a8f3cf5959281a11eab3","workflow:37025217534"]
kind: fixed
areas: ["spaces", "documents"]
audiences: ["users"]
---

The message and document editors keep your cursor and text selection in place
when the surrounding page refreshes before the editor finishes processing your
selection. Live updates and saved drafts remain enabled.
