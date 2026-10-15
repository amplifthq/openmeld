---
id: cli-node22-minimum
title: Use Node.js 22 or later for the npm CLI
kind: breaking
areas: ["cli", "setup"]
audiences: ["users", "developers"]
---

The npm CLI requires Node.js 22 or later, below 26. Node.js 24 is recommended.
The setup script and CLI startup explain how to upgrade unsupported Node installations.
Direct npm installation only warns about the required Node.js version by default;
on Node.js below 22, a native dependency can fail before OpenMeld runs. Upgrade Node.js before installing.
Standalone downloads include their runtime and are unaffected.
