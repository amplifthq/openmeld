---
id: media-download-body-timing
title: Trace slow Space file and attachment downloads
kind: improved
areas: ["web"]
audiences: ["operators"]
---

Space file and attachment downloads now record when the file body finishes
reaching the client, how many bytes were sent, and whether the download
completed, was stopped by the client, or failed upstream. Operators can tell a
slow client connection apart from a slow upstream in the runtime evidence.
