---
id: center-agent-chooses-tools-from-catalog
title: Let Center Agent choose the right tools
kind: improved
areas: ["center-agent", "tools"]
audiences: ["members"]
---

Center Agent now searches its complete capability catalog itself instead of
having OpenMeld guess a few tools from the wording of each request. The same
approach works across supported models, languages, and paraphrases. A small set
of safe member and Task reads stays ready for immediate use, while writes remain
under the Agent's explicit choice and current-status questions distinguish a
fresh read from older Task history. If a model provider completes a turn with
no answer or action at all, OpenMeld now safely retries once before showing a
failure.
