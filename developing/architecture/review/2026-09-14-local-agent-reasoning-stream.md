# Local Agent Reasoning Stream

Implementation in progress for issue #1025.

## Outcome

Show provider-exposed thinking and reasoning inside the existing working message
bubble, preserving the execution title, elapsed time, and Stop control. Streaming
is enabled by default and controlled by the Agent owner's Privacy & Safety
preference. Final assistant responses are outside this live stream.

## Boundaries

- RuntimeCoordinator remains the sole execution authority.
- Reuse authenticated runtime transport and Space authorization. Thinking text
  is transient presentation data, never durable Work summary or Signal content.
- Do not retain live text in database storage, diagnostic logs, browser persisted
  caches, or Agent context. Third-party controller storage is outside this policy.
- Forward only explicit provider thinking/reasoning events. Do not infer model
  support from names, scrape private session files, or synthesize progress.
- Bound buffering and render work. Streaming must not delay heartbeats, Stop,
  finalization, or unrelated executions.
- Distinguish disabled streaming, unavailable transport support, no output yet,
  and interrupted live delivery from execution state.
- Cover Codex, OpenCode, Claude Code, Cursor, and Grok Build. OpenClaw is excluded.

## Delivery And Acceptance

Keep the PR draft during implementation and commit coherent increments. Reuse
the AICSS Thinking + Reasoning component with real event-driven state instead
of its demonstration timers and sample content.

Run focused contract, privacy, ordering, and bounded-buffer checks during
implementation. Once the scope is stable, run one organized localhost smoke
through the product entry point, prioritizing real Codex and OpenCode sessions.
Report other adapters' protocol-fixture evidence separately from paid-provider
smoke. Capture first-output timing without retaining output content.

The final Contract Impact Audit and measured smoke evidence will be added before
the implementation is declared complete.
