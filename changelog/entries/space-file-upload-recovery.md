---
id: space-file-upload-recovery
title: Recover a slow Space file upload
kind: fixed
areas: ["cli", "files", "spaces"]
audiences: ["members"]
publishedAt: 2026-11-06
release: v0.3.291
evidence: ["pr:386", "pr:387", "commit:076d1a05ee9d262bf3166e5cf857dc19f13853f5", "workflow:42158332038", "workflow:42154969966"]
---

Space file uploads from the CLI allow more time on slow connections and show
when the server has received each part. If the result is uncertain, you can
check the exact file and retry the same upload without creating another copy.
During long Local Agent tasks, the Agent is prompted to share milestones and
distinguish finished checks from evidence it still needs to deliver.
