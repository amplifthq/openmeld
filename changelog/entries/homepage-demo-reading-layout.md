---
id: homepage-demo-reading-layout
title: Read conversations and threads in the homepage demo
kind: improved
areas: ["website", "spaces"]
audiences: ["users"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:88888852bd7265c0b437ddefc5011c6175f0e4c1", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800", "workflow:38079531426"]
---

The homepage demo opens billing review in a readable Thread panel alongside the
main conversation and Members. Compact navigation shows complete Space names,
panel headers align, and Product navigation centers the demo in the window.
Conversation and Thread histories use the product's scroll area with gentle
edge fades as messages move out of view.

Space settings and panel close buttons also align in the app. Thread and Members
headers use the same height, including while a thread loads.

A final section explains privacy protections and links to the project's source
repository, issues, and pull requests.

The five hero bots move gently, follow a nearby pointer, and play their complete
jump when clicked. The Codex preview removes inactive controls and extra labels
to keep the example clear.

A gentle border light draws attention to the demo's ready-to-send draft. It
circles slowly while the draft is ready, fades out during editing or sending,
and respects reduced motion. It remains available when you return to Product.
