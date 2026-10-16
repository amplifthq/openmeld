---
id: accurate-local-agent-setup-diagnostics
title: Clearer local Agent setup failures
kind: fixed
areas: ["agents", "center-agent"]
audiences: ["users"]
---

Local Agent candidates keep each controller's sign-in status separate. A healthy
Codex candidate no longer inherits another controller's login problem.

Working-folder checks no longer report a model-provider outage. If an Agent was
created before setup failed, the result says setup is incomplete and the Agent
may already be usable. Retry setup for the same Agent to finish configuration.
