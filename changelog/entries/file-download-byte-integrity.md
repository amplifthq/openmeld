---
id: file-download-byte-integrity
title: Download Files reliably through the CLI
kind: fixed
areas: ["files", "cli"]
audiences: ["users", "integrators"]
---

CLI reads and downloads preserve the original bytes of My Files, Team Files, and Space Files. File responses now prevent edge compression from removing the length information required by the CLI's integrity check.
