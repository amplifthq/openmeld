---
id: space-files-artifacts-default
title: Files defaults to artifacts, with chat uploads one click away
kind: improved
areas: ["spaces", "web", "cli"]
audiences: ["members"]
---

Space Files now defaults to showing artifacts — files created with Files
itself, uploaded there directly, or written by an Agent — instead of mixing
them with every image and file shared in chat. A **Show chat uploads** toggle
reveals files sent as chat attachments without leaving the Files view; toggle
it off to return to the artifacts-only default. Files shared in chat are never
deleted or hidden with no way back.

The OpenMeld CLI's `space files list` gained a matching `--all` flag, and
`space files upload`/`space send --file` now record whether each new file was
uploaded directly or shared in chat.
