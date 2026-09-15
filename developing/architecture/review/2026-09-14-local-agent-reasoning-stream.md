# Local Agent Reasoning Stream

## Agent Context

- Purpose: Track implementation and acceptance for issue #1025.
- Read this when: Implementing or validating Local Agent reasoning streaming.
- Update this when: The implementation or acceptance evidence changes.
- Do not use this for: Production release authorization.
- Source of truth: Current source and scoped architecture owner documents.

Status: Implemented; localhost acceptance completed for Codex and OpenCode.

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

## Validation

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
- The guarded localhost lane eventually started after memory became available.
  Normal browser sign-in, CLI device approval, and isolated Service setup were
  used; no authentication or execution projections were manually edited.
- Codex and OpenCode were created through the public CLI and Woken in a real
  Space. Both produced live reasoning and published their requested final
  markers. Public Service traces report `visible_reply` and `reply.delivered`.
  OpenCode's live bubble was visually inspected with its title, timer, Stop,
  expanded reasoning, and a 180 px scrolling viewport. First reasoning appeared
  at approximately 9.6 seconds for OpenCode and 13.4 seconds for Codex; these
  include provider processing and are not isolated transport latency metrics.
- Smoke exposed repeated unchanged preference frames clearing live content.
  A failing regression test reproduced it; the receiver now only notifies on an
  actual value change. Snapshot reconciliation also preserves transient status
  and expansion phase. Focused regressions pass, and the refreshed Service's
  continuous OpenCode output was observed beyond 90 seconds.
- Browser checks covered default-on, saving off across reload, disabled working
  notice, manual collapse/reopen, and keeping an upward reading position while
  new text arrived. Turning the setting off from another tab cleared existing
  live text while execution continued. Stop reached an explicit stopped outcome.
  Completed replies and stopped tasks retain no live reasoning in history.
- Center Agent completed a real local chat request and published its marker;
  this run did not capture a visible reasoning phase. Center/Remote reasoning
  extraction and rolling-tail behavior have protocol-test evidence, not separate
  paid-provider UI smoke for every model or Remote Agent connection.
- The shared Switch needed an explicit accessible name, discovered and verified
  in the browser. The local setting now labels the rendered switch directly.
- The isolated Worker/Web/Service lane and test tabs were stopped after smoke,
  preserving source and test data and releasing resources for another task.
- Scoped architecture review: execution, routing, identity, and publication
  authority remain unchanged. The default-on transient-text exception is recorded
  in the owning contracts; reasoning is not a second execution-state authority.
# Agent activity UI follow-up

The shared profile popover now shows the existing Core-owned task status and
recorded task activity time. The detail page and conversation list use the same
runtime overview. Owner-disclosed current work links open the corresponding
Space; the current projection does not provide an exact Wake message anchor.
An assigned native conversation is configuration, not evidence of the current
Wake destination. Session occupancy copy no longer claims another task is
running. Issue #1023 remains open for the separate writer-ownership problem.

On September 14, the isolated localhost lane exercised a real OpenCode Wake:
the live reasoning bubble, active-task popover, last task activity timestamp,
detail-page Space link, and active conversation row were visible together.
Following the detail link returned to Welcome Space. Stop completed with the
explicit stopped outcome and removed live reasoning. This supplements the
earlier Codex and OpenCode stream smoke below; it does not establish that an
idle Codex App session can be reclaimed.

Focused UI validation: 140 tests passed across the profile card, task navigation,
conversation sidebar, and Wake progress suites. Web typecheck and scoped Biome
checks passed. No new polling endpoint or per-conversation query was added;
visible consumers share the existing 30-second runtime overview query. Native
session inventory is no longer fetched merely to render Agent detail activity.
