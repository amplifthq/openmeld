# Composer and collaboration state query design

## Agent Context

- Purpose: Define the smallest evidence-backed correction to Web state fetching on the collaboration main path.
- Read this when: Reviewing or implementing the bounded Composer/readiness query fixes described here.
- Update this when: Implementation or staging measurements change a decision or reveal a release-blocking regression.
- Do not use this for: Current production authority, permission to implement or deploy, or a replacement runtime architecture.
- Source of truth: This document owns the proposal only. [Agent transport](../agent-transport-contract.md), [local Service](../local-openmeld-service.md), [shared contracts](../shared-contracts.md), [Agent Activity](../../product/agent-activity.md), and [Web](../../clients/web.md) remain authoritative.

Status: IMPLEMENTATION IN PROGRESS — revision 2, practical scope approved by the user.
Remove when the scoped changes ship and lasting decisions enter owner documents, or this proposal is superseded.

## 1. Decision

Fix demonstrated correctness bugs and remove duplicate work using existing query and authorization boundaries. Keep the current Space members API and current owner-only Agent API. Do not make a new backend endpoint, per-Agent cache migration, batching framework, global scheduler or full multi-tab coordination system prerequisites.

The prior revision treated useful future optimization as required architecture. That was too broad. This revision supersedes its proposed endpoint, demand tiers, new batching layer, scheduling budgets and whole-surface migration. They are not planned follow-on phases unless measurements justify them.

The goal remains reliable, quiet Composer transitions and safe send/recovery. This first implementation may retain some whole-Space reads and overlapping information in different authorized projections. That is an explicit cost tradeoff, not permission for two authorities or uncontrolled cache writers. A smaller response is not worth a new protocol until existing request duplication is removed and the remaining cost is measured.

The user authorized an isolated worktree, incremental commits, a draft PR and local smoke. Merge and deployment remain separate. Uncertain load tuning is a validation task, not a reason to expand the design.

## 2. Evidence retained from the audit

Baseline: HEAD `bb354907e2609b4b37b003bb0e4c6d9e738fe5f5` plus existing uncommitted Composer changes. Recheck the actual diff before implementing.

| ID | Evidence | Decision |
| --- | --- | --- |
| F1 | Older direct overview response overwrote a newer one in a deterministic production-module probe | Fix before release |
| F2 | Two overlapping overview refresh callers made two identical reads | Fix at the existing refresh boundary |
| F3 | `[A,B]` and `[B,A]` produced different batch queries; identical keys deduplicated correctly | Sort/deduplicate sets used for both key and request |
| F4 | Pre-reset direct read patched repopulated overview cache | Prevent obsolete cache/scope writes before release |
| F5 | Members Query has 60-second polling; Space page has its own 60-second path and conditional 2-second recovery | Remove duplicate polling in that consumer, preserve other page-refresh obligations |
| F6 | Page callback and app-shell event listener independently refresh shared Agent caches | Keep one shared-cache event consumer |
| F7 | Members read includes identity and readiness plus batched owner/route evidence | Retain for now; measure residual cost after F2/F5/F6 |
| F8 | Existing Agent batch API rejects another owner's Agent before returning results | Never substitute it for Space-authorized reads |
| F9 | Agent reader does not carry Query cancellation through transport | Wire cancellation through the touched read path |
| F10 | Cross-tab readiness event lacks account/org scope; listener ignores Space/version | Filter and deduplicate the existing event channel; no cross-tab response cache |
| F11 | Member event debounce can be postponed repeatedly | Use the existing bounded-window pattern, not a general scheduler |
| F12 | Send-time fresh members read writes shared members cache separately | Remove the incidental cache write; retain fresh admission read |
| F13 | Computer backoff reached 2/4/8/16/30 seconds with zero completed polls | Make interval evaluation side-effect free |

F1–F4 and F13 were exercised in local deterministic probes; F5–F12 are source findings, not all demonstrated production incidents. Six probes include one positive inactive-query guard. They are not six independent bugs.

Preserve: singleton browser QueryClient, request-scoped server QueryClient, active-query filtering, existing in-flight refresh deduplication, scoped persistence/account cleanup, hidden-page polling suppression, backend event coalescing and persisted Space event versions. The existing 55 focused tests passed. Query 5.102.8 matched npm latest at the audit date; an upgrade is not needed for these corrections.

## 3. Do now: one bounded change set

### A. Protect the existing targeted overview refresh

Keep targeted patching rather than replacing it with whole-overview refetch on every event. Consolidate its overlapping calls at the existing refresh function:

- One in-flight targeted refresh per overview cache instance and account/org scope. Accumulate changed IDs arriving during it and perform one follow-up read for that accumulated set after completion. A later event must not be silently dropped by merely awaiting an older request.
- Use normalized IDs and existing Query options/reader where their contracts match. Reuse Query cancellation and request deduplication; do not create an independent server-state store.
- Only patch the same live cache instance and scope that originated the read. Cache removal/recreation or account/org disposal detaches the old writer, even if the key text is identical.
- A newer full overview response also wins over an older partial read. Check the captured cache update generation before patching; if superseded, discard the partial response and retain affected IDs for one ordinary follow-up when still observed.
- Cancellation propagates through the touched API reader. Shared cross-component transport batching is not part of this change.
- Never send changed IDs for someone else's Agent to an owner-only endpoint. Filter owner-specific refresh work through the existing authorized owner data; leave collaboration updates on the Space read.
- Retry the failed read, not the entire successfully completed refresh fan-out. Retain bounded Query retry behavior and remove redundant immediate wrapper retries from the touched passive-read path. Explicit recovery mutations retain their own separate contract.

This is a small responsibility in the existing query module, not a universal refresh service. Acceptance is the observable result: one overlapping read, no obsolete write, and no missed follow-up. If an implementation proposes a generic scheduler to accomplish this, reduce it again.

### B. Delete duplicate event and polling paths

Keep the Space feed responsible for current Space-member invalidation. Keep the existing app-shell readiness listener responsible for shared owner/organization caches. Remove the page's duplicate shared-cache callback/500-ms queue once the shell listener demonstrably receives the same-document and cross-tab events.

Use one bounded coalescing window for each existing responsibility. Retain the existing 500-ms shared-cache window. Change the trailing member debounce to start its bounded window on the first event rather than resetting it indefinitely. Reuse the in-flight dedupe with a dirty/follow-up flag where an event arrives during a read; do not introduce priorities or global fairness queues.

For polling, keep the existing visible Space page's 60-second freshness callback and conditional bounded recovery window. That callback also refreshes computer/recovery facts, so deleting it blindly would lose responsibilities. Disable the redundant members Query interval for this page consumer; other consumers keep their existing policy. Keep the page's existing mutual exclusion between normal freshness and fast recovery. Do not add a Composer-specific timer or globally shorten intervals.

Verify that another observer of the same members query in the mounted page does not re-enable polling. The implementation must inspect the actual observer graph before declaring the duplicate deleted.

Scope and version filtering belongs in the existing cross-tab event contract/consumer. Include account and organization with Space, target IDs and the existing version; compare versions only within their Space/type. This is a small browser-event contract correction, not a server epoch protocol. Account changes tear down queued work. An event never supplies readiness or grants permission. No leader election, response broadcasting or shared browser cache.

### C. Correct key and backoff mechanics

Sort and deduplicate only Agent-ID collections whose API semantics are sets; use the same normalized collection for key and request. Preserve account, organization and explicit runtime selectors. Do not rewrite all application keys or convert batches into per-entity queries.

Make the computer interval callback pure. Repeated evaluations of an unchanged query must return the same delay. Base the existing backoff on actual settled read attempts or elapsed recovery time, not observer evaluations. Retain the existing cap, hidden-tab behavior and reset on meaningful evidence change. Do not introduce new polling constants in this change merely because the previous proposal listed them.

### D. Keep admission fresh without another display-cache writer

The current send path already performs an uncached members read before admission. Keep that independent fresh read and remove its incidental `setQueryData(members)`. It is not necessary to publish the whole admission snapshot into the background display cache to authorize the message.

The send outcome and normal live/query refresh update the UI. If an admission refusal requires refreshing the displayed blocker, use the existing scoped invalidation path once. Do not add a new freshness-barrier abstraction, join a pre-click cached read, or start a second cache generation system just for submission.

Keep immediate local pending feedback, stable `clientMessageId`, fresh Core admission, pinned wait target, explicit 24-hour consent, retry/reconciliation, Stop and expiry. No change to server-owned execution or publication semantics.

## 4. Defer unless measured evidence calls for it

| Defer | Why it is not needed to fix current bugs | Reopen only when |
| --- | --- | --- |
| New Space target-state endpoint / splitting the members API | Existing authorized read supports the behavior; new API adds redaction, partial-error and rollout contracts | After duplicate removal, measured whole-members latency/bytes/backend fan-out still causes visible lag or unacceptable load |
| Per-Agent cache identities and a transport batch coalescer | Normalized existing batch keys and bounded existing refresh entry resolve demonstrated waste | Measurements show overlapping batch sets remain a major cost across real consumers |
| Four-tier demand scheduler, concurrency budgets, offscreen subscription system | Adds scheduling state before the workload is known | Large real screens produce sustained pressure despite basic active/visible guards |
| Cross-tab request leader/shared responses | Event dedupe per tab is simpler and preserves auth boundaries | A small representative multi-tab test shows remaining linear cost is materially harmful |
| New retry timings and fine-grained freshness SLOs | Current timers have not been evaluated after removing duplicates | Staging shows a specific delay or retry problem; tune one owner with before/after evidence |
| Full identity/Activity/Wake-progress redesign | These are distinct owners already; no reproduced bug requires merging their implementations | A concrete regression crosses these boundaries |
| 1000-Agent or exhaustive combination stress suite | Not a prerequisite for the bounded correctness fix | Expected product scale or observed bottleneck makes it representative |
| Durable browser offline outbox | Separate persistence and user-promise decision | User explicitly requests accepted offline sending across browser termination |

Deferred work is not a backlog commitment. An acceptable staging result means stop; do not build the larger architecture anyway.

## 5. Product and architecture boundaries remain unchanged

| Fact | Owner / boundary |
| --- | --- |
| Identity, membership and visibility | Auth and Space; preserve viewer authorization and redaction |
| Computer connection | Core-owned computer/Service projection; Connected does not mean every Agent can execute |
| Agent Wakeability, plan/usage/version/configuration | Canonical Core decision; Web renders it without duplicating reason logic |
| Activity/presence | Awareness, not readiness or execution permission |
| One Wake | RuntimeCoordinator and Space progress/publication; independent of current general readiness |
| Draft/local pending message | Browser state, not proof of server acceptance |

The same Agent may appear in more than one authorized projection. Eliminate unsafe writers and inconsistent handling, not every repeated field. Do not centralize unrelated facts merely to make a diagram look cleaner.

Composer acceptance stays simple: offline eligible Wake displays “Wake when online” and “Send and wait”; current Ready switches back while preserving text/focus/intent. Reference remains Reference. A failed status read is unknown/failure, not Offline or Ready. Already accepted waiting is server-owned. Going online can run a pinned wait immediately; a Binding change cannot silently retarget it. Ordinary Send does not silently acquire wait consent.

No changes to Core readiness authority, Service lifecycle, outbox execution, quotas, provider checks, or finalization are proposed. This revision does not violate scoped architecture owner rules or require weakening them. Cancellation/browser-event plumbing may require shared local/API type adjustments; perform the contract impact audit when implementing, without introducing new HTTP/RPC payloads unnecessarily.

## 6. Practical validation: prove the fix, then measure the remaining cost

### Before considering production

1. Convert relevant audit reproductions into focused behavior regression tests: out-of-order responses, overlapping callers, cache/scope reset, full snapshot versus partial update, stable set keys, and pure backoff evaluation. Include an event during an in-flight read so dedupe cannot drop a necessary follow-up.
2. Use the existing API/permission tests plus one mixed-owner Space scenario; prove no owner-only request is made for another person's Agent.
3. Run real Composer entry paths: ordinary online send; offline -> online while drafting; explicit waiting and Reference; main/thread/Agent DM where their shared submit boundary is affected. Preserve message identity, next draft, focus and terminal outcomes. Do not repeat unrelated provider certification.
4. Exercise cancellation/access boundary during a slow request and a bounded burst of duplicate events. Verify requests settle, no old write reaches a new cache, and no request loop remains after the burst.
5. Compare a small representative workload before/after using the same fixture and timings. Start with two users, two computers with several Agents each, one active Space, and one versus three tabs. Simulate slow response, lost live notification, offline/reconnect and 429/5xx in an isolated lane.

Use deterministic local faults for ordering and retry contracts; staging for actual Web/Gateway/Core/Service integration. Test with supported isolated dev/staging state, never production credentials/devices as fault fixtures. A fixture may represent plan/version/access blockers without actually exhausting a paid provider account.

Capture only useful measures: request starts/completions/cancellations by endpoint, peak concurrent reads for the same key, visible convergence after a response, whole-members payload/fan-out cost, and draft/send outcomes. Exact same-key overlapping duplicates and stale writes must be zero in the targeted cases. Other request/latency changes are compared against baseline; do not invent a global QPS promise from these tests.

Correctness and unbounded retry/refresh loops block release. A possible cheaper members response or a small bounded latency improvement does not block if the main path works and measured load is acceptable. If staging reveals severe actual cost, address that narrow cause before release; do not ship a known harmful load pattern and call it later optimization.

### After staging is acceptable

Use the normal guarded release lane only when separately authorized. Observe real error rates, request volume and state lag during the initial rollout; rollback the bounded Web change if a regression appears. Production observation is for residual optimization, not the first validation of permissions, duplicate execution, stale writes or message loss.

Retain a lightweight scenario inventory for future findings: own/other owners, multiple Bindings, missing events, scope changes, quota/version/access, Activity, retry/response loss, wait/cancel/expiry, persistence unavailable, large screens and many tabs. Do not require their entire cross-product or every proposed optimization before this small change can ship.

## 7. Scope, migration and stopping rule

Touched responsibilities: existing Agent readiness query/refresh module and API cancellation plumbing; Space feed/page duplicate refresh wiring; app-shell readiness listener/event scoping; computer polling callback; send-time members cache write. Update adjacent tests and owner notes only as behavior requires. Do not migrate every page or rewrite all queries.

Each responsibility has one cutover in its existing code path. Remove the old callback/timer/writer in the same change that takes over its obligation. No production dual-read shadow mode, new data migration, feature-flag framework or protocol rollout is required. Keep changes coherent and revertible; normal code rollback is sufficient.

Stop after the reproduced bugs are fixed, duplicate responsibilities are removed, and representative local/staging checks pass without meaningful performance regression. Do not reopen the design for speculative load tuning.

This resolves the previous four design gaps by reducing the work:
- No new Space endpoint to specify now.
- No new cross-component batch cancellation/scheduler contract.
- No requirement to guess new production polling budgets before implementation.
- No whole-surface cache migration; only explicit existing-path deletions and regression checks.

## 8. Evidence status

### Approved unread-history follow-up

Warm conversation preload previously returned without reading updates, leaving
the mounted reader to catch up after navigation. The approved follow-up reuses
the existing history cache and authorized updates endpoint. Router intent warms
one contiguous page; the Messenger sidebar prioritizes up to five warm unread
conversations with two concurrent jobs. Unchanged unread revisions do not repeat
work, and a changed revision during a read schedules a trailing read. Cold bulk
hydration, new polling, backend changes and a second message store are excluded.

The shared updates Query deduplicates in-flight page reads. The subscription
acknowledgement waits for any earlier read and issues a fresh one, preserving
the existing read/live barrier. Preload never advances a read cursor, changes
scroll position or enables a mutation. Late responses cannot recreate removed
history. A one-page prefetch does not claim a large gap is fully synchronized;
normal mounted catch-up continues from the contiguous cached tail.

Seven new deterministic cases cover the query/scheduler boundary and sidebar
visibility/online wiring. Together with existing history, feed, route preload
and sidebar regressions, 110 focused tests passed. The fresh local stack was
attempted again and remained blocked by startup memory/headroom; only this
task's queued launcher was cancelled. No new real-browser timing or screenshot
evidence is claimed. This Web-only extension does not weaken the architecture
rules or change server, Service, CLI, read-cursor or execution contracts.

Implementation recheck against origin/main `7cf0b014d` corrected F5: the mounted
Space members observer already uses `enabled: false`, so its interval does not
generate duplicate polling. No polling deletion is needed there. The existing
page refresh remains intact. Another owner's Agent can appear in an organization
overview, so foreign or unknown ownership uses that existing authorized read
instead of the owner-only batch endpoint. No new backend endpoint is introduced.

Issue #949 is included in the same Composer boundary: missing members prevent
preparing structured mentions, while plain text does not require that snapshot.
Loading, failed loading and message-history errors must not be conflated. The
reported recovery after waiting does not by itself establish a production cache
root cause. Deterministic loading/retry/recovery checks protect the draft and
prevent the old post-click warning from being the normal loading experience.

Contract impact: the batch API gains an optional local AbortSignal, excluded from
the serialized request. Browser invalidation messages add account/organization
scope; older unscoped browser messages are ignored and ordinary page freshness
still reconciles state. HTTP/RPC bodies, server event frames, Service/CLI/Skills
contracts, execution identity, wait expiry and Stop authority are unchanged.
Existing local components can continue setup, Wake, actions and diagnostics.
No contract epoch or local component release is required for this Web change.
No scoped architecture owner rule is weakened.

The design revision originally had only six audit probes and 55 existing tests.
Implementation is now tracked in draft PR #951. Its first clean push passed 124
Web files (1,443 tests), 26 Agent runtime files (299 tests), 27 API client files
(200 tests), and 115 schema files (1,444 tests). These are the repository's
affected pre-push checks, not an end-to-end delivery certification. Web TypeScript,
dependency builds, docs lifecycle and Changelog validation also passed.

Fresh authenticated localhost smoke, screenshots, real Service reconnect/reply,
and representative multi-tab network measurements remain pending. The isolated
stack has not started because the local resource manager reports insufficient
memory/headroom. No other task's environment was stopped or resource limits
overridden. Keep the PR draft; do not substitute old-lane screenshots or simulated
UI outcomes for this branch's missing acceptance. No staging or production
deployment has been performed.

Local reproduction files: `dev-tmp/query-audit/readiness-races.test.ts`, `race-results.log`, `existing-contract-results.log`. Run from `clients/web` with `pnpm exec vitest run --config ../../dev-tmp/query-audit/vitest.config.ts ../../dev-tmp/query-audit/readiness-races.test.ts`. Probes use controlled read-boundary contract slices and real Query instances; they reproduce defects, not full network behavior.

The broad initial audit remains useful evidence, but its larger proposed architecture is no longer the delivery scope. Source checks and doc lifecycle validation support this document; production readiness comes only after the bounded implementation and its checks.

References: [TanStack targeted invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation), [important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults), and installed Query 5.102.8 source. [Staging isolation](../../engineering/staging-environment.md) and [agent-native delivery](../../engineering/agent-native-delivery.md) govern subsequent validation/release work.
