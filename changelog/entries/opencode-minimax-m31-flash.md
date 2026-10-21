---
id: opencode-minimax-m31-flash
title: Choose MiniMax M3.1 Flash Free through OpenRouter
kind: new
areas: ["agent-profiles"]
audiences: ["users"]
---

OpenCode Agents can select MiniMax M3.1 Flash Free through OpenRouter, with
Low, Medium, High, Xhigh, and Max reasoning options. OpenRouter access and
free-tier limits still apply. The model requires OpenCode 1.19.0 or later.

Existing Agent selections and default models stay the same.

OpenMeld Service now recognizes OpenRouter model paths correctly. When a large
model list reaches the reporting limit, omitted models are no longer marked
unavailable solely because they were left out of that list. Update OpenMeld
Service to use the corrected OpenCode model report.
