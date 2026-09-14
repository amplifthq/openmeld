# Local Agent Reasoning Stream

## Agent Context

- Purpose: Track implementation and acceptance for issue #1025.
- Read this when: Implementing or validating Local Agent reasoning streaming.
- Update this when: The implementation or acceptance evidence changes.
- Do not use this for: Production release authorization.
- Source of truth: Current source and scoped architecture owner documents.

Status: Implementation in progress.

Remove this document after the accepted behavior and evidence have moved into
the owner documents and PR.

## Outcome

Show provider-exposed thinking and reasoning inside the existing working message
bubble, preserving the execution title, elapsed time, and Stop control. Streaming
is enabled by default and controlled by the Agent owner's Privacy & Safety
preference. Final assistant responses are outside this live stream.
Center Agent and Remote Agent thinking uses the same presentation. Their existing
native publication and privacy contracts remain separate from Local Agent settings.

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

## Contract Impact Audit

- Added Service reasoning and preference frames, a capability header, an
  authenticated account preference route/RPC, and optional Web thinking status.
  Existing setup, Wake, Space actions, Stop, result, diagnostics, and Service
  recovery contracts are unchanged. No local file format or helper Skill changes.
- Old cloud does not negotiate the header with a new Service, so the Service
  sends no reasoning. New cloud sends preferences only to announcing Services;
  old Services keep their existing execution path. Old Web ignores an unfamiliar
  thinking frame without dropping the connection or final outcome.
- Roll out Web, Core/Gateway, then the new local producer. Native thinking uses
  the existing callback and bounded snapshot schema; rolling its tail does not
  change the wire shape. No execution epoch or Service contract bump is needed.
- The local component is an advisory available update. Feature-branch release
  verification must defer manifest stamping and version changes to the clean
  release worktree. This draft does not authorize a release.
- Rollback removes the new local producer before its cloud consumer, preserving
  accepted executions and existing final publication. No data migration applies.

## Validation In Progress

- Initial focused pre-push checks passed on `02bac7564` and the draft was pushed.
- Bounded local buffer and privacy-clear tests passed, as did Space thinking
  persistence boundaries and the Web stream/progress tests.
- OpenCode 1.18.30 with the existing Go GLM-5.1 connection produced 271 reasoning
  events and the requested final marker in a real adapter call. First reasoning
  arrived at 9,196 ms; the whole provider call took 13,898 ms.
- Codex 0.150.1 requires the official `turn/start.summary = auto` option to
  request readable summaries. With the production adapter option, a real GPT-5.5
  call emitted a summary and the requested final marker (11,856 ms to summary,
  12,058 ms total). These are provider-call timings, not UI transport latency.
- OpenCode's existing OpenAI OAuth connection returned a refresh 401; Go was
  used without changing or replacing credentials.
- Hosted thinking rollover, observer, and extraction checks passed (55 tests).
- Full localhost UI and real Wake smoke remain pending. The guarded Worker
  startup is waiting for machine memory while other worktree lanes remain active.
  Adapter-level success is not end-to-end product acceptance.
