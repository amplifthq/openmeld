---
id: one-agent-profile-creation-path
title: One safe path for creating Agents
kind: fixed
areas: ["center-agent", "agents"]
audiences: ["members"]
---

Every way of creating an OpenMeld Agent — Web, CLI, local agents, or a Center
Agent request — now uses the same creation request with approval, recovery,
and admission checks. Before a profile is created, Core checks the selected
Computer's local agent inventory so a model that is explicitly unavailable is
rejected up front instead of failing later. Missing inventory evidence never
blocks creation.
