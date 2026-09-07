# PeopleComputers Contract Impact Audit

Status: staging evidence at `572142a0f` is preserved below. Subsequent local UI
follow-ups are included in the delivery candidate. On September 7 the user
explicitly authorized current-main integration, merge, release and production
deployment. Production verification remains pending; earlier staging evidence
does not certify the later candidate or its production rollout.

## Ownership and retained contracts

PeopleComputers is the Core-owned projection of human-owned computer enrollment,
device aliases and current Service sessions. It is not Cloudflare compute or a
hosted Center Agent execution environment. Enrollment associates device IDs;
names never merge physical machines. Unconfirmed records remain distinguishable.
Inventory reads do not enroll, adopt, rename or repair devices.

Runtime Transport selects the current session for an owner, device and lane.
Core derives connection evidence and permitted controls from that session.
Transport lookup failure is unknown, not disconnected. Service installation,
local-agent catalog observations, current Agent Wakeability and a particular
Wake's execution outcome remain separate. RuntimeCoordinator, dispatch-owned
Space actions, finalization and Service transport epochs are unchanged.

The CLI proves its local device from its lane state. A browser cannot do that:
it uses explicit setup evidence or a selected routing preference. The shared
legacy inventory adapter labels the supplied target; it establishes neither
identity nor liveness. Account, device and lane scope all control caches.

## Boundary changes and mixed-version behavior

| Boundary | Change | Compatibility and rollout |
| --- | --- | --- |
| Core/Gateway HTTP and RPC | New PeopleComputers inventory, explicit readiness and exact-device/lane control endpoints | Existing current-target endpoints and their strict response shapes remain. Deploy Core receivers, then Gateway, before new Web or CLI callers. |
| Core/Service | Reuses existing catalog, installation, maintenance, file-policy, native-picker and Project-discovery messages | No Service wire fields, execution epoch or policy-store migration. Exact ownership/session/capability checks precede dispatch. An unsupported old Service receives upgrade guidance; it is not silently retargeted. |
| Web | Uses PeopleComputers evidence and explicit controls; new cache namespace | Old Web keeps its legacy endpoints. New Web requires new Core/Gateway. Do not deploy Web first under the generic cloud order. |
| Center Agent/Flue | Candidate discovery requires the immutable turn's verified requesting member, not the hosted Profile owner | Core receiver must precede Remote Agent producer. An old caller missing the speaker fails closed during this short window; it must never fall back to the Organization owner. Explicit other-member discovery does not grant mutation authority. |
| CLI Agent View | `computer list` uses `computers`, explicit connection evidence and `isThisComputer`; `current` pairs all diagnostics with the local device/lane | This is a command-output contract change, not an optional-field compatibility claim. Command contract becomes `openmeld-cli-command-contract-2026-09-people-computers-v2`; the versioned release must stamp CLI `required`. Existing `current` diagnostic envelopes retain their shape. |
| Service installation | Align an explicitly stopped, non-autostart contract with the bundle already installed | Confirmed stopped runtime only; preserve account, device and desired state. No new OS service identity or lifecycle protocol. Service component may remain `available`; do not force a Service execution-epoch change for CLI output. |
| Skills | No guide or action protocol changes | Existing dispatch-owned actions and self-rescue remain supported. No Skill contract bump is justified. |

Required CLI publication must preserve login, setup, update, Service status and
trace/self-rescue. A required floor may block new unsafe work but may not cancel
accepted work. Local-component versions and hashes belong to the separate
versioned release PR; this feature branch does not hand-edit release manifests.

## Rollout and rollback

1. Use guarded staging deployment: Auth, Core, Gateway, Web, Remote Agent.
   Publish only the staging CLI channel for local-component acceptance.
2. Prove owner/non-owner selection, wrong-device/lane rejection, fresh enrollment,
   reconnection and actual Space/DM Wake outcomes through public entry points.
   Exercise required-update recovery and accepted-work preservation before a
   production floor is raised.
3. After exact-candidate merge, install production Core/Gateway receivers before
   Web and Remote Agent callers, using explicit guarded scopes or a verified
   receiver-first plan. Keep the already-published CLI projection until new
   artifacts exist; use the existing two-phase receiver release when needed.
4. Publish the versioned CLI release only after receivers are healthy. Its Core
   projection may then advertise the installable required CLI. Do not use a
   CLI-first/default cloud order or publish against unavailable receivers.
5. Roll back new Web/Remote Agent callers before their receivers. Once a CLI is
   published, retain its PeopleComputers endpoints in any Core/Gateway rollback.
   Preserve monotonic floors; no enrollment or user-data rollback is needed.

## Evidence and remaining acceptance

The guarded staging deployment completed for Auth, Core, Gateway, Web and
Remote Agent. A transient Cloudflare 503 interrupted the Remote Agent portion;
the guarded Remote-only retry completed, including staging health checks. No
D1 migrations were applied. Staging CLI
`0.3.166-staging.20260907071248176.572142a0` was published and installed only
in the isolated acceptance root; no production CLI was published.

Public staging CLI status now reports no owner anomalies and ready device
evidence. A real Codex Wake in the private acceptance Space completed with
`PEOPLE_COMPUTERS_STAGING_WAKE_OK`, visible in authenticated Chrome, and a
public trace proving `visible_reply` and delivery. Its client message is
`1d3dbaae-ed63-496c-8a62-882151184175`. This proves this exact configured
target's execution, not every controller or a fresh physical-machine setup.

The owner Center Agent acceptance `PC-COMPACT-1528` completed exactly two
`openmeld_list_computers` calls without fallback or result-size failure. The
targeted read preserved device `599c1650-1484-4844-aad2-0c8ce66188e4`, lane
`canary`; the visible reply explicitly declined to identify the browser's
physical computer.

Non-owner acceptance `PC-MEMBER-1531` completed through public
`center-agent ask` in the member's own conversation. Both
`openmeld_list_computers` and
`openmeld_list_local_agent_connection_candidates` were `output-available`,
with no truncation or tool failure. The result identified the actual member
and returned no computers or candidates; the same member's public
`computer list` independently returned `computers: []`. It did not return
the owner's nine records. The dispatch is
`efa62ce5-c047-4f0b-a3f1-31d15dae68f1`. This verifies the empty-member versus
populated-owner boundary; a non-owner with a real connected computer is not
established by this test. Authentication used an isolated staging fixture and
public CLI token exchange, not a new-computer onboarding walkthrough.

Center Agent's canonical inventory read and four explicit control calls now use
distinct Worker RPC method names. Existing current-target methods remain for
old producers, with unchanged response shapes. A missing new receiver fails
closed; new producers must not retry against an old method that may discard the
target. No Service message or execution epoch changes. The canonical read omits
implicit current-computer diagnostics; selected diagnostics require a target
owned by the represented member. Focused real-D1 tests cover member inventory,
absence of a browser-current claim, foreign-owner rejection and exact-lane
update routing. Public owner and empty-member Center Agent acceptance is
recorded above; connected-member mutation acceptance remains separate.

Real staging acceptance exposed a canonical inventory response exceeding the
128 KiB model-tool result limit. The Center Agent projection now excludes full
capability and local-agent catalogs from each execution target, retaining the
same identity, connection evidence and explicit selected diagnostics. Focused
tools still own catalog and installation details. The safety limit is unchanged.
This changes only the new Core-to-Remote Agent read projection; no installed
CLI/Service contract or legacy response changes. The successful compact
staging revalidation is recorded above; the earlier fallback answer remains
a historical failure, not acceptance evidence for exact-lane diagnostics.

Web self-owned Agent creation now preserves the chosen device, lane, runtime
and controller through the existing `localAgentConnectionCandidateId` field.
Its encoding moved unchanged to `packages/agent-runtime` for Core and Web reuse;
this adds no request field or transport contract. The recovery catalog does
not substitute another computer when the selected target is absent. The review
shows the selected computer and the selector is locked during submission.
Teammate/session selection and real browser submission remain acceptance work,
not claims established by the focused catalog tests.

Interrupted staging foreground execution exposed a local restart regression:
an exited process's missing command path was diagnosed as bundle corruption,
which suggested system-registration repair. Inventory now retains the stale
lease without inferring a bundle mismatch when no matching process exists.
Observed/live process validation and independent bundle-integrity checks stay
unchanged. A real exited-child regression failed before the fix; all 23 inventory
integration tests pass afterward. This changes no wire contract, enrollment,
execution epoch or running-task authority. The new packaged staging CLI still
needs to prove restart on the preserved failing fixture before production.

Staging's isolated foreground Service also exposed owner diagnostics counting
the unrelated Canary OS registration pointing at localhost. Runtime status
already scoped that registration by installation root; anomaly calculation now
uses the same observation rather than the discarded unscoped manager. A
red-before-fix regression and a same-root collision regression cover this
boundary. No registration, process, wire schema, execution epoch or stored
state is changed by this correction. Existing binaries retain the diagnostic
bug until updated; cloud receivers require no compatibility change.

The downloaded binary launched directly from the task checkout did not provide
process-path proof of its isolated installation. Restarting only the idle test
Service through its installed versioned executable cleared the observed
`runtime_bundle_mismatch` without weakening process identity checks. The
remaining external-owner diagnostic still requires the corrected staging CLI.

The corrected binary exposed a second independent owner-counting problem: one
foreground PID was counted as direct from its fresh runtime lease and as
system-managed from its installed executable path. Owner classification now
uses the verified direct lease for that same PID rather than counting its path
again. A running manager or another managed PID remains independent evidence.
This changes local owner diagnostics and stop-strategy classification, not the
Service transport or execution contract. A regression fails on the former
double count; the installed staging binary now reports no owner anomalies,
and the exact-target Wake succeeded as recorded above.

Staging browser acceptance exposed inherited production cookies masking the
staging session when both environments used Better Auth's default cookie names.
Staging Auth now explicitly uses `openmeld-staging`; production names remain
unchanged. Existing staging browser sessions require one sign-in, while CLI
bearer sessions and session rows are unchanged. Web and Gateway forward cookies
without interpreting their names. This uses Better Auth's existing cookie-prefix
contract, not a parallel authentication implementation. Mixed-cookie parsing,
Auth type checks and the Worker environment contract pass; browser acceptance
with production cookies retained is still required after deployment.

Local evidence includes default binary Web onboarding, a real Codex DM reply
with a public delivery trace, controller-off guidance, exact file-policy
save/read/restore, and explicit Project discovery. Focused tests cover member
authorization, disconnected/unknown evidence, mixed catalog readiness and
device/lane isolation. CLI diagnostics regressions failed before the correction.

These do not prove a Node-absent physical machine, another physical Mac, Windows
installation, staging delivery or production smoke. The native folder-picker
request reached the local Service, but its OS panel was not accessible to the
automation interface; it is not recorded as a passed native UI test. A local
foreground setup also replaced this task's shared dev-local registration;
production/canary registrations were not deliberately changed. Preserve that
incident and restrict further test carriers to isolated roots without replacing
another lane's OS registration.
