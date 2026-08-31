---
id: ordered-recoverable-agent-work
title: Keep Agent work ordered and recoverable
kind: improved
areas: ["agent-profiles", "local-agents", "spaces"]
audiences: ["members", "agents"]
---

Each local Agent Profile now runs one task at a time and keeps later tasks in
the order they were sent. Members can see when an Agent is working or has tasks
waiting. If Usage runs out mid-task, OpenMeld resumes that interrupted task once
current Usage returns, while later queued tasks stay paused until the owner
explicitly approves them. If that task cannot be resumed safely or the one
automatic retry fails, the owner sees one clear Needs-attention item and may
skip it so queued work can continue. When Codex is already using the same local
conversation, OpenMeld keeps the Wake at the front of the queue and continues
as soon as Codex releases it instead of reporting a false failure. Stopping that
Wake ends the wait immediately, even when Codex's local writer signal is
temporarily unavailable. OpenMeld also rechecks the Agent's exact controller
and settings when an approved interrupted task is about to start, so a settings
change sends that task to Needs attention instead of running it with a different
setup. Work details also stay reliable in large Agent
directories, recovery prompts retry safely after temporary storage failures,
and finished work no longer leaves stale coordinator state
accumulating behind the scenes.
