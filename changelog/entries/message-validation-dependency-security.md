---
id: message-validation-dependency-security
title: Update message parsing and validation security fixes
kind: security
areas: ["channels", "remote-agents", "development"]
audiences: ["admins", "developers"]
---

Update the libraries used for Lark message encoding and decoding, Remote Agent
input validation, and Auth and Core builds. These updates include upstream
security fixes in protobufjs, Valibot, and esbuild. Existing message formats
and tool inputs remain unchanged.
