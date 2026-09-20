---
id: space-large-file-uploads
title: Share files up to 250 MiB in Spaces
kind: improved
areas: ["spaces", "files", "cli"]
audiences: ["users", "developers"]
---

Upload files up to 250 MiB from a Space message, Files, or the CLI. Larger
uploads transfer in parts and retry without restarting completed parts.
Composer attachments can resume after a page refresh, and upload progress
shows how much has transferred. CLI uploads and downloads no longer load
the entire file into memory.
