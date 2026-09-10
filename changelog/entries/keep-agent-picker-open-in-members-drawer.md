---
id: keep-agent-picker-open-in-members-drawer
title: Keep Agent creation open from the Space members drawer
kind: fixed
areas: ["agents", "web", "spaces"]
audiences: ["users"]
publishedAt: 2026-09-09
evidence: ["pr:814", "commit:c554f137a828336f9a7d9432b76adcc2bc78d1bb", "creation-request:apcr_6a73e93b-f6c5-4654-b553-e8547319a6ce", "dispatch:9afc1499-6484-45e7-8066-80f61a5da47a"]
---

On smaller screens, creating or selecting an Agent from Space members no longer
closes the picker when you click inside it. The members drawer and its dialogs
share focus and dismissal handling, while preserving swipe-to-close behavior.
