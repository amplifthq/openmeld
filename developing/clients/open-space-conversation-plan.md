# Open Space Conversation Entry Architecture Plan

## Agent Context

- Purpose: Preserve the deferred Plan B for making every Space conversation,
  including the Center Agent Direct Message, fast and bounded to open without
  making browser cache or entry orchestration a second source of truth.
- Read this when: Planning or reviewing Space bootstrap replacement, Space
  entry performance, entry prefetch, bounded conversation reads, partial entry
  failure, or persisted browser read models.
- Update this when: Production entry measurements change the trigger, current
  consumer inventory changes, or implementation settles a different contract.
- Do not use this for: Current production behavior, permission to start the
  migration, Space product semantics, RuntimeCoordinator execution truth, or a
  generic browser-cache policy for unrelated routes.
- Source of truth: The deferred implementation plan for the future Open Space
  Conversation entry architecture until it ships or is superseded.

Status: DRAFT AND DEFERRED — do not implement the contract migration until the
trigger and consumer-inventory gates below are satisfied and Felix approves the
work.

Removal condition: Delete this plan when the new entry architecture ships and
its durable rules have been absorbed into the routed product, architecture, and
Web owner documents; git history is the archive.

Written against: `ac8ae28b2`.

## Decision Summary

Treat **Open Space Conversation** as one product-level entry operation for
ordinary Spaces, ordinary Direct Messages, and the Center Agent Direct Message.
Center Agent entry may need to resolve or create its canonical DM Space first,
but once the Space id exists it must use the same bounded conversation-entry
read model and Web rendering path as every other Space.

The target is a versioned, bounded, read-only `SpaceEntrySnapshot` that returns
only enough authoritative data to make the recent conversation usable. Larger
member, thread, and history collections remain separately paginated read
models. Entry sections that are not required to prove access or render the
recent conversation may fail and retry independently.

This plan does not make cached browser data authoritative. Space truth remains
in the Space Durable Object, access and membership remain server-authorized,
and RuntimeCoordinator remains the in-flight Wake execution authority.

## Why Plan B Exists

The current Web entry controller starts one bootstrap query and distributes its
response into status, members, history, and threads query caches. This is useful
as a short-term aggregation endpoint, but it creates four long-term problems:

1. **One slow section delays the whole entry.** A large or unhealthy thread,
   member, or latest-update read can delay recent conversation content that was
   otherwise ready.
2. **The contract invites unbounded growth.** A Space accumulates messages,
   threads, replies, members, streams, and execution evidence over its lifetime.
   Entry cost must not grow with total history.
3. **One response has several owners in the client.** Web currently fans the
   bootstrap into several query keys, so partial refresh and failure behavior
   are coupled to a large controller instead of explicit section contracts.
4. **The current shape is not a clean persisted read model.** Persisting an
   all-purpose bootstrap would store facts with different sensitivity,
   freshness, and authority rules under one lifetime.

Plan B is therefore not a cosmetic endpoint rename. It creates a stable entry
boundary whose cost, ownership, caching, and failure rules remain correct as a
Space grows.

## Current And Target Comparison

| Concern | Current bootstrap direction | Plan B target |
| --- | --- | --- |
| Entry scope | One aggregate response feeds several client caches | One explicit, versioned entry snapshot |
| Cost | Can inherit collection and per-item work | Every entry collection is bounded and cursor-backed |
| Failure | Bootstrap failure can withhold several sections | Critical access failure blocks; optional sections retry independently |
| Read semantics | Read and repair responsibilities must be inspected together | Entry GET performs zero domain writes |
| Center Agent | Special route resolves the DM, then hands off to Space UI | Same resolution step, then the ordinary Space entry contract |
| Cache | Short-lived in-memory query cache | In-memory cache first; selectively persisted safe read models are optional |
| Invalidation | Several cache keys are seeded from one payload | One `spaceRevision` in v1 plus owner invalidation frames and explicit section refresh |
| Scale | Easy for total history to leak into entry cost | Recent pages, summaries, and query counts stay bounded at scale |

## First-Principles Invariants

1. Opening a conversation is a read. A successful entry GET must not create a
   Space, add a member, update liveness, repair history, clean streams, or write
   projections.
2. Creating or ensuring a Center Agent DM is an explicit idempotent command.
   Its concurrent generation rule must converge to one canonical Space.
3. Entry cost is a function of the requested page size, not total Space age,
   message count, thread count, reply count, or member count.
4. Access, Space identity, viewer membership, and a bounded recent timeline are
   critical. Optional member details, thread directory details, active-stream
   decoration, and other secondary sections must not make the conversation
   unusable when they fail.
5. The latest visible conversation content must not appear as a surprising
   delayed jump. The bounded initial timeline must include the latest durable
   visible item or expose an honest, stable placeholder for its reserved slot.
6. Browser cache is a stale read projection. It can improve first paint but may
   not authorize access, expose actions, decide membership, or decide Wake
   execution state.
7. Start with one `spaceRevision`. Split revisions only after measured cache
   invalidation pressure proves a second independent lifecycle.

## Target Contract Shape

The exact shared schema must be settled during implementation, but the contract
must preserve this shape:

```text
SpaceEntrySnapshot
  version
  spaceRevision
  space identity and current access projection
  viewerMembership
  recentTimelinePage { items <= limit, previousCursor }
  memberSummary { bounded items, totalCount, nextCursor? }
  threadSummaryPage { bounded items, totalCount, nextCursor? }
  activeAgentStreams { bounded current projections }
  optional section outcomes with explicit unavailable states
```

The initial response must not contain an unbounded member directory, thread
directory, complete reply history, complete signals table, or a client-inferred
permission result.

Thread previews should come from a bounded read model or batch query, not one
query per thread. Latest-visible lookup must use a bounded indexed query or a
maintained pointer. Materialized summary fields need an explicit writer,
backfill, drift detection, and repair owner.

## Center Agent Entry

Center Agent does not get a second conversation subsystem:

```text
GET current Center Agent DM projection
  -> found: open the canonical Space
  -> missing: POST idempotent ensure command, then open the returned Space

open canonical Space
  -> read SpaceEntrySnapshot
  -> render through the ordinary Space conversation path
```

Hover or intent prefetch may execute only the GET projection and read-only Space
entry. It must never create a designation, create a DM Space, upsert members, or
perform another domain write.

## Side-Effect Homes

Any side effect removed from entry must have an explicit new owner before the
old behavior is deleted:

| Responsibility | New home |
| --- | --- |
| Presence or liveness evidence | Explicit heartbeat/live-session operation |
| Expired stream cleanup | Space alarm with bounded work |
| Projection or member repair | Idempotent outbox or bounded repair command |
| Materialized thread summary backfill | Versioned migration plus observable repair path |
| Center Agent designation initialization | Explicit setup/ensure command, never GET |

## Web Client Shape

1. The route commits a non-sensitive Space shell immediately.
2. Route intent prefetch uses the same query key and query options as the final
   component.
3. Cached identity and recent content may render immediately as visibly stale
   read data while authority and freshness are revalidated.
4. Actions remain unavailable until current access and viewer membership are
   confirmed.
5. Recent timeline, members, threads, and live decorations have separate
   loading and retry boundaries.
6. Live invalidation frames trigger owner reads; they never become state.

## IndexedDB Boundary

IndexedDB is valuable but is not the Plan B authority or a substitute for Plan
B. A narrow persisted-cache implementation may land before the server contract
migration if it persists only reviewed, bounded read models.

Good initial candidates:

- Organization Space list summaries
- recent Space identity and latest-message preview
- a small bounded recent-timeline page after privacy review

Do not persist:

- session or access tokens
- Space passwords or protected-access proofs
- current permission decisions
- active Wake progress or Stop eligibility
- pending mutations, unsent content, raw diagnostics, or secrets
- unbounded message, member, or thread collections

Every persisted entry must be scoped by account, Organization, profile, and
contract version; use a maximum age and version buster; clear it on sign-out,
account change, Organization removal, and incompatible schema change.

## Trigger Gate

Do not start the contract migration from static concern alone. Start Plan B
when production evidence shows at least one of these conditions after immediate
shell, prefetch, and fixed-waste work is complete:

- healthy-network Space entry p95 remains above the approved budget and the
  bootstrap segment is the dominant contributor;
- entry latency or query count grows materially with Space history, thread, or
  member count;
- one optional bootstrap section repeatedly prevents the recent conversation
  from becoming usable;
- a safe persisted conversation cache requires a smaller versioned server read
  model than the current bootstrap can provide.

Before implementation, inventory every bootstrap consumer, including Web,
Gateway validation, CLI, local services, tests, and distributed old-client
versions. If no compatibility consumer exists, use one coordinated contract
replacement release. Otherwise add the versioned endpoint, migrate consumers,
then retire the old endpoint explicitly.

## Delivery Sequence

1. Measure click or direct load through shell paint, access confirmation, entry
   response, recent timeline paint, and interaction readiness.
2. Inventory consumers and record the compatible deployment order.
3. Define the shared versioned schema and one `spaceRevision`.
4. Build bounded server read models and zero-write integration assertions.
5. Migrate Web to route-level prefetch, section boundaries, and the new entry
   snapshot.
6. Add selective IndexedDB persistence only for approved read models.
7. Run scale, partial-failure, concurrent Center Agent ensure, mixed-version,
   and production Chrome smoke coverage.
8. Retire the old bootstrap only after every supported consumer has moved.

## Acceptance

- Clicking a Space replaces the previous page with the target shell within 100
  ms in production browser smoke.
- Entry performs zero domain writes; integration tests assert no outbox or
  domain-table writes.
- Server query count and response size remain bounded for large-history
  fixtures.
- Threads or member-summary failure cannot hide the recent conversation.
- The initial timeline contains the latest durable visible item without a late
  content jump.
- Two concurrent first Center Agent opens converge to one DM generation.
- Cached data from another account, Organization, profile, or contract version
  is never rendered.
- Current owner documents remain true: Space owns conversation truth,
  RuntimeCoordinator owns in-flight Wake execution, and Web owns presentation
  only.

## Explicit Non-Goals

- No separate Center Agent conversation architecture.
- No three-counter revision matrix in v1.
- No unbounded offline archive in the browser.
- No browser-derived access or readiness truth.
- No migration machinery for clients that the consumer inventory proves do not
  exist.
- No delayed latest-message insertion that causes the conversation to jump
  after the user starts reading.
