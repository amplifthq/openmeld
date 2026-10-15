---
id: message-validation-dependency-security
title: Update request handling, rendering, and dependency security fixes
kind: security
areas: ["channels", "remote-agents", "spaces", "desktop", "development"]
audiences: ["admins", "developers"]
---

Update the libraries used for Lark message encoding and decoding, Remote Agent
input validation, YAML parsing, static HTML previews, and Auth, Core, and Desktop
builds. These updates include upstream security fixes in protobufjs, Valibot,
yaml, DOMPurify, esbuild, and Vite. Existing message formats and tool inputs
remain unchanged.

Update Hono request handling and React rendering across Web, Desktop, Website,
Docs, and shared UI. Preserve route parameter types in extracted handlers and
reject missing avatar and organization logo filenames through existing validation.
