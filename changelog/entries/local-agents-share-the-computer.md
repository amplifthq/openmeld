---
id: local-agents-share-the-computer
title: Run local Agents in different folders at the same time
kind: fixed
areas: ["agents", "desktop"]
audiences: ["members"]
---

Local Agents on the same computer no longer wait for each other when they work
in different folders or repositories. A task that answers from the conversation,
or works in a separate copy of a project, also runs while another task edits a
folder. Tasks that edit the same Git repository, including different folders
or worktrees of it, still take turns, and a task waiting its turn is no longer
skipped by work that arrives after it.
