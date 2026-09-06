---
id: local-fixture-scenarios
title: Add richer local development scenarios
kind: improved
areas: ["web"]
audiences: ["developers"]
---

The shared local seed includes varied Space conversations, dates, member avatars,
system notices, and empty chats. Seed-only conversation status rows and approval
dialogs have been removed so the conversation uses the normal product UI.
Space sidebar Working and needs-input indicators now use runtime data rather
than independent visual samples. Saved test accounts can be refreshed with
`dev:seed --account`.
