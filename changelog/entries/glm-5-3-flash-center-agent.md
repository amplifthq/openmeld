---
id: glm-5-3-flash-center-agent
title: GLM 5.3 Flash is the new Center Agent default
kind: improved
areas: ["center-agent", "agents"]
audiences: ["members", "admins"]
---

The Center Agent now runs new turns on GLM 5.3 Flash instead of Grok 4.6.
Organizations that did not pick a specific model follow the default on their
next turn; organizations that explicitly selected a model keep that exact
model, and Grok 4.6 stays selectable.

Center Agent settings now also describes the image path accurately: images use
the dedicated vision model before the selected primary model receives the
description.

OpenCode Agent Profiles also gain the current curated OpenCode Go, free-tier,
and Zen model lineup, including GLM 5.3 Flash on OpenCode Go, with each
model's official reasoning variants.
