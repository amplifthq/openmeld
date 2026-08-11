# Production Smoke / Deployment Record

> Every production deploy: before deploying, record the "previous verified SHA"
> (rollback button = checkout that SHA, rebuild, redeploy; this repo has no
> automated rollback tool). After deploying, run the
> [production-smoke.md](./production-smoke.md) baseline and record results.

## Record Format

```md
## <UTC time> - <one-sentence intent>
- Previous verified SHA before deploy: auth=<sha> core=<sha> gateway=<sha> web=<sha> local=<version>
- Deployed content: <commits>
- Baseline result: 1) cold start pass/fail 2) Wake pass/fail 3) three surfaces pass/fail 4) offline Wake pass/fail 5) e2e pass/fail
- Drill result: <phase-specific additions>
- Exceptions and handling: <...>
```

---

## 2026-06-12T08:20Z - 0.7.61 Release + Full-Service Deploy (kind-scoped membership commands)

- Previous verified SHA before deploy: 0.7.60 rollout (`91f541c4c` era); this
  deploy @ `455c57a2b` (main); local 0.7.60 -> 0.7.61.
- Deployed content: `d695783ab` (same-account Space profile membership: shared
  profile-add planner, kind-scoped add-agents/add-human-profiles commands, Web
  Add Profiles panel, membership != readiness boundary) plus parallel
  convergence commits (workers suite fix, daemon route logs, unified
  availability display) plus `455c57a2b` (manifest 0.7.61).
- Cloud: openmeld-auth-prod `33bdf7e8` / openmeld-core-prod `adb451f0` (Space Index
  backfill proof pass) / openmeld-gateway-prod `4f580324` / openmeld-web 43 assets. npm
  publish `openmeld@0.7.61` had no OTP blocker; local
  `npm i -g` plus `openmeld service update` upgrade chain validated.
- Baseline result:
  1. Cold start pass - after kickstart, status correctly reported
     `version_outdated` (expected 0.7.61) / `bundle_content_drift` (manifest
     delivery active); after `openmeld service update`, daemonVersion=0.7.61,
     runtime running, anomalies cleared, no attention.
  2. Wake main loop pass - smoke Space Wake `Claude Code Agent`; **21.7s** to
     real reply "pong 0.7.61 rollout smoke" with correct replyTo; trace
     correlation complete (dispatch `8a2eec58` -> replySignal `8cac5438`).
  3. Three surfaces pass (CLI surface) - service status zero anomalies; space
     status `latestVisibleUpdate` = that pong; https://openmeld.invalid 200. Browser visual
     confirmation not done.
  4. Offline Wake pass - after `service stop`, sent Wake. Trace was explicitly
     visible (`final_visible_message.projection_pending`, no hang). After
     `service start`, that Wake was automatically redelivered and got real reply
     "pong offline drill 0.7.61 - Wake received and processed after coming back
     online" around 2m56s after message visibility. Parallel evidence: another
     `@Felix's Codex(wake) test` during the interval received "Test received."
     30s after recovery.
  5. e2e paused - `gateway-http-smoke` requires an `openmeld-dev` logged-in session
     (interactive login), which this environment cannot complete
     non-interactively. Same treatment as 0.7.59; pending.
- Exceptions and handling: no rollback. One tool-side false alarm (polling
  script timed out before redelivery landed) was corrected with direct history
  evidence.

## 2026-06-11T17:00Z - Baseline State (No Deploy, Phase 0 Evidence)

- Current production: all service SHA `963b8f4aa` (main HEAD), local 0.7.57
  (bundle 0.7.57-1781188472201).
- State: WS heartbeat healthy, but every ~26s DaemonHub kills it with 1008
  `session_not_found` and reconnects (generation +14 in 6 minutes); local lease
  `heartbeatAt` always null (mirror write broken); `openmeld service status` reports
  `service_repair_recommended` while cloud route is online; uplink
  registry/proofs submit intermittently `fetch failed`. Mechanism details in
  [facts.md](./facts.md) evidence section.
- Conclusion: this is the repair target and serves as Phase 1/2 before baseline.

## 2026-06-11T17:47Z - Deploy Core (ServiceRuntime Durable Records, Kill Hibernation Kill Cycle)

- Previous verified SHA before deploy: all services `963b8f4aa` (incident
  baseline); this deploy core @ `a7e409c9d` (wrangler version a97f99d9).
- Deployed content: `c97c04b58` (snapshot machine -> ServiceRuntime records)
  plus two fixture fixes.
- Validation: **80 seconds after deploy, this machine got its first successful
  persisted heartbeat in history** (`heartbeatAt` 17:48:39Z -> 17:51:04Z kept
  advancing); post-deploy core tail had **0 occurrences of 1008
  session_not_found** (pre-deploy around once every 26s); route stable online.
- Baseline smoke: 2) **Wake main loop pass** - Wake `Claude Code Agent` in smoke
  Space, real reply "pong 18:05Z" in 33 seconds (replyTo correct). 5) e2e
  pending. 1/3/4 covered in 0.7.58 entry.
- Exceptions and handling: no rollback.

## 2026-06-11T18:08Z - Local Component 0.7.58 Release + This Machine Upgrade

- npm publish `openmeld@0.7.58` (no OTP blocker); manifest stamped
  (cli/service=available, skills=ok) @ `4cd25ba9b` (Main Confidence green).
- Content: credential preflight kills 401 storm; live route suppresses stale
  repair warning; connection state machine
  (starting/connecting/online/degraded(reason)/stopping).
- This machine upgrade: `openmeld service update` returned misleading
  `start_blocked/cleanup_required`, but the bundle actually switched to
  `0.7.58-1781201331776` and ran healthy (anomalies cleared). Carrier wording
  issue recorded for Phase 2 cleanup.

## 2026-06-11T18:12-18:25Z - Failure Drills (0.7.58 + ServiceRuntime Records)

| Drill | Result | Data |
|---|---|---|
| Kill process (`launchctl kickstart -k`) | Pass | KeepAlive restarted it; heartbeat recovered in 40 seconds (18:12:06 -> 18:12:46), zero manual action |
| Credential failure (corrupt `session.json`) | Pass | `openmeld auth status` immediately showed `missing` with visible reason; service refused to run with bad credentials; after restore, recovered in 71 seconds (18:14:37 -> 18:15:48), auth valid |
| Network failure (gateway to blackhole) | Pass, with shape note | Failure visible: service exits during startup + launchd restart loop (not degraded residency; state machine covers post-connect interruption, startup residency recorded for Phase 2 cleanup); after restore, recovered in 56 seconds (18:18:52 -> 18:19:48) |
| Deploy disturbance x2 (core redeploy = all DO restart) | Pass | Deploys completed in 14s/12s; route recovered online and generation only +1 (no kill cycle); quantitative gap measurement limited by status command ~15s sampling, qualitative conclusion: no churn, one socket replacement, automatic convergence |

Additional finding (recorded for Phase 2 cleanup): after service restart, full
catalog scan across 40+ profiles takes around 2-3 minutes before profile
re-registration completes (route.not_registered during that interval). Test
profile garbage amplifies restart recovery delay; recommend cleanup plus catalog
incrementalization.

## 2026-06-11T18:26-18:40Z - Wrap-Up Baseline Smoke (0.7.58 + Two Core Deploys + Three Drill Rounds)

| Item | Result | Data |
|---|---|---|
| 2) Wake main loop (second) | Pass | 18:26:15 sent -> 18:26:40 real reply "pong final-check" (**25s round trip**) |
| 4) Offline Wake | Pass (correction: redelivery succeeded) | Stop service at 18:28 and send Wake -> trace intermediate `delivered=false projection_pending` (visible reason) -> service recovered at 18:31 -> **18:33:10 automatic redelivery, real reply landed** (register-triggered head-waiting recovery, at-least-once closure exists). Phase 3 residual improvement: user-visible in-Space intermediate status while offline |
| 1) Cold start | Pass, with note | Service automatically recovered after kickstart; `openmeld service run` sometimes had misleading `start_failed` copy while actually healthy (carrier copy cleanup +1); profile re-registration around 2-3 minutes after restart (40 profile catalog scan) |
| 3) Three surfaces | CLI perspective pass / Web perspective HANDOFF | CLI route online + no false attention warning; Web surface not reachable overnight, see HANDOFF |
| 5) e2e script | N/A | Script bound to `openmeld-dev` dev-lane independent session and needs interactive login; not applicable to prod. Real user behavior smoke covered more |

## Observation Window Verdict (18:31:34Z -> 19:02Z, 30 Minutes)

- Log growth: **225 bytes** (incident period comparison: 26.5 MB error loop).
- `authentication required`: **0** (incident period 135+ times; credential
  preflight works).
- `internal error`: **0**; CLI banner spam: **0** (incident period one line per
  retry).
- `fetch failed`: 1 occurrence (registry submit through local proxy path, known
  environment mechanism M-B; bounded, classified, no spam; proxy bypass moved to
  HANDOFF).
- Heartbeat stayed fresh throughout (adaptive idle grew to around 60s interval,
  as designed). Quiet = healthy proven by fresh heartbeat, not a silent hang.
- One natural proxy blip occurred during the window (18:42:20 single-sample
  `not_registered`, generation 1 -> 2): service auto-reconnected and
  **recovered within one sample and remained stable**. Under old code the same
  event produced a permanent 26s kill cycle.
- **Verdict: pass** (19:02Z endpoint measured same counts; only exception was
  known single network blip unrelated to code).

## 2026-06-12T02:32-02:43Z - Morning Campaign Close: Batch Route Lookup + 0.7.59 Deploy Acceptance

- **Deploy**: core @ `5bdd3dac8` (`/lookup-routes-batch`, 40 DO calls -> 1)
  version `17d1ce3e`; local 0.7.59 (idle dead connection retry) published and
  upgraded; service running bundle 0.7.59.
- **Web real smoke (Felix's real Chrome, Playwriter sampling)**:
  - Before fix (02:05 window): reply-readiness 140 samples with **27 flips**,
    DO reported "Durable Object is overloaded", `route.not_registered` storm
    1814 lines / 90s.
  - After fix (02:37-02:43 window): **7/7 all ready, 0 flips**; polling volume
    itself dropped from storm level to 7 (self-exciting loop broken).
  - Page terminal state: OpenMeld Service **Connected** stable; Agent Profiles
    **40 Available / 0 Checking / 0 Offline / 3 Unavailable** (morning
    comparison 0/40/0/3).
- Morning three-layer root cause fully recorded: v2 TTL margin (90s vs 66s
  heartbeat) -> 200s; `lookupOwnerService` de-socketized; v3 web readiness storm
  overloaded DO (causal proof: stopping page self-healed in 54s) -> batch
  convergence; first fetch after idle "always fails" (proxy silently reclaims
  keep-alive) -> one local retry.
- Residual observation: device card "Last seen" timestamp still old (D1 registry
  lastSeen field path). Recheck after 0.7.59 evidence sync runs a few cycles.

## 2026-06-12T03:4xZ - Wrap-Up Round (Waves 1+2) Deploy And Acceptance

- Deploy: core @ `91f541c4c` (last-seen live heartbeat override, stale-evidence
  downgraded to diagnostics); local 0.7.59 -> 0.7.60 (startup network tolerance,
  90s startup window, update recheck, journal persistence, trace copy).
- `openmeld service update` returned truth for the first time on its own release:
  `ok:true, completed, running` (recheck fix active).
- Test profile cleanup: 43 -> 9 (34 deleted, 0 failures, Felix-approved pattern
  list).
- Gated items closed: lease arbitration validated as already minimal (no
  change); current_device_target merge approved into dedicated workstream;
  resolver full collapse re-evaluated as inappropriate risk and changed to
  precise stale-evidence downgrade.
- Restart recovery timing and final Wake are in the next entry.

## 2026-06-12T09:30-10:10Z - Agent Profile Deletion Lifecycle (B/A/C Layers) Production Acceptance

- **Background**: Felix found deleted test profile "Felix Codex Session Dogfood"
  still stuck in Space members, with misleading "Connect local agent" card.
  Investigation confirmed profile deletion removed only the auth row; nobody
  cleaned Space DO `space_members`. Authoritative `profile.not_found` was
  flattened in display chain into generic Unavailable + repair CTA. Web and CLI
  deletion cleanup were inconsistent (Web cleared Binding; CLI cleaned nothing).
  `space_index_memberships` projection showed the residue across **7 Spaces**.
- **Deploy**: commit `c83e026b6`; core version `d5a3219c`, auth `d122cb7e`
  (`openmeld-core-prod#ProfileLifecycleEntrypoint` binding active), web `275a8306`.
- **B display terminal state (web real smoke, Felix real Chrome)**: dogfood
  member card changed from "Unavailable + Connect local agent" to **"Removed" +
  "This agent profile no longer exists." with no repair button**. Control group
  Available/Offline states unaffected (screenshot evidence).
- **A unified deletion orchestration (CLI full-chain smoke)**: one-off profile
  `agt_bc4a7534...` through `openmeld profiles create -> space add-agents ->
  profiles delete --force`; Space history immediately showed system notice
  **"OpenMeld Smoke Deletion Lifecycle R2 20260612 was removed from this Space
  because its Agent Profile was deleted."** Member was automatically removed by
  openmeld-system actor.
  - Key finding: first smoke proved `openmeld_profile_space_history` **does not cover
    owner-add path at all** (history had 0 rows after add-agents). Fan-out source
    changed immediately to `space_index_memberships` projection (Space truth,
    verified to include owner-add row); owner doc updated accordingly.
- **C lazy reclaim backstop**: snapshot read only records evidence (read does not
  mutate); DO background alarm removes and notifies only after two independent
  observations at least 30 minutes apart and rechecking auth still
  `not_found`; creator is never auto-removed. Existing dogfood residue will be
  cleaned through this path (first evidence at 09:54Z, second-window validation
  in later entry).
- Tests: core workers suite 108 files / 1231 cases green (including new
  space-deleted-profile-reconcile); agent-runtime 160, agent-profile 42, auth
  worker 47 green.

## 2026-06-12T10:25Z - C-Layer Lazy Reclaim Final Acceptance (Dogfood Residue Auto-Cleanup)

- Timeline: 09:54Z first members read recorded authoritative `not_found`
  evidence (same read as B acceptance); 10:17Z second independent read (count=2);
  10:24Z threshold met, DO background alarm rechecked auth still `not_found` and
  auto-removed.
- Terminal state (web screenshot evidence): Myco Space members 15 -> **14**,
  "Felix Codex Session Dogfood" disappeared from member list; conversation flow
  showed OpenMeld System notice **"Felix Codex Session Dogfood was removed from this
  Space because its Agent Profile was deleted."** Other members
  (Available/Offline) unaffected.
- Two projection convergence fixes made during this window:
  `projectCurrentSpaceIndexSnapshot` after reconcile removal (missing write left
  D1 membership projection active; R3 smoke verified status=removed/openmeld-system
  after fix); `removal_reason` semanticized to `agent_profile_deleted`. Final
  core version `4732e0c1`.
- Verdict: B/A/C layers all passed production acceptance. Residual rows for this
  profile in the other 6 Spaces will be auto-cleaned by the same mechanism after
  each Space is read twice with authoritative `not_found`.

## 2026-06-12T13:25Z - One-Time Global Ghost Member Sweep

- Scope: active rows in `space_index_memberships` whose profile no longer
  exists. Before sweep, 105 deleted profiles (85 agent + 19 human + 1 same-day
  smoke residue) occupied 164 rows.
- Execution: `admin:profiles:sweep-deleted` (discovery: D1 join query;
  execution: temporary token-gated bridge worker -> production
  `ProfileLifecycleEntrypoint.reconcileDeletedAgentProfile`; each Space follows
  the normal removal path plus system notice plus projection republish; bridge
  deleted after use).
- Result: **105/105 reconcile succeeded, 0 failures; 119 Space member removals;
  48 skipped_creator** (deleted profile is the Space creator and is protected by
  "creator is not auto-removed" rule).
- Terminal counts: non-creator ghosts **0**; remaining 43 rows all
  `space_creator` (8 agent + 35 human). Semantically this is the separate
  question "should a Space whose creator was deleted be deleted as a whole?"
  owned by Space deletion and awaiting Felix decision.
- Same batch deployed: human kind included in deletion cleanup (core 95a33bbf /
  auth 17c1067a), reconcile noop republishes snapshot to fix historical
  projection drift, and membership write points auto-mark dirty for projection.

## 2026-06-12T13:45-14:00Z - Creator-Orphan Space Sweep (43/43, Ghost Members Globally Zero)

- Decision (Felix): creator-deleted Spaces should follow the **normal Space
  deletion path** and be removed as whole Spaces ("delete them through the normal
  Space deletion path").
- Scope: dry-run listed 43 candidates, all clearly test residue
  (`test-prod-*`, `felix-test-*`, `dogfood-*`, `canary-e2e-*`, `x-demo`,
  `welcome-to-openmeld`, etc.); the only one with `livingHumans=1` was also
  `test-prod-2-space-0509`. No suspected real production Space.
- Execution: new script `services/auth/scripts/orphaned-space-sweep.mjs`.
  Discovery through D1 (`space_creator` ghost row joined with undeleted
  `space_index_spaces`). Deletion through production path: temporary bridge
  worker -> `openmeld-core-prod#GatewayRpcEntrypoint.deleteSpace` -> Space DO
  `authorizeSpaceDeletion` -> deleted projection + session close + SQL cleanup +
  `storage.deleteAll`. **Authorization policy was not bypassed**. Identity was
  constructed according to policy:
  - human-creator (35): actor is deleted creator's profileId + owner snapshot
    (policy: only creator may delete human Space) -> 35/35 succeeded.
  - agent-creator (8): first round failed because the owner test account's human
    profiles were all also deleted and no living owner existed for comparison.
    Used explicit-confirmation branch reserved by policy: human actor
    (Felix's own profile `326d1bf2...`, auditable) plus
    `approvedAgentCreatorProfileId`, without ownerUserId claim -> 8/8 succeeded.
- Terminal D1 counts: orphan Space candidates **0**; ghost membership rows
  (active row points at deleted profile) **ghostRows=0, ghostProfiles=0**.
  This closes the 2026-06 "deletion did not clean up" debt from display layer,
  deletion orchestration, lazy reclaim backstop, and stored production data.
- Run records:
  `dev-tmp/scripts-admin/orphaned-space-sweep/` (candidate + result JSON; bridge
  worker deleted after use).

## 2026-06-13 - cdt -> Binding Merge Acceptance + 0.7.62 Release

- Cloud: I first deployed core/gateway/web
  (8a16e6eb/8b17ef0c/3fa03eaf), then the split agent redeployed all services;
  final system uses his deploy. Enrollment endpoint, which exists only in
  post-merge code, worked gateway -> core end-to-end, proving production was on
  new code.
- Baseline 1 cold start pass: after kickstart, converged healthy in around 25s,
  anomalies empty, attention none.
- Baseline 2 Wake main loop pass: canonical `@Claude Code Agent(wake)` syntax
  (hyphenated syntax does not parse Wake target, known CLI semantics); agent
  returned real pong; trace terminal state `reply.delivered`.
- Baseline 4 offline Wake pass: `projection_pending` plus automatic redelivery
  waiting copy (not hanging); after service restart, automatic redelivery
  occurred and agent returned real reply. Note: `openmeld service stop` unloads
  launchd registration, so recovery must use `openmeld service start` (kickstart
  cannot find service).
- Release chain pass: npm publish 0.7.62 -> this machine upgrade -> `openmeld setup`
  used new POST enrollment endpoint -> setup.complete; daemon 0.7.62 = expected
  bundle; post-upgrade status zero anomalies.
- Final system Wake pass: received `pong final-system`.
- Yellow flags, all classified non-regressions: routeCatalogSync
  `control_plane_rejected` = intended signal backstop during reinstall window;
  catalog converged through periodic sync. `runtime.registration.submit fetch
  failed` x3 = known intermittent Clash path; retry converged (terminal three
  agents reported).
- Old-issue regression scan: last ~300 log lines have no session_not_found /
  1008 / route.not_registered / auth_unavailable. Web card stable green (Felix
  visual check), no Checking flicker. send/tail/trace first request all
  succeeded.
- Baseline 3: CLI/Web surfaces agreed. Web was visually checked by Felix, and
  showed truthful 0.7.61 -> 0.7.62 upgrade banner before release and setup
  convergence after release.
- Baseline 5: runbook script names `test:e2e:gateway:http` /
  `test:e2e:journeys:cli` do not exist in the repo (doc stale). Not run this
  round; pending script-name correction.

## 2026-06-26 — OpenMeld CLI 0.7.84 (thread support, short-id guard, mention parse fix)

- Cloud: core (openmeld-core-prod, Version 4b3b0ac0) and web (openmeld-web-prod, Version
  4469ee15) deployed via local wrangler. gateway/auth NOT redeployed — the
  mention change is parse-logic only (wire envelope schema byte-identical) and
  neither worker consumes the mention parser. npm published
  openmeld@0.7.84 (latest). local-components stamped `available`
  across cli/service/skills; CLI required floor unchanged at 0.7.76
  (artifact-only, no contract change).
- Feature smoke (prod CLI 0.7.84 via npx; prod "OpenMeld Production Smoke" space
  833eab21...; Felix human profile 326d1bf2):
  - Short signal id: `space history --after-signal 80d6ac34` rejected locally
    with "must be a full 36-character UUID", no network request. Pass.
  - Mention parse fix: `space send` carrying `@scope/pkg.foo(arg)` +
    `getConfig()` sent successfully (signalId 0efb7320...) — technical @text no
    longer swallowed into invalid_canonical_mention. Pass.
  - Thread: `send --reply-to` created a thread (replyCount 1); agent brief
    history carried the thread field (threadId thr_1e3b9001..., replyCount 1);
    human history rendered the "1 reply · openmeld space thread" sub-line;
    `openmeld space thread` read it back (agent signalCount 2; human showed the
    reply body). Pass.
- Baselines 1-5 (cold start / Wake pong / three-surface / offline Wake / e2e):
  NOT run. This release touches only CLI space read/write commands; it does not
  change ServiceRuntime, Wake routing, liveness, or dispatch. Pre-existing local
  skew (global openmeld 0.7.74, service 0.7.83 with contract-epoch + bundle drift) is
  unrelated and would need `openmeld setup` + a global CLI upgrade before a Wake
  baseline is meaningful.
- Owner-doc scope: no rule under developing/architecture/ affected —
  client-side parse + read/write display only.

## 2026-06-27 — full cloud redeploy + OpenMeld CLI 0.7.85

- Release order used: gates on current `main` -> production DB sync -> cloud
  deploy from current code -> CLI/local-components 0.7.85 commit -> npm publish
  -> Core deploy from published manifest -> final full cloud deploy -> smoke.
  This kept production Core/Gateway/Web ahead of the new CLI payloads before
  publishing the CLI.
- Gates before release: `pnpm check`, `pnpm test`, `pnpm build`, and
  `pnpm run verify:release-ready -- --force` passed. Pre-push hook also passed
  on the release commit.
- Production DB sync: `pnpm db:sync:prod` completed after setting
  `CLOUDFLARE_ACCOUNT_ID=c511849a74548b7f9be7e3a280afeb8f`; migrate result
  `applied`, verify result `no_diff`, optimize result `applied`.
- Cloud deploys:
  - Pre-CLI deploy from current code: auth `dcd49b90-9a2d-4121-9eda-bd67253493bf`,
    core `5b14df7a-6888-4cf0-b99c-a4756bd3d3c4`, gateway
    `5b658ce4-238a-4dbe-803f-74ca86f1353c`, web
    `fb22b460-3ac9-4323-909e-2a4082bb7bb9`.
  - `release:cli`: npm published `openmeld@0.7.85`; Core redeploy
    `c6c85d8b-3d23-4491-9dc7-1cd976f0989f`.
  - Final full deploy: auth `1830d06b-59b1-4952-b270-8c41e8dda88a`, core
    `bd19a97a-37a3-4974-8723-a861222990d9`, gateway
    `ef04d9ad-2e22-4dbc-b4a6-86da9f812fee`, web
    `8505349d-918c-476d-9ca4-12a7e0215f87`.
- Space Index backfill during final deploy: 188 Space objects scanned, 117
  projected, 71 missing/empty, 0 failed, 296 active member rows projected.
  Report:
  `dev-tmp/scripts-admin/space-history-admin/2026-06-27T05-28-27-933Z-40896/space-index-backfill-report.json`.
- Contract impact / update policy: CLI, Service, and Skills stayed
  `available`; `openmeld.minRequiredCliVersion` stayed `0.7.76`. Rationale: the new
  work changed CLI/service/cloud behavior but did not require blocking old local
  clients immediately, and forcing the CLI floor before older dispatch-owned
  runtime behavior is fully flushed would create avoidable mixed-version risk.
- Published-entry smoke:
  - `npx -y openmeld@latest --version` returned `0.7.85`.
  - npm latest returned `0.7.85`; `openmeld.minRequiredCliVersion` remained `0.7.76`.
  - `https://openmeld.invalid` and `https://gateway.openmeld.invalid` returned HTTP 200.
  - Production auth session was valid for `felix@openmeld.invalid`.
- Local Service rollout smoke:
  - Before local update, published CLI 0.7.85 correctly reported Service
    `0.7.84` as update-available, not forced.
  - `npx -y openmeld@latest service update --json` completed with
    `forceUsed:false`, desired state `background`, service state `running`.
  - After update and launchd kickstart, Service ran as `0.7.85`, inventory
    anomalies were empty, runtime projection was healthy, and the smoke profile
    route was online with serviceVersion `0.7.85`.
- Wake baseline:
  - Smoke Space `833eab2155d25000e765e9562ef3ca351e98431b95c57a2692909613abc2675b`,
    human profile `326d1bf2-a521-474f-8cb8-b6664c1c8c6f`, target
    `agt_7b92845f-5fe4-4b41-9e2c-803557405e4d`.
  - Wake source signal `fba7824b-e630-41b5-a14e-e84eed06cb9e`,
    clientMessageId `10cd1491-115c-47e3-a73c-f8e2cb6cb0a6`; agent reply signal
    `aa05f012-e5ae-4272-b19c-2aaee38fc9c9` contained
    `pong 2026-06-27T05:33:40Z`.
  - `openmeld service trace` reported dispatch
    `cd7c97a8-151c-49ea-9379-23f044578ded`, status `succeeded`,
    `delivered=true`, visible outcome `visible_reply`, reason
    `reply.delivered`.
- Offline Wake drill:
  - `service stop --json` stopped pid `75661`; offline Wake source signal
    `13d8e8ec-11af-48f2-8622-e0d0a0e71574`, clientMessageId
    `67937a4a-c8e0-4b45-ad09-5ec9cf33ae64`.
  - Trace first reported `daemon.profile.offline`,
    `waiting_for_openmeld_service`, next action to start/restart OpenMeld Service; no
    silent hang.
  - `service start --json` restored the route online; the same dispatch
    `026daa05-a5bb-472e-a476-16a8b19e25c9` then completed with
    `delivered=true`, visible outcome `visible_reply`, reply signal
    `61dfe4e6-7950-403d-bc3c-1c4870b9d592`, and Space history showed
    `pong 2026-06-27T05:36:51Z`.
- Baseline caveats: I did not count the repo e2e shell scripts as published CLI
  smoke because they hardcode `clients/openmeld-cli/dist/openmeld-dev.js`. Browser visual
  inspection of the Agents page was not separately sampled in this run; CLI
  status, profile route observation, Space history, and service trace agreed on
  the production Wake outcome.
