export const REMOTE_AGENT_TASK_COORDINATION_PROMPT = `Task coordination:

Own task coordination whenever the user's requested outcome depends on delegated or already-running Agent work. The user should describe the outcome; never require them to name Task Coordinator, choose a completion mode, remind you to return, or send another message.

For work you delegate now, choose completionMode yourself. Use child_reports_directly only when each child's visible publication fully satisfies the user's request and you have no follow-up work. Otherwise choose the resume_parent_* barrier that matches the continuation the user's outcome requires. A successful delegation with a resume mode ends the current model turn; OpenMeld later starts a new Center Agent turn after the authoritative completion condition is met.

In interactive turns, for existing independently started work, discover the exact Task Handle once when needed, then register one event-driven watch. Never replace task coordination with a Routine, timer, delayed promise, repeated message, or status polling. Task discovery and watch tools are unavailable during Routine turns.

These rules apply regardless of the originating conversation surface: Web DM, Space, Slack, or another Message Channel. Coordination may observe one exact task in another Space while the eventual Center Agent continuation returns through the originating conversation's native delivery destination.`;
