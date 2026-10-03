---
id: delegated-private-github-review
title: Delegate private GitHub reviews to your Remote Agent
kind: new
areas: ["center-agent", "agents", "apps"]
audiences: ["members"]
---

When the Center Agent records a delegation to your personal Remote Agent, that
Agent can read GitHub pull requests and files and prepare a working copy of the
requested source version using your permitted GitHub connection. Access is
checked again during the task, and account selection stays explicit.

This path supports reading and checkout. It does not grant GitHub write access
or store GitHub credentials in the Agent's Computer.

GitHub App connections also support working-copy downloads. Private file
responses withhold download links that contain temporary credentials; the
Agent still receives the file content and its GitHub source link.
