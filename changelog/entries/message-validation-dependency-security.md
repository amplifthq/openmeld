---
id: message-validation-dependency-security
title: Update request handling, rendering, and dependency security fixes
kind: security
areas: ["channels", "remote-agents", "spaces", "desktop", "development"]
audiences: ["admins", "developers"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["commit:682d4fd273675b9dc405456a2c46a68aa24d8f4d", "commit:98fb79da6893ac5971c616f6d43161bfbebc6795", "commit:9f1f6f8b4ec2f628288a77593042f33d51bf1d47", "commit:e7bcf2f444662ce4acc618d32354e378ce8df3fc", "workflow:38863835438"]
---

Update the libraries used for Lark message encoding and decoding, Remote Agent
input validation, YAML parsing, static HTML previews, and Auth, Core, and Desktop
builds. These updates include upstream security fixes in protobufjs, Valibot,
yaml, DOMPurify, esbuild, and Vite. Existing message formats and tool inputs
remain unchanged.

Update Hono request handling and React rendering across Web, Desktop, Website,
Docs, and shared UI. Preserve route parameter types in extracted handlers and
reject missing avatar and organization logo filenames through existing validation.

Update Desktop to Electron 44.7.2, including upstream macOS background-click and
interrupted-update fixes. Keep the existing login, permissions, and update policy.
