# Code Exemplars

## Agent Context

- Purpose: Point each common OpenMeld coding task at one reviewed, blessed example
  file to copy the shape of — so agents pattern-match against our best code,
  not against whichever file they open first.
- Read this when: You are about to write a Gateway route, a Core application
  service, Durable Object alarm logic, a CLI command, a Web query hook, a fetch
  mock, a schema parity test, or structured logging, and want the house shape.
- Update this when: An exemplar file is refactored or superseded by a better
  example — update the pointer in the same PR. If an exemplar drifts from an
  owner-doc rule, the owner doc wins and the pointer must move.
- Do not use this for: The rules themselves (owner docs own rules; this file
  owns pointers), or copying code verbatim across modules.
- Source of truth: This file owns the blessed-example index. Pointers, not
  copies. Anchors reference symbols first; commit hashes mark when each was
  last verified.

Each entry: what task → which file → why it is the shape to copy → what not to
copy from it. All exemplars verified at repo state 2026-07-03 (`99eaf8c6f`).

## 1. Gateway HTTP route (parse → validate → RPC → error semantics)

Copy `services/gateway/src/routes/rpc-http.space-diagnostic-reports.ts`.

Why: layered validation in the right order — route params via
`parseSpaceRouteParams` (400 `invalid_space_id`), body readability via
`readJsonRequestBody` (400 `invalid_json`), then business schema via
`safeParse` (400 `invalid_payload`) — with execution wrapped in
`executeRpcRoute` so success/failure logging is uniform and no business logic
leaks into the route.

Don't copy: the `issues[0]?.message ?? ...` fallback without thinking — prefer
asserting an issue exists when the schema guarantees one.

## 2. Core application service (single writer, fail-closed, explicit contract)

Copy `services/core/src/space/application/space-members-service.ts`.

Why: one service is the only writer for member changes; the input contract
(`ResolvedAddSpaceMemberInput`) makes every field required so callers cannot
half-specify an identity; persistence funnels through one upsert; failures
throw named errors instead of degrading.

Don't copy: infrastructure mediation (`parseStoredSignal` plumbing) into new
services — keep application services free of storage parsing concerns.

## 3. Durable Object alarm (poison-resistant steps)

Copy the `alarm()` method in
`services/core/src/space/transport/do/space.ts` and its
`runIsolatedAlarmStep` helper.

Why: every alarm step runs isolated with its own try/catch and structured
diagnostics, so one poisoned step cannot starve the others; per-candidate
failures are counted and parked instead of retried forever.

Don't copy: blanket isolation onto the final re-scheduling step — it is
deliberately NOT isolated, because if re-scheduling fails the platform alarm
retry is the only recovery. Keep that asymmetry.

## 4. CLI command (Human View / Agent View / explicit `--json`)

Copy the boundary split in
`clients/openmeld-cli/src/routines/command.ts`, the presenters in
`clients/openmeld-cli/src/routines/presentation.ts`, and the JSON chokepoint in
`clients/openmeld-cli/src/runtime/cli-json-output.ts`.

Why: one command path reads and validates the domain response, then selects one
of three output contracts. Human View renders terminal cards. Agent View uses
the flat presenter frames (`result`, `hints`, and `error`) without a
`schemaVersion`. Only explicit `--json` calls `emitCliJsonEnvelope`, which emits
the shared `cliJsonOutputEnvelopeSchema` frame with a silent presenter so output
formats cannot mix. Non-interactive deletion also fails before the HTTP request
unless explicit confirmation is present.

Don't copy: Routine-specific command names or payloads. Copy the three-way
output separation and entry checks. Never emit a CLI JSON envelope as Agent
View, and never route explicit `--json` through `presenter.data()`.

## 5. Web TanStack Query hook (staleTime, dedup, no render-phase refetch)

Copy `clients/web/src/query/agents/execution-readiness.ts`.

Why: explicit `staleTime` with a comment explaining the chosen window;
`refetchOnWindowFocus: false` to prevent ghost refetches; invalidation deduped
by predicate per agent instead of firing broad invalidations; refresh steps
wrapped so cancellation is detected rather than left dangling.

Don't copy: the 15s staleTime literally — pick the window from the data's real
change rate and say why in a comment.

## 6. Fetch mock in tests (state-driven, order-independent)

Copy the `createMembersResponse` factory pattern in
`clients/openmeld-cli/tests/space-join-read-model-seed.test.ts`.

Why: responses come from parameterized factories, not positional
`mockResolvedValueOnce` chains, so reordering requests cannot silently shift
every reply one slot (see `developing/engineering/anti-patterns.md` #1).

Don't copy: plain `mockResolvedValue` when the code under test hits multiple
URLs — upgrade to `mockImplementation` dispatching on the request URL.

## 7. Schema + parity test pair

Copy `packages/schemas/tests/local-components.test.ts`.

Why: parses a full, production-shaped payload through the schema (round-trip,
not a minimal stub), asserts the load-bearing fields, then checks the
human-facing formatter against the same schema values — contract and
presentation proven in one place.

Don't copy: minimal payloads. The value of the exemplar is precisely that the
fixture carries every field, including nulls and legal enum values.

## 8. Structured log emission (searchable, credential-free)

Copy `logAuthRejection` in `services/gateway/src/middlewares/auth.ts`.

Why: stable bracketed event name (`[gateway.auth.rejected]`) plus an `event`
field for query tooling; records `authorizationPresent` / `cookiePresent`
booleans instead of any credential material; flat JSON-primitive fields only;
the log call is decoupled from the HTTP response mapping.

Don't copy: nested objects into log fields — keep entries flat so production
log queries stay one-line simple.
