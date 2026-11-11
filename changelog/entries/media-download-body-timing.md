---
id: media-download-body-timing
title: Trace slow Space file and attachment downloads
kind: improved
areas: ["web"]
audiences: ["operators"]
---

Space file and attachment downloads now record when the file body finishes
reaching the client, how many bytes were sent, and whether the download
completed, was stopped by the client, or failed upstream. A second record
holds the time spent waiting on the upstream body, so operators can see how
much of a slow download was upstream delivery and how much was the client
connection.
