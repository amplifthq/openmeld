---
id: read-diff-and-patch-attachments
title: Read diff and patch attachments without renaming them
kind: fixed
areas: ["files", "agents", "cli"]
audiences: ["users", "developers"]
---

Agents and the CLI can read text diff and patch attachments, including files
previously uploaded with a generic file type. You no longer need to rename these
files to Markdown to request a review. Text reads retain the 1 MiB limit and
validate UTF-8 content without changing the saved files.
