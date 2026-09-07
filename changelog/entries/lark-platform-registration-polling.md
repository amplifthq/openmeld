---
id: lark-platform-registration-polling
title: Complete Lark and Feishu app registration
kind: fixed
areas: ["channels", "center-agent"]
audiences: ["admins"]
---

Fixed a registration polling failure that could leave Channel setup waiting
until it expired after the app had already been created in Lark or Feishu.
OpenMeld can now send the follow-up registration requests needed to receive
the app credentials and continue connection verification.

New callback encryption keys and verification tokens also respect the
provider's 32-character limit, preventing configuration requests from being
rejected after registration succeeds.

Encrypted URL-verification challenges can now complete without signature
headers when their verification token matches. Ordinary message signatures
remain required. Setup verification also recognizes an explicitly granted
app-configuration scope without treating it as a runtime Channel capability.

Local developers can set `OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN` when starting
the isolated stack to verify Lark or Feishu Webhooks through a development
HTTPS tunnel while keeping local browser routing and data isolated.
