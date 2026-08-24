# Repository Anti-Patterns

## Agent Context

- Purpose: Own the repo-specific "looks right, breaks in production" patterns,
  distilled from real OpenMeld incidents so no agent pays for the same lesson twice.
- Read this when: You are writing tests or mocks, status/availability logic,
  timeouts or liveness checks, error handling at a boundary, or keepalive /
  connection code.
- Update this when: An incident post-mortem shows a pattern that (a) crosses
  module boundaries, (b) is likely to recur, and (c) is not obvious from the
  owner-doc rule alone. Record it in the PR that fixes the incident.
- Do not use this for: General code style (`code-standards.md`), hard
  boundaries (`AGENTS.md`), or one-off bugs that cannot recur.
- Source of truth: This file owns the repo-specific anti-pattern list. Cap: at
  most 15 entries. To add one past the cap, merge or retire another.

Entry format: the pattern that looks right → why it actually breaks → what to
do instead. Each entry ends with the rule owner, because this file explains
symptoms; the owner doc holds the rule.

## 1. Positional fetch/auth mocks

Looks right: `mockFetch.mockResolvedValueOnce(a).mockResolvedValueOnce(b)` in
the order the code calls today.

Breaks because: any refactor that reorders, adds, or dedupes requests shifts
every subsequent response one slot over. This once produced 112 false-red
integration tests with zero real bugs — and the inverse is worse: false greens.
Ordered `for (;;)` mock loops have also caused OOM hangs.

Instead: key mocks by URL/route and drive responses from explicit mock state.
The test then asserts behavior, not call order.

Rule owner: `VERIFICATION.md` (False-Green Traps).

## 2. Reading `isPending` on a disabled query

Looks right: `useQuery({ enabled: false, ... })` and then branching on
`isPending` for a loading state.

Breaks because: in TanStack Query v5 a disabled query's `isPending` is `true`
forever, so the surface renders a permanent spinner or permanently withholds
content.

Instead: model the "not connected / not applicable" case as an explicit state
value; never infer it from a query that was told not to run.

Rule owner: `developing/clients/web.md`.

## 3. Fixtures that flatter the type system

Looks right: a hand-written fixture like `runtime: { status: true }` that makes
the test pass and reads plausibly.

Breaks because: production `runtime.status` is a string union, not a boolean.
The fixture hid the mismatch, tests stayed green, and the product compared a
string against a boolean. Hand-rolled fixtures drift from contracts silently.

Instead: derive fixtures from the shared schema in `packages/schemas` (parse a
sample through the schema, or build with the schema's inferred type) so a
contract change breaks the fixture loudly.

Rule owner: `developing/architecture/shared-contracts.md`.

## 4. Fire-and-forget keepalive

Looks right: a timer that sends WebSocket pings so the connection "stays
alive."

Breaks because: sending without verifying the response keeps a half-open
connection looking `connected` indefinitely — one dead socket made three
surfaces lie at once. The failure mode is invisible in local testing.

Instead: every keepalive needs a response watchdog (PONG deadline); a missed
deadline transitions the connection state machine, it does not just log.

Rule owner: `developing/architecture/local-openmeld-service.md`.

## 5. Silent credential/config degradation

Looks right: "if the auth header can't be attached safely, send the request
without it" — the request still goes out, nothing crashes.

Breaks because: the downstream 401 tells you nothing about the real cause. One
silently-dropped Authorization header produced a production 401 storm with a
launchd restart loop, and cost a multi-hour investigation that one loud local
error would have prevented.

Instead: when a boundary cannot do its job, fail loud at that boundary — throw
a local, named error and emit a structured log. Never forward a degraded
request as if it were the real one.

Rule owner: `AGENTS.md` (fail closed; preserve diagnostic context).

## 6. Wall-clock deadlines on live executions

Looks right: "no Wake should take more than N minutes" — fail the execution
when a fixed total timeout fires.

Breaks because: legitimate agent work can run long; a fixed ceiling kills
exactly the most valuable executions. Liveness is a freshness question, not a
duration question.

Instead: judge executions by the freshness of accepted/running lifecycle and
progress evidence. Only stale evidence — never elapsed total time alone — may
fail a running execution.

For hosted native delivery, a bounded admission watchdog may decide that no
worker ACK was established. After ACK, the same numeric delay must not be
reused as an execution deadline, tool deadline, callback deadline, or delayed
Queue failure. Persist worker progress and explicit cancellation instead.
Likewise, cap callback retry delay rather than callback attempts. Giving up a
durably stored terminal result after a fixed number of publication failures
turns a transport outage into false execution truth.

A product-defined publication-repair window may close only after execution has
already produced a durably accepted result. Space must atomically choose the
single visible outcome: an existing reply or stopped notice wins; otherwise
Space persists an explicit publication-failure notice and claims the same final
slot. RuntimeCoordinator may then project `publication_failed` while retaining
the accepted result for diagnostics. A timer or a cross-object `unresolved`
read alone is never authority to discard the result or declare failure.

Rule owner: `developing/architecture/agent-transport-contract.md`.

## 7. CSS `:hover` styling on JS-selected rows

Looks right: `hover:bg-muted` on list rows that also have JS-driven selection
highlighting.

Breaks because: two highlight systems run at once — mouse position and JS
state — so two rows light up together. jsdom tests cannot catch it; it only
shows on a real pointer.

Instead: interactive lists drive all highlight state from JS. When debugging a
visual state bug, rule out CSS pseudo-classes before instrumenting JS.

Rule owner: `developing/clients/shared-ui.md`.

## 8. Availability recomputed from convenient evidence

Looks right: the data you already have in hand — a live route, an existing
Binding, a healthy service, a completed Prepare — implies the agent is
wakeable, so derive availability locally.

Breaks because: each of those facts is real but partial; every one of them has
individually produced a wrong public status. They are inputs to readiness, not
readiness.

Instead: display Core-owned `AgentExecutionReadiness` and nothing else. If a
surface cannot reach it, show that as its own honest state.

Rule owner: `AGENTS.md` (Source-Of-Truth Rules) and
`developing/architecture/agent-transport-contract.md`.

## 9. Mocks shaped after the implementation's assumption

Looks right: the implementation reads `payload.organizations` from an
endpoint's response, so the test mock returns `{ organizations: [...] }` and
everything passes.

Breaks because: nothing proved the real endpoint sends that field. The mock
was derived from the implementation instead of from the contract, so the test
validates the code against itself. This shipped two production breakages in
one week: a Durable Object namespace stub missing `idFromName` after the
implementation switched to it, and a CLI reading an `organizations` array
that Better Auth's `/get-session` never returns — every fresh account failed
setup while 75 tests stayed green.

Instead: build mocks of external contracts from a captured real response —
paste the actual endpoint/API output into the fixture (or derive it from the
vendor's types), then write the implementation against that. When an
implementation changes which contract surface it consumes, the first test
change is re-capturing the real shape, not editing the mock to match the new
code.

Rule owner: `AGENTS.md` (Testing And Validation) and `VERIFICATION.md`
(False-Green Traps).

## 10. Additive-only specialization specs

Looks right: a work order that specializes an existing object reads as a
list of new behaviors — "make the Center Agent DM the home page, filter it
from the spaces list, forbid adding members" — and every listed item ships
correctly.

Breaks because: the specialized object inherits every user-visible surface
and every mutation of its parent, and each inherited surface that was never
explicitly adjudicated silently keeps the parent's semantics. The CA-DM
home-page batch shipped six leaks at once this way: sidebar selection state,
the embedded space sidebar, member removal, the CLI join command and access
section in the info dialog, leave/delete lifecycle actions, and the
visibility badge — none were in the spec, so none were wrong per the spec,
and all were wrong in the product.

Instead: when a change specializes an existing object (a special Space kind,
member role, profile kind), first inventory the parent's full surface —
navigation states, embedded panels, member operations, info dialogs,
lifecycle actions, badges, projections, CLI commands — and adjudicate every
row: keep, or hide in UI **and** reject server-side (always in pairs; hiding
a button is not specialization). Acceptance must include a negative
checklist ("the following must NOT appear or succeed"), not only the
positive feature list.

Rule owner: `AGENTS.md` (Task Rules).

## 11. User-writable classification fields

Looks right: a projection classifies an object from a stored field —
`spacePurpose === "openmeld_dm_space"` means "this is a Center Agent DM" —
and a family of guards keys off that classification. Every guard is tested
and green.

Breaks because: the classification input itself stayed writable through an
ordinary mutation path. Space meta PATCH could rewrite `purpose`, so one
unguarded request stripped the CA-DM identity and disabled every guard in
the family at once. The guards were correct; the field they trusted was not.

Instead: inputs to a security- or behavior-relevant classification must be
immutable after creation, or every write path to them must be guarded at
least as strictly as the behaviors they gate. When adding a guard family to
an owner (for example a Durable Object's mutation handlers), sweep all of
the owner's mutation handlers and prove coverage with a test that enumerates
the handlers — not a hand-picked subset.

Rule owner: `AGENTS.md` (Core Invariants, fail-closed) and
`developing/product/space-collaboration.md`.

## 12. Probing Cloudflare RPC methods by property access

Looks right: test `binding?.someMethod` or `typeof binding.someMethod` before
calling a Service Binding or Durable Object RPC method, then return a clean
availability error when the property is missing.

Breaks because: RPC-enabled Cloudflare stubs are Proxy objects that appear to
define every method name. Property access therefore returns a callable stub
even when the deployed receiver does not implement that method. The guard can
never detect deployment skew; only the invocation fails, and the raw receiver
error can cross the product boundary instead of the intended stable error.

Instead: check whether the binding itself exists, invoke the expected method
inside `try`/`catch`, map only Cloudflare's receiver-method-not-implemented
error to the owning stable unavailable code, and rethrow unrelated failures.
Do not invoke a side-effecting method merely to probe readiness; use an explicit
version or capability contract when availability must be known before a real
call.

Rule owner: `developing/architecture/shared-contracts.md` (compatible
cross-service behavior and stable external error semantics).

## 13. Hardcoding what should be a first-class capability

Looks right: while building a feature, a supporting capability is needed (a
scheduled job, a special inbox, a privileged caller path), so the current task
wires a one-off implementation for its own use case — often keyed to one
specific organization, profile, or client — because it is faster and passes
acceptance.

Breaks because: the one-off occupies the place where the real abstraction
belongs. Later work must migrate or route around it, the special-cased caller
becomes a hidden privileged path (a second source of truth for the same
behavior), and a capability that deserved product-level design gets buried as
an internal hack. The distance between "wired it inline" and "should have been
a first-class feature" is often one design review — but only if someone stops
to run it.

Instead: when a task reveals that a supporting concept or mechanism should be
first-class — a named concept with an owner, or a real feature with its own
user surface — pause that part of the task and give the promotion its own
scoped investigation and design. If promotion wins, build the first-class
capability and make the original task its first consumer through the normal
product surface. If promotion is deliberately declined, record that verdict in
`developing/decisions.md` instead of silently shipping the hardcoded path.
Example: the official organization's daily feedback triage was nearly wired
into code as a bespoke scheduled task before being redesigned as the general
Center Agent Routines feature, with the official triage becoming an ordinary
routine configured through the product surface.

Rule owner: `AGENTS.md` (Core Invariants: single sources of truth, model
correctness at the architecture boundary before local convenience).

## 14. Model-owned loops for multi-write operations

Looks right: ask the model to call a single-item write tool repeatedly until a
list is finished.

Breaks because: provider retries, process restarts, callback loss, and context
limits can leave an unknowable partial result. The next attempt cannot prove
which items committed, and the user may receive a success statement for a
request whose required placement or identity attribution was silently skipped.

Instead: represent the user's operation as one immutable durable manifest.
Treat the explicit request or Routine instruction as authorization, checkpoint
each item, add a provider-visible idempotency marker or reconciliation key,
classify ambiguous provider outcomes, and fail closed before the first write
when any required capability or identity mapping is unavailable. Do not impose
an arbitrary item cap or a redundant confirmation step as a substitute for
durability.

Rule owner: `developing/product/remote-agent-runtime.md`.

## 15. Letting auxiliary cleanup discovery own process termination

Looks right: enumerate every descendant before sending Stop, and let the
enumeration error abort the cleanup because an incomplete process tree seems
unsafe to act on.

Breaks because: descendant discovery is an auxiliary snapshot, while the known
process group and previously recorded descendants are already valid signal
targets. If `ps` times out before those signals are attempted, one cleanup
failure becomes an uncaught Service crash, the Service manager restarts it, and
users see availability flap even though the primary Stop target was known.
Querying PPID only after a controller exits is also too late: detached children
may already be reparented and become invisible to the old tree.

Instead: establish durable supervision evidence before controller execution,
retain discovered process IDs throughout the invocation, and make current-tree
discovery best-effort at the cleanup boundary. Always attempt the known process
group and retained descendants, then emit a structured discovery diagnostic.
Never let an auxiliary inspection suppress primary cleanup or crash the local
Service.

Rule owner: `developing/architecture/local-openmeld-service.md` (Agent
Controller process supervision).

## 16. Inferring product truth from prose or identifier words

Looks right: search a model answer, rendered document, action id, display name,
or diagnostic reason for words such as `insufficient`, `get`, `delete`, or
`publication`, then use the match to decide success, safety, authorization, or
execution phase.

Breaks because: ordinary prose can mention the same word in a different
meaning, identifiers are naming conventions rather than contracts, and copy can
change without changing the underlying outcome. A harmless sentence can flip a
successful result to failure, while an unfamiliar destructive action can evade
a fixed word list. The code becomes a second, brittle semantic owner beside the
model, action owner, or runtime that already knew the real answer.

Instead: carry the owner's judgment across the boundary as a validated
structured field or event. Persist bounded result enums when a later workflow
needs them, require action owners to declare effects, and derive diagnostics
from typed lifecycle events. If required structured evidence is absent, keep it
unknown and fail closed; never guess from surrounding words. Parsing an
schema-validated carrier is valid only when a real tool, vendor protocol, or
typed owner boundary emitted it. Delimiters or JSON written inside a model's
answer do not turn content into machine authority.

Rule owner: `AGENTS.md` (Core Invariants, Source-Of-Truth Rules) and
`developing/product/remote-agent-runtime.md` (semantic authorization).
