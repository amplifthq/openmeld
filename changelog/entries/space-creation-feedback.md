---
id: space-creation-feedback
title: See your new Space while it is being created
kind: improved
areas: ["spaces", "web"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Creating a Space opens its conversation immediately, with its name in the header
and sidebar. You can write a message and add attachments while it prepares.
Messages submitted during preparation send after the Space is ready. If creation
cannot be confirmed, your draft stays available in the conversation.

Starting a Space from New Message now uses the same immediate conversation.
New agents are selected as soon as creation completes, without waiting for the
people list to refresh. Adding members closes the picker immediately and shows
progress in the Space. If adding members fails, you can retry in the same Space.
