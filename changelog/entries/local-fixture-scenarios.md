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
Local API scenarios exercise the production working and approval surfaces,
including valid permission responses, without running commands. Account discovery,
closed Space rows, and conversations share that progress data before navigation.
Running simulations keep fresh evidence without resetting elapsed time. Saved test accounts can be
refreshed with `dev:seed --account`.
