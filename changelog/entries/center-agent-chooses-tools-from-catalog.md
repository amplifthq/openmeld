---
id: center-agent-chooses-tools-from-catalog
title: Let Center Agent choose the right tools
kind: improved
areas: ["center-agent", "tools"]
audiences: ["members"]
publishedAt: 2026-08-28
evidence: ["pr:390", "commit:7e1a3dfeb5c1a1163c3a58eb2550ff0323965f96", "workflow:33136998522", "pr:405", "commit:8e5cf5b1f951fe5fbe4358be2ab2340e684f52d2", "workflow:33138357102", "pr:410", "commit:df9afbf47793b7c33bdb1d64f24e604d4c78957a", "workflow:33140131742", "smoke:c7af15f4-8d2e-4d89-989b-8540d3da1097,61827927-6abe-45a8-b208-89e2f5312f2f,cb90479e-ccc4-49e4-a8dc-5a807c966d33"]
---

Center Agent now searches its complete capability catalog itself instead of
having OpenMeld guess a few tools from the wording of each request. The same
approach works across supported models, languages, and paraphrases. A small set
of safe member and Task reads stays ready for immediate use, while writes remain
under the Agent's explicit choice and current-status questions distinguish a
fresh read from older Task history. If a model provider completes a turn with
no answer or action at all, OpenMeld now safely retries once before showing a
failure.
