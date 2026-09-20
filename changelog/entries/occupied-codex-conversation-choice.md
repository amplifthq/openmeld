---
id: occupied-codex-conversation-choice
title: Choose how to continue when another app holds a Codex conversation
kind: improved
areas: ["local-agents", "agents", "inbox"]
audiences: ["users"]
---

When Codex Desktop or another app holds a conversation open, OpenMeld waits for
it. If the other app has not let go after five minutes, the request used to fail
with "stopped making progress on this Wake. Reconnect the computer before trying
again" — the wrong cause and the wrong next step, since the computer was fine.
Each queued request behind it then started into the same held conversation and
failed the same way.

The request now stops with the real reason, and the Agent asks what to do with
it. You can continue on a new branch, which copies the conversation up to its
last completed reply and picks the work up there, or skip the work. The other app
keeps the original conversation, and the two do not merge back together. Work
queued behind the request waits for your answer instead of failing one by one,
and the branch you choose starts ahead of that queue rather than at the back of
it.
