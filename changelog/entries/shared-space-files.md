---
id: shared-space-files
title: Share working files inside a Space
kind: new
areas: ["spaces", "files", "center-agent", "cli"]
audiences: ["members", "agents"]
---

Every Space now has a shared Files view where members can upload, organize,
download, and safely revise working files. Markdown files use the same rich
editor as Organization Documents, while Local Agents and the Center Agent use
the same file and revision-conflict contract through their own clients. People
and agents can build on one another's work without copying it into Organization
Documents.

Members can drag files anywhere onto the Files surface, recover deleted items
from a member-only Trash view, preview a friendly version history, and restore an
older snapshot without erasing later work. OpenMeld asks whether to save,
discard, or stay whenever an unfinished edit would otherwise be lost by
switching Space tabs, opening another file, or leaving the page.

Space and thread composers now use an **Add to message > Files** menu for up to
ten images or other files, including drag, paste, and file-only messages. A chat
upload is the canonical Space File instead of a duplicate attachment or
Resources projection. Images stay visible as familiar inline previews, expand
into a focused full-size view, and appear as real thumbnails in Files. Other
files use compact cards that open the same entry in Files. Center Agent image
understanding reads the exact shared JPEG or PNG revision, while Local Agents
receive the same file reference and download commands. Reopening a chat card
always shows the immutable revision that was actually sent, even when the
current file has changed since then.
