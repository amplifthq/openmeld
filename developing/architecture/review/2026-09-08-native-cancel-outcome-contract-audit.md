# Native cancellation outcome contract audit

## Agent Context

- Purpose: Record the compatibility and release impact of native cancellation
  outcome classification.
- Read this when: Reviewing or releasing the native stopped-outcome correction.
- Update this when: Its compatibility findings or required release scope change.
- Do not use this for: Stop authorization, execution control, or general release
  procedures.
- Source of truth: The shared outcome projector and captured publication evidence
  establish behavior; the production release owner documents govern delivery.

Status: Awaiting managed release and production acceptance.

Remove this document after the correction is released and production acceptance
is recorded in the PR, with any lasting contract decisions retained in owner docs.

The shared final-visible-outcome projector classified an authoritative native
`signal.text` publication with `remote_agent.execution_cancelled` as a failure.
Production evidence showed a successful Stop, a cancelled dispatch, and the
published text `This request was stopped.`, but `visible_failure` in trace and
`failed` in Wake progress. Classify that existing publication as `visible_stopped`.
Do not infer cancellation from message text or a Stop request acknowledgement.

## Ownership and compatibility

- `packages/schemas` remains the single outcome projector. Core Wake progress
  consumes it; execution, publication, cancellation permission, and native ledger
  finalization remain unchanged. The native ledger may retain `failed` with the
  explicit cancellation reason while the public outcome is stopped.
- No HTTP/RPC/WebSocket payload shape, enum, persistence format, Service contract,
  managed Skill, or runtime epoch changes. Existing readers already accept
  `visible_stopped` and the `stopped` progress phase for Local Agent cancellation.
- Old/new CLI, Service, Skills, Gateway, Remote Agent, and Web interoperate for
  setup, Wake, Space actions, and diagnostics. Old copies that recompute the
  projector retain the display bug until updated; they cannot change cancellation
  authority. No minimum CLI bump or migration is required.
- The changed `packages/schemas/src/` path participates in the managed Service
  source hash. Wire compatibility does not make this a Core-only release: rebuild
  and stamp the managed local components through the guarded release workflow,
  and publish the next CLI/Service 0.3.175 artifact as `available`. Do not hand-edit
  hashes or bypass release-readiness checks. The minimum required CLI remains
  unchanged because the existing wire contract remains compatible.
- Deploy Core for server progress/trace classification with the verified managed
  artifact required by the release guard. Rolling back restores the reporting
  bug without changing stored outcomes.
- No scoped architecture rule is violated: authoritative published evidence
  still determines the public outcome; a stopped execution is not a failure.

## Evidence

Regression input uses the final-visible-message shape captured through the
published CLI after the production native Stop on September 8, 2026. The test
failed before the correction and passed afterward. Adjacent cases retain genuine
failure and ordinary reply classification even with identical message text, and
existing Local Agent stopped-notice cases remain unchanged.

Production acceptance after deployment must check a new successful native Stop:
the page shows stopped, progress is terminal `stopped`, and trace reports
`visible_stopped`. Focused tests do not claim that deployment acceptance.
