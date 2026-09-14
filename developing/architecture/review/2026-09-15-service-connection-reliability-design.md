# Service connection reliability design

## Agent Context

- Purpose: Define the corrections and acceptance evidence for transient credential, connection, and execution-recovery failures.
- Read this when: Implementing the September 15 Service reliability follow-up.
- Update this when: New incident evidence changes a cause, an implementation boundary, or an acceptance requirement.
- Do not use this for: Production incident logs, credentials, a second lifecycle owner, or permission to deploy.
- Source of truth: This is a proposed implementation plan. The linked architecture owner documents remain authoritative.

Status: IN PROGRESS. Remove when the accepted corrections ship and their stable contracts are incorporated into the owner documents, or when this proposal is superseded.

## Intended result

A running Service must survive an unavailable credential store without voluntarily destroying a usable connection. Changing the selected Organization or display information must not change the Computer's account identity, restart the Service, or retarget an accepted Wake. A transport interruption must preserve local work and its durable result, and recovery must converge on the same execution.

Implementation, incremental commits, review, Staging validation, merge, scoped production release, and production/update verification are authorized in this single PR. Completion requires the evidence below; the design alone is not repair or production acceptance.

## Implementation and delivery checklist

Keep PR 1051 in Draft during implementation. Work in its isolated checkout and preserve unrelated work. Use the existing owners rather than introducing a second supervisor, execution authority, credential store, or telemetry state machine.

1. **Credential continuity and recovery.** Reproduce the combined warm-Service failure in an isolated lane. Separate credential cache identity from Organization presentation while preserving full-payload transaction fences and supported rotation behavior. Carry temporary-unavailability reasons through reporting and the carrier, coalesce credential reads, integrate retry eligibility into the existing reconnect scheduler, and decouple heartbeat from optional observations. Commit with focused auth/reporting/carrier behavior evidence.
2. **Cloud correctness and work continuity.** Correct bounded diagnostic event identity and verify deduplication. Reproduce watchdog eligibility/budget behavior at the real storage boundary; implement a scheduling correction only if the experiment confirms the defect. Preserve storage errors. Implement the scoped communication-recovery policy in RuntimeCoordinator, including Stop, replacement-process reconciliation, late results, and no duplicate execution. Commit with the matching owner-contract updates and focused state-transition evidence.
3. **Incident evidence and user recovery.** Extend existing local journals and shared contracts with bounded, redacted connection evidence; add owner-scoped recovery upload and the existing Computer/Wake diagnostic entry points. Preserve dispatch reconsideration reasons and durations. Validate offline retention, replay, authorization and privacy, and use natural product copy. Include these changes in this PR, not a deferred observability project.
4. **Review and close the candidate.** Review the complete implementation at `xhigh` effort for requested outcome, user harm, security, ownership, compatibility, race conditions, and evidence quality; fix material findings. Use `low` effort for implementation and subsequent routine execution. Complete the Contract Impact Audit, release manifest preparation, necessary Changelog entry, and one consolidated affected validation batch after scope stabilizes.
5. **Staging, current-main merge, and release.** Run the real Staging connection/Wake/recovery/update paths with isolated state and the packaged Service. Sync the latest `origin/main`, resolve conflicts, and revalidate any affected behavior. Obtain exact current-base Final Candidate evidence before merge, then use the guarded production release path for the affected scopes and explicit local-component rollout policy. Staging smoke does not replace these release gates.
6. **Production and fleet closeout.** Verify deployed versions and a real production connection/Wake/diagnostic path. Observe the local Computer's automatic update and compare online teammates' reported Service/component versions against the released manifest. Preserve active work and controlled drain; do not force-reset, restart, or reconnect other users' Computers. Distinguish aligned, still running/draining, offline, and unverifiable devices. Report merge, deployment, update and smoke evidence separately.

Commit each coherent correction with its focused validation. Do not repeatedly run broad suites during iteration. The unresolved native-helper, pre-Worker network, and platform-internal reset causes remain explicit evidence limits; they do not authorize speculative changes or block the proven corrections.

Implementation checkpoints:

- Credential/reporting/carrier correction: commit `597f0fac4`; real credential
  subprocess/concurrency checks and focused recovery/reporting tests passed.
- RuntimeCoordinator work continuity and bounded bookkeeping: commit
  `896f4e7a2`; 39 focused real-storage, Stop/replacement, recovery and diagnostic
  identity checks passed.
- Incident upload/read and privacy: four isolated local-journal scenarios and
  four real-D1/owner-correlation scenarios passed. Nineteen focused credential
  header and connection classification checks passed. CLI, Core, Gateway and
  Web typechecks passed. The existing Core fixture fix already present on
  current main is included while aligning the candidate.
- Concentrated xhigh review found and corrected four material boundaries:
  preserve the strict legacy disconnect response; coalesce optional component
  inspection for the whole Service lifetime; cap pending diagnostic writes
  during filesystem stalls; and retain the communication window when reconnect
  precedes the first watchdog observation. The latter failed before the change
  at nine minutes and 31 seconds, then passed with the original execution.
  Twenty-six focused recovery/Stop/replacement cases, six isolated journal
  cases, and two component-observation cases passed. Diagnostic upload also
  retries promptly after a subsequent reconnection. Packaged validation,
  Staging, release and production smoke remain pending.
- The guarded Staging deployment from `36ab6395b` applied the additive migration
  and deployed the compatible cloud receivers; public health checks passed.
  Signed artifact publication and real connection/Wake acceptance are still
  required. Subsequent scheduler and Trace changes only correct test fixtures.
  The Core boundary batch passed 1,537 cases; its three scheduler failures
  exposed the missing retention mock, corrected with ten focused cases passing.
  The CLI push batch passed 1,622 cases; its remaining Trace URL expectation
  was corrected, with all three focused Trace cases passing. The pre-push gate
  must complete before these commits become the remote candidate.

## Evidence and limits

### Contract impact audit

The changed boundaries are local credential reads/reporting, the Service carrier,
RuntimeCoordinator recovery scheduling, optional transport diagnostic metadata,
owner Computer incident HTTP/RPC endpoints and opt-in Wake Trace diagnostics.
Execution tokens, dispatch/action payloads, Prepare, self-rescue commands,
permission modes and managed Skill instructions retain their contracts.

Old Services continue setup, Wake, Space actions and status against new cloud
code. New Services preserve the same registration/heartbeat/execution protocol
against old cloud code; an ignored connection query parameter or unavailable
incident endpoint does not affect execution. The uploader retries independently.
New CLI trace explicitly opts into the added response field; older callers never
receive it. New CLI accepts its absence from old cloud. The existing unversioned
disconnect diagnostic response is unchanged; attempt IDs remain in cloud logs
and the separately versioned incident payload. No command, Service or execution
epoch bump is required. Stamp changed local components as `available`: old
versions can keep running accepted work, though they retain the diagnosed bugs.

Apply the additive incident-table migration before deploying Core. Publish the
new local artifact after the compatible cloud receivers. The new Web history
reader reports unavailability honestly during a receiver gap; it does not block
connection management. Prefer completing Core/Gateway receivers before exposing
that reader. Rollback removes the new reader before its receivers and keeps the
additive table; local reporting remains independent if receivers are rolled back.

The RuntimeCoordinator due index is a derived scheduling projection, maintained
transactionally with command writes and repaired in bounded pages for existing
records. Old code ignores it; it never decides execution or result authority.
The communication-recovery marker is private optional command state and is
superseded by accepted progress. Rollback restores the old timeout behavior but
does not change tokens or introduce a second execution.

Owner-contract check: these changes preserve local Service, RuntimeCoordinator,
Space and Diagnostics ownership. The scoped owner documents record the changed
recovery window and bounded private evidence contract in this PR. Production
acceptance and fleet update evidence are still pending.

The incident ran CLI/Service 0.3.204 and Core version `5ada5035-ce0b-49b6-9f1c-91508b14fbbc`. The release projection digest was independently matched to commit `d053dc1846411928fb37fe3c47deeb05c5398d0c`. Private device identifiers, credentials, transcripts, raw telemetry, and local filesystem evidence are excluded from this document.

All incident times in this section are September 15, 2026, Asia/Taipei.

| Finding | Evidence | Confidence and limit |
| --- | --- | --- |
| A temporary local read became a five-minute connection failure | Computer A: Keychain helper timeout at 00:32:42; reporting requested auth recovery at 00:32:51; Service closed the carrier; unavailable credentials entered a 300-second retry wait; Keychain recovered at 00:33:56; online at 00:38:03 with the same process | Established causal chain. The OS helper's internal reason for stalling is unknown |
| Organization context invalidates the credential cache | A disposable probe of the actual auth reader remained valid with warm credentials and unavailable storage, then became `session_token_unavailable` after only an external Organization metadata change | Reproduced defect. No cache-miss evidence establishes that an Organization change triggered Computer A's original incident |
| Another Computer repeatedly failed to open its connection while its cloud object remained responsive | Computer B's local Agent confirmed the same Service process throughout: close at 00:31:45.764, retry at 00:31:46.767, 22 attempts including repeated 15-second WebSocket-open timeouts, recovery at 00:39:49.399 after 483.635 seconds. No matching Keychain/auth recovery, Service restart, update, or actual OS sleep/wake records were found | Paired local/cloud evidence establishes connection-opening failure and excludes the observed Computer A auth-recovery sequence for this incident. The failed network/edge layer remains unknown. Cloud telemetry returned 900 invocations at sampling level 1, below the 2,000-row limit; the object continued processing queries and alarms during the message gap |
| Communication loss became a terminal Wake before a result arrived | Computer B: `runtime.progress_stale` at 00:36:12.865, visible failure at 00:36:13.135, resumed evidence from 00:39:49, `late_result_available` at 00:41:54.818 | Established execution timeline. A retained late result does not prove the final content was published |
| Late progress diagnostics failed validation | 26 warnings after recovery reported `invalid runtime coordinator execution event`; the actual builder and schema reject representative event IDs of 535–539 characters against a 512-character bound | Reproduced diagnostic contract defect. It occurred after terminalization and did not initiate the communication gap |
| Cloud storage resets occurred earlier | Two Computer A close-handler traces contain the platform's internal Durable Object storage-reset exception at 23:48:16 and 23:54:24 on September 14 | Platform errors are established. The traces do not establish whether the reset preceded the socket loss, or what caused the platform reset. No incident-time Core deployment occurred |
| Housekeeping repeatedly exhausts its application budget | 464 warnings on Computer A's object in 00:29–00:41, each in the 25-work-unit watchdog stage; two earlier complete traces contain about 1,270 storage-get spans each | Terminal-record starvation was subsequently reproduced against real Durable Object storage with terminal history preceding active work. The bounded due index corrects it; this does not establish the cause of the platform reset |

Connection generation is not a unique socket identifier. `resolveAcceptedConnectionGeneration` takes the maximum of the requested and existing value; a replacement can retain the same generation. Same-generation registrations therefore neither count reconnects nor exclude them. Computer B also has a 1006 close event at 00:39:49.031. A 1006 code identifies an abnormal close, not its cause.

The user authorized a private Space collaboration with Computer B's original local Agent. It verified the device, inspected the Service/lifecycle/dispatch journals and bounded OS history without repair, and supplied the local timeline above. The original provider process remained present throughout the communication gap. Its first final Space action was written after connection recovery; the result was sent on its first outbox attempt and acknowledged. This incident is not evidence of an already-completed result stuck in the outbox during the gap.

The Agent's second reply supplied all 22 connection attempts: 15 opening timeouts, six generic ErrorEvents, then success. It also correlated the original provider's SIGTERM with successful turn completion and the adapter's normal `session.close()` teardown. The subsequent 55.456-second controller run was existing `agent_reply_reconsideration` after relevant Space updates, replacing an unpublished proposal in the same conversation. It was not structured-action parsing repair or evidence that disconnect interrupted unfinished work. The exact triggering signal was not retained. Preserve this freshness check; record its reason, count and duration through existing dispatch diagnostics instead of treating all `controller_repair` runs as the same failure.

Gateway correlation found the successful recovery attempt reaching Auth, Gateway, and Computer B's Core object around 00:39:46–49. The bounded query found no corresponding earlier Computer B Worker invocation or Gateway rejection explaining its repeated opening timeouts. Other stream requests in the interval were correlated to other owners rather than attributed by time alone. This narrows investigation toward the path before the observed Worker handling, but does not identify DNS, TLS, local proxy, upstream network, or Cloudflare edge as the cause. `responseStreamDisconnected` describes a response stream ending during proxying; it is not an HTTP rejection or proof of which peer initiated failure. See the [Cloudflare outcome contract](https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/).

The user explicitly requested product observability as part of the correction. Native helper internals, pre-Worker connection-stage evidence, and the earlier platform storage-reset references remain unresolved. The reset references require Cloudflare's internal investigation; a support packet is prepared separately, without being sent.

## Why earlier fixes did not close this failure chain

- [PR 218](https://github.com/amplifthq/openmeld/pull/218) and [PR 222](https://github.com/amplifthq/openmeld/pull/222) bounded Keychain access and prevented background authorization dialogs. They did not prove continuity of an already-running carrier when a credential read failed.
- [PR 251](https://github.com/amplifthq/openmeld/pull/251) distinguished unavailable credentials at CLI command entry. Service reporting still flattened that reason into invalid authentication.
- [PR 442](https://github.com/amplifthq/openmeld/pull/442) handled session renewal and expiry. An unreadable credential store is a different failure.
- [PR 735](https://github.com/amplifthq/openmeld/pull/735) replaced process-lifetime Keychain suppression with a 30-second cooldown. Credential recovery did not wake the separate carrier authentication timer.
- [PR 974](https://github.com/amplifthq/openmeld/pull/974) reset retries after acknowledged connectivity and improved result replay. Its ordinary connection-interruption evidence did not exercise warm-Service credential failure together with concurrent metadata changes.

These fixes are present in the incident release. The remaining defect is an incomplete correction across consumers: a transient credential read is classified differently by command entry, reporting, and reconnect. Tests covered individual mechanisms and ordinary recovery, without the running-Service failure sequence. Preserve the useful earlier fixes while removing the conflicting interpretation.

## Ownership

Use the existing owners in [Local OpenMeld Service](../local-openmeld-service.md), [Agent Transport](../agent-transport-contract.md), and [Data and Observability](../data-and-observability.md).

| Fact or operation | Owner and boundary |
| --- | --- |
| Committed login and credential availability | Existing local auth-session owner, token store, and transition lock |
| Socket connection, heartbeat, retry | Existing Service carrier; one recovery scheduler |
| Start, stop, update, repair, account handoff | Existing lifecycle owner and operation record; OS supervision remains independent of Desktop |
| Organization membership and authorization | Existing cloud authorization owner, scoped to the affected Organization and operation |
| Accepted Wake identity and final outcome | RuntimeCoordinator |
| Local execution and unsent result | Existing Service execution carrier and durable result outbox |
| Published reply or recovery notice | Existing Space publication path |
| Computer and Agent availability | Existing Core projections; clients consume them |

No new Desktop supervisor, global recovery manager, alternative dispatch ledger, or client-derived online state is proposed.

## Change A: credential isolation and prompt recovery

Ship the following together. Narrowing the cache key alone would hide the classification defect; shortening a timer alone would preserve unnecessary disconnections.

### Separate credential reuse from context changes

`buildAuthSessionPayloadKey` currently serializes the entire payload. It is used both for the credential cache and for exact-payload transaction fences. Introduce a narrowly named credential-cache key; do not weaken the existing full-payload compare-and-write fences used by login transitions, rollback, or renewal.

The cache must contain credential material tied to the current committed login. The key retains lane/root, auth origin, client identity, token type/reference, committed login identity, and owner user ID. Changes to `activeOrganization`, organization names, user display name, or avatar cannot evict an otherwise reusable credential. Rebuild contextual session fields from the newly read metadata so the cache cannot return an old Organization selection.

Keep current expiry and scope checks. Expiry extension is not permission to use an expired or rejected credential. For legacy writers that can replace token bytes under the same reference, retain conservative invalidation using security-relevant metadata; do not drop every metadata field from the key. Any new rotation path should reuse the existing unique-reference write and atomic payload publication mechanism. Verify in-place legacy rotation before relaxing its invalidation fence. No token is copied into a diagnostic record or a second persistent cache.

Missing or corrupt metadata, a changed owner/account, login replacement, logout, and credential rotation invalidate the relevant cached identity. Late reads and refresh completions must recheck the committed identity under the existing transition fence; an old result cannot restore credentials after logout or overwrite another process's Organization update.

The traced Organization writer is `updateAuthSessionActiveOrganization`, called by the CLI Organization selection command. The reproduced effect is local metadata invalidation; it is not evidence that every cloud Organization rename automatically writes the local session file.

### Preserve distinct failure meanings

Carry typed reasons through auth lookup, credential attachment, reporting, and the Service loop:

| Evidence | Behavior |
| --- | --- |
| Verified reusable credential for the same current login | Continue requests and carrier; refresh context without rereading secret storage |
| Credential store temporarily unavailable, no reusable credential | Defer the operation that needs credentials; retain the original local reason and retry eligibility; no claim of revoked login |
| Network timeout or server 5xx | Transport/reporting failure, not invalid authentication |
| Server rejects the current attached login credential | Existing fenced refresh/revalidation path, followed by reconnect only when necessary |
| Organization access denied | Reject that scoped operation; preserve unrelated Organizations and the account-level Computer connection |
| Explicit logout, account replacement, or authoritative global revocation | Invalidate credentials and enforce the existing account/lifecycle boundary immediately |

A reporting failure may request carrier authentication recovery only if it proves rejection of the credential attached to that carrier. Neither a local read failure nor an unrelated provider/Organization 401 or 403 proves this. Preserve the existing stale-socket guard. Remove the reporting path that turns a failed local auth preflight into `requiresCarrierHandshake` and closes a usable socket.

### One recovery scheduler

Keep the bounded native helper and its cooldown. Coalesce concurrent reads of the same credential identity so background reporters cannot start competing helpers. Make temporary-unavailability retry eligibility visible to the existing carrier scheduler. A successful read or committed credential change wakes that scheduler; if no event occurs, a bounded probe at cooldown expiry provides eventual recovery. File notifications are hints to reread the owner, not identity authority.

Use the normal short reconnect policy with jitter for transient transport loss. Do not consume the invalid-login 1/5/15-minute ladder for local storage unavailability, or count one incident twice through report failure and handshake failure. Maintain at most one reconnect attempt and one native helper read per relevant identity at a time. Reset the transient backoff after an accepted registration/heartbeat, preserving PR 974's acknowledgement rule.

Keep heartbeat and task-progress delivery independent of optional inventory/reporting work. The current heartbeat awaits a full local-component status calculation before sending. Exercise a stalled component-status read; if it blocks liveness, publish the last permitted component observation or an explicit unavailable observation through the existing capability contract, while heartbeat continues. Do not infer fresh readiness from cached component details.

### Organization changes and accepted work

Selecting another Organization changes the default context for future commands. Renaming an Organization or editing profile display information changes presentation. Neither changes the owner account, device, lane, existing Binding, nor the frozen scope/destination of an accepted Wake.

Actual membership removal, role changes, organization deletion, or explicit revocation still require current cloud authorization checks. Apply those decisions to affected tasks, routes, and publication operations. They must not globally log out the Computer or disconnect unaffected Organizations. This plan does not promise that a removed member may continue publishing under revoked authority.

## Change B: cloud work bounds and reliable diagnostics

Before changing watchdog selection, reproduce retained terminal command states ahead of more due active work than one budget allows, using the real storage and RuntimeCoordinator authority path. Require forward progress across consecutive alarms. The current planner filters terminal authority while the execution loop reserves work before that check; already-recorded diagnostic decisions do not advance the watchdog timestamp.

If confirmed, correct eligibility before consuming execution budget. Bound reads as well as actions, and persist continuation progress so an unchanging prefix cannot monopolize every batch. Reuse an owner-maintained eligible/due index as a scheduling projection, with an idempotent bounded repair for existing records. Recheck the authoritative execution before acting; the index never decides execution truth. Remove terminal records from active scheduling while retaining their history and result-recovery records. Keep unrelated housekeeping stages able to advance. Raising the budget or repeatedly scanning all history is not the correction.

Fix the proven diagnostic event-size defect in the same cloud boundary. The token-diagnostic producer repeats the full execution ID inside the idempotency key, then the event builder embeds both again. Use a bounded deterministic identity at the existing event-builder/producer boundary, retaining the full execution correlation in its own field and preserving replay deduplication. Do not truncate identifiers or drop the token-safety validator. Old stored IDs remain readable; validate any identity-format change against replay across versions.

Preserve structured storage-error context, including operation, trace, platform reference, and safe retryability/overload flags. Do not turn a failed state read into a successful empty state or acknowledge an undurable write. Apply bounded retries only at an idempotent caller boundary with the same execution identity. A reset object cannot repair its own failed storage instance by retrying indefinitely. [Cloudflare's error contract](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/) requires distinguishing retryable infrastructure errors from overload and recreating broken stubs for subsequent calls.

Platform reference investigation remains separate from the application correction. No current evidence justifies a backend migration or identifies housekeeping as the cause of the observed resets.

## Change C: preserve work across a communication gap

Keep transport recovery and task outcome separate. Losing the socket does not cancel the local controller, create a new Wake, replace the execution token run, or discard a completed result. Continue local journaling and durable outbox retention. When connectivity returns, reconcile accepted execution ownership and cancellation, replay current progress, and drain the same result outbox through existing acknowledgement semantics.

The current five-minute stale-progress deadline is too short to cover the observed roughly nine-minute communication gap. Proposed initial policy: for an already accepted/running execution whose carrier is unavailable and whose termination is unproven, use a bounded **30-minute communication-recovery window anchored to the last accepted local progress**. This is a proposed product policy, not a measured optimal constant or a total execution deadline. Put it in the existing RuntimeCoordinator policy, with no independent Service/UI countdown authority.

During that window:

- The UI truthfully indicates that communication is interrupted and work is awaiting confirmation. It does not assert that the Agent is currently making progress.
- The same Profile's occupied execution remains reserved. Automatic retry cannot launch a duplicate task or duplicate external side effects.
- Fresh, accepted evidence from the current token run resumes normal running status. A socket opening by itself does not extend the window; stale replay timestamps cannot keep it alive forever.
- Explicit Stop, revocation, a real local failure, or a replacement Service session proving process-local work is lost takes precedence immediately. User Stop cannot become a resumable failure.
- A fresh Service that cannot account for the exact local task enters targeted reconciliation, rather than receiving an unconditional offline grace period.

Keep brief automatic recovery quiet by coalescing incident notifications and deferring requests for user intervention during the bounded retry period. Current status still comes from Core's existing availability projection. Do not preserve a false connected state, request sign-in without an authentication reason, or repeatedly alert for the same interruption. A sustained gap must remain visible with its last confirmed evidence and available Stop action.

At window expiry, RuntimeCoordinator records one explicit, recoverable outcome explaining that continued execution could not be confirmed. Preserve the existing terminal reason/recovery contract; do not claim that the OS crashed. A matching successful late result follows the existing `late_result_available` recovery notice and result-publication action. Never automatically rerun the original work or overwrite a visible terminal history.

The cost is slower confirmation of genuinely abandoned work and a longer hold on that Profile's execution slot. Keep Stop available and validate queued-work behavior. Existing delivery-start, explicit device-wait, user-interaction, publication, and confirmed-process-loss policies remain separate; do not globally replace their deadlines with 30 minutes.

For the already-failed incident, keep the retained result accessible through the existing recovery action. This design does not authorize replaying or publishing its private content.

## Required product observability

Implement this alongside the relevant corrections, not as an unrelated future telemetry project. Extend the existing lifecycle journal and reporting-health evidence, using a bounded shared schema in `packages/schemas`. Do not create another liveness or execution state machine.

The minimum diagnostic event contains the incident/recovery correlation, Service version, process session, connection attempt identifier, event timestamp and server receipt timestamp, operation/channel, typed failure reason, duration, retry eligibility, recovery outcome, and the last accepted heartbeat/progress timestamp when applicable. Credential cache invalidation records a category such as context-only change, credential revision, account change, or unreadable metadata; it never records token bytes, full cache keys, raw metadata, or account secrets. Record available OS resume and event-loop stall evidence as observations, not inferred root causes. Missing OS evidence remains unknown.

Preserve safe native network error codes and the last observable connection stage when the installed runtime exposes them. Correlate attempts that reach Gateway with its existing request/trace IDs. A generic ErrorEvent or open timeout remains unknown below that boundary; do not relabel it as DNS, Wi-Fi, or a deployment failure. Prefer runtime-native diagnostics before adding separate probes, and do not add credential-bearing health checks or a continuous network monitor to heartbeat.

Use a per-connection diagnostic identifier because the existing connection generation is not unique across socket replacements. It is correlation only and cannot grant execution authority. Carry it through the existing registration/diagnostic contract so the cloud's close event can be matched to the local attempt. Record local credential failure separately from a server's actual rejection and distinguish scheduled retry from a blocked helper or stopped process.

Retain events in a bounded local ring and upload bounded, idempotent incident summaries on recovery through the authenticated Service path. Propose a seven-day local retention with a 1 MiB hard cap, at most 100 structured events per incident, and a 30-day cloud summary retention, enforced by the existing retention owner. Coalesce repeated identical failures while preserving first/last occurrence and count. Upload work must have independent backoff and must never block heartbeat, execution, or reconnect. If an incident outlives retention, report the evidence gap instead of claiming completeness. A disconnected or powered-off machine cannot upload its newest local events until it reconnects.

Expose recent connection incidents through the existing owner Computer diagnostics and link relevant incident IDs from Wake Trace. Show what was observed, duration, whether recovery succeeded, and whether user action is needed. Existing team-visible Computer/Agent projections retain their privacy-safe status; organization membership alone does not grant access to another person's local incident detail. Use explicit owner-authorized sharing for support or team diagnosis. Do not upload raw Service/system logs, local file paths, conversation text, tool inputs, or arbitrary error payloads.

Update both Local OpenMeld Service and Data and Observability owner documents when this diagnostic transport is implemented: reporting health is currently local-only. This is an explicit addition of narrowly scoped cloud evidence, not permission to upload the whole local health file. Validate bounded storage, deduplication, offline replay, retention expiry, redaction and cross-owner denial. The evidence explains connectivity and execution; it cannot override either owning projection.

Automatic Service incident summaries are operational evidence, distinct from the existing user-submitted Diagnostic Report object. A report may reference an owner-authorized incident; automatic recovery must not fabricate a report submission or grant its recipients broader access.

## What to adopt from Multica

Reviewed commit: `dddbb033637d008298927be2c37867426a51a720`; this is a source review, not a production reliability benchmark.

- Adopt explicit authentication classification: [its auth probe](https://github.com/multica-ai/multica/blob/dddbb033637d008298927be2c37867426a51a720/apps/desktop/src/main/daemon-auth-probe.ts) distinguishes actual rejection from network/server/local I/O failure.
- Adopt short, jittered reconnect and immediate coalesced reconciliation: [connection loop](https://github.com/multica-ai/multica/blob/dddbb033637d008298927be2c37867426a51a720/server/internal/daemon/wakeup.go). Preserve OpenMeld's acknowledged-recovery rule.
- Adopt separate offline and task-failure policies: [runtime sweeper](https://github.com/multica-ai/multica/blob/dddbb033637d008298927be2c37867426a51a720/server/cmd/server/runtime_sweeper.go). Its three-hour offline grace is a product choice, not a constant to copy.
- Adopt eligibility filtering before bounded recovery batches. [PR 8406](https://github.com/multica-ai/multica/pull/8406) addresses records consuming recovery capacity without being executable. This is a useful failure pattern, not proof of the same incident cause.
- Retain OpenMeld's durable result outbox. The reviewed [terminal reporter](https://github.com/multica-ai/multica/blob/dddbb033637d008298927be2c37867426a51a720/server/internal/daemon/daemon.go) uses bounded retries; [issue 7470](https://github.com/multica-ai/multica/issues/7470) explicitly places the author's outbox solution in a fork, not upstream.

Do not copy plaintext token persistence, restart-based identity synchronization, or the reference backend architecture. Evaluate HTTP transport fallback only after the primary defects are corrected and remaining WebSocket-specific losses are measured. Both transports would have to use the same authority, execution IDs, cancellation and result contracts; HTTP cannot fix an unavailable credential store or the same failed backend owner.

## Acceptance and delivery

Use isolated Service state and deterministic fault injection, followed by an installed signed macOS build in an isolated lane. Do not corrupt a user's Keychain, restart an active production Service for testing, or ask users to reset working state.

| Scenario | Required observable result |
| --- | --- |
| Warm Service, active Wake, temporary Keychain failure, concurrent Organization/display update | No voluntary socket close, no false login request, unchanged execution/destination, one eventual reply |
| Lost socket and unavailable Keychain, then storage recovery | One recovery loop resumes at the credential retry boundary; no 5-minute authentication sleep; no concurrent helper storm |
| Cold Service without accessible credentials | No false online claim or credential invention; bounded retry and useful local diagnostics |
| Rotation, expiry refresh, logout/account switch concurrent with a slow read | No stale credential resurrection, cross-account request, or lost metadata update; include legacy same-reference rotation |
| Real global rejection versus Organization-only denial | Correct scope of invalidation; no access bypass and no unrelated Computer disconnect |
| Stalled reporting, component inspection, or inventory | Heartbeat/progress remain operational; failed observations remain visibly stale/unavailable |
| Short network loss, nine-minute gap, and gap beyond recovery window | Same execution resumes within policy; bounded truthful outcome after expiry; no duplicate run or lost result |
| Stop during a gap, replacement process, lost result acknowledgement | Stop wins; proven lost process is reconciled; durable result replay yields one publication/notice |
| Terminal history before active due work; storage reset during processing | Bounded reads, fair forward progress, durable continuation, and no fabricated empty state or successful write |
| Long real-format execution IDs and late progress/result frames | Diagnostic schema accepts bounded identities, duplicate events deduplicate, secrets remain rejected |
| Offline incident, process restart, recovery upload, and another member viewing it | Bounded retained evidence survives restart and uploads once; missing periods remain explicit; secrets and cross-owner details remain inaccessible |

Proposed controlled-test recovery targets: no outage at all for the warm-cache metadata case; restored network to accepted registration P95 at most 15 seconds and observed maximum 30 seconds; credential availability to accepted registration within the current 30-second cooldown plus one bounded helper/handshake attempt. Record detection time and recovery time separately. These are acceptance targets under a healthy restored dependency, not guarantees during an ongoing OS, network, or cloud outage.

Deliver three bounded implementation areas: A for the established local chain, B for proven cloud scheduling/diagnostic corrections, C for execution recovery policy and real end-to-end acceptance. Land the shared diagnostic receiver before its Service emitter, and include the owner-facing diagnostic surface in this reliability work. A and the diagnostic correction do not wait for unavailable platform-internal evidence. Do not ship a speculative watchdog change without its reproduction. Keep the design coherent while allowing separate review, deployment evidence, and rollback.

For each implementation, update the touched owner document in the same PR; audit old/new CLI, Service, Core, Gateway and Web interoperability under the existing Contract Impact Audit. Prefer additive reason/evidence fields and receiver-first rollout when shared contracts change. Preserve device IDs, Bindings, sessions and outbox data across update and rollback. Use existing controlled drain for Service updates. Follow [Agent-Native Delivery](../../engineering/agent-native-delivery.md) and [Production Release](../../engineering/production-release.md); report candidate, merge, deploy, artifact and real-user smoke separately.

Architecture check: the implementation preserves the existing auth/reporting/carrier separation and keeps indexes and diagnostics subordinate to RuntimeCoordinator. The Agent Transport owner document now defines the scoped communication-recovery policy; Local Service and Data and Observability define the bounded private evidence contract. A draft Changelog entry records the user-visible correction and remains unpublished until delivery is proven.
