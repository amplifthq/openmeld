# PeopleComputers Contract Impact Audit

Status: implementation and local evidence; staging acceptance and production
publication are not yet complete. This audit defines rollout requirements, not
deployment evidence.

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

Center Agent's canonical inventory read and four explicit control calls now use
distinct Worker RPC method names. Existing current-target methods remain for
old producers, with unchanged response shapes. A missing new receiver fails
closed; new producers must not retry against an old method that may discard the
target. No Service message or execution epoch changes. The canonical read omits
implicit current-computer diagnostics; selected diagnostics require a target
owned by the represented member. Focused real-D1 tests cover member inventory,
absence of a browser-current claim, foreign-owner rejection and exact-lane
update routing. Public Center Agent acceptance remains required after the
receiver-first staging deployment.

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
