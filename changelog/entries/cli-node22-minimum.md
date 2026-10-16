---
id: cli-node22-minimum
title: Use Node.js 22, 24, or 25 for the npm CLI
kind: breaking
areas: ["cli", "setup"]
audiences: ["users", "developers"]
---

The npm CLI requires Node.js 22, 24, or 25. Node.js 24 is recommended.
npm-based setup and CLI startup explain how to select a supported Node.js version.
Node.js 23, versions below 22, and versions 26 or later are unsupported. Direct npm installation
only warns by default; native dependency installation can fail before OpenMeld runs.
Use Node.js 24 before installing the npm CLI.
The standalone OpenMeld CLI includes its own runtime. Default macOS Web setup
installs it as a managed binary and does not require a Node.js upgrade.
