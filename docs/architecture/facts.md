# OpenMeld State Model Convergence Notes

This file is a dated incident and convergence note for the 2026-06-11/12
readiness and service-state investigation. It is not the durable source of
truth for OpenMeld state, readiness, Wake routing, or local service ownership.
Goal notes under `docs/goals/` referenced below were retired on 2026-07-03;
they remain available in git history only.

Use the scoped owner documents for durable rules:

- `developing/architecture/agent-transport-contract.md` owns final
  user-facing readiness, Wake execution, RuntimeCoordinator authority, and
  final visible outcome rules.
- `developing/architecture/local-openmeld-service.md` owns OpenMeld Service, daemon
  lifecycle, account/device/lane alignment, service health, route registration
  evidence, and local component update semantics.
- `developing/architecture/data-and-observability.md` owns durable data
  ownership, projections, trace selectors, and diagnostic read-model rules.
- `developing/architecture/shared-contracts.md` owns cross-boundary schemas and
  reusable shared policy.

If this note conflicts with `AGENTS.md` or a scoped `developing/` owner
document, the owner document wins. Distill stable facts into the owner document
instead of making this file a second authority.

## Incident Context

The investigation started from a production symptom: OpenMeld Web, local service
status, route lookup, and Wake diagnostics disagreed about whether local Agent
Profiles were currently available for Wake.

The durable product question stayed:

```text
Can this Agent Profile reply in this Space through the intended Wake path now?
```

The investigation separated four evidence classes that must not collapse into a
single local status flag:

1. `AgentProfileBinding`: the explicit execution connection from an Agent
   Profile to an OpenMeld Service Runtime and Agent Controller.
2. `ServiceRuntime` evidence: account/device/lane service heartbeat,
   capability, route catalog, service version, and local state evidence.
3. Wake execution evidence: RuntimeCoordinator-owned execution lifecycle and
   final outcome for one concrete Wake.
4. Local service state: the service carrier's own local status, degraded reason,
   and recovery evidence.

Those evidence classes are inputs into Core-owned readiness and diagnostics.
They are not separate public readiness authorities.

## Read Rules Proven By The Incident

- Remote surfaces should read cloud-owned projections and evidence. They should
  not probe local service state during display rendering.
- Local surfaces may compare local and cloud evidence, but they must expose the
  difference as diagnostic evidence instead of silently choosing whichever value
  looks healthier.
- Service online/offline display must be driven by fresh service evidence and
  TTL policy, not by a transient WebSocket object reference.
- Socket presence matters for delivery. It must not be the only fact used to
  answer whether the owner's service evidence is fresh.
- `Checking` is a temporary display state. It must not become a stable sink that
  hides known service, account, route, Binding, or execution blockers.
- Diagnostic data such as provider proof, controller reports, local mirrors,
  or log-only facts must not become public availability truth.

## Availability Shape Under Review

The convergence direction was to collapse duplicated availability derivation
toward a single owner-owned projection with explicit blockers:

```text
no Binding                          -> setup or binding required
missing or stale ServiceRuntime      -> device offline or reconnect required
local service degraded               -> degraded with a concrete reason
profile missing from local catalog    -> local agent unavailable
aligned evidence present             -> available for Wake
```

This shape is a convergence note, not a competing schema. Any durable contract
must be expressed through the owner documents and the shared schemas.

> **Correction (2026-06-16): "no Binding" is not "not connected".** The line
> `no Binding -> setup or binding required` above conflates two distinct facts
> and must not be read as "no connected computer". They are separate:
>
> - **Computer connected / service online** is a `ServiceRuntime` liveness fact
>   (heartbeat TTL; `lookupOwnerService`). Surfaced by `/v1/local-runtimes`
>   `executionTargets[].status` and reply-readiness `service.connected` /
>   `canReplyFromThisComputer`. This is the answer to "is this account's service
>   online on this device" — see agent-transport-contract.md, "Service Online
>   Evidence".
> - **Current device** (the account's active/current computer, used for routing)
>   is `Binding`-derived (`resolveCurrentDeviceFromBindings`). Surfaced by
>   `/v1/devices/current` `availability: resolved/missing`.
>
> The Workstream 2 merge (commits `ecc470083` / `c8369d935`) made connectivity depend on
> a `Binding`, so a freshly connected computer with no Agent Profile bound yet
> reported `availability: "missing"` and the web showed it as not connected. Fixed
> 2026-06-16 by making reply-readiness liveness-first and routing every
> connectivity surface through ServiceRuntime liveness; `/v1/devices/current`
> stays Binding-derived for routing only. See
> `docs/goals/2026-06-12-cdt-into-binding-merge.md` §0.5.

## Deferred Convergence Items

These items were intentionally deferred behind validation gates:

| Item | Gate | Status |
| --- | --- | --- |
| Remove lease epoch / connection-generation arbitration in favor of same-device replacement semantics. | Confirm product semantics for one Agent on one device without legal multi-device drift. | **Closed 2026-06-12**: Felix confirmed one-Agent-one-device. Verification found the shipped arbitration (packages/agent-runtime/src/lease-fencing.ts) is already the minimal 4-rule form; the conflict branch only guards the Binding-migration window and stays. No code change needed. |
| Collapse `current_device_target` into Binding if it is proven to duplicate Binding intent. | Confirm that the field is not an independent product intent. | **Gate opened 2026-06-12**: Felix confirmed it duplicates Binding intent. Merge approved; implementation is a dedicated work item (large rename/merge cascade across current-device-target-service, store, and consumers). **Partially reversed 2026-06-16**: the "duplicates Binding intent" premise held for routing but NOT for connectivity — the old pointer was stamped at connect/setup and meant "this computer is connected", independent of agent binding. Pure Binding derivation regressed connected-but-unbound computers to "missing". `current_device_target` (now Binding-derived) stays for routing; connectivity moved to ServiceRuntime liveness. See the correction note under "Availability Shape Under Review" and `docs/goals/2026-06-12-cdt-into-binding-merge.md` §0.5. |
| Collapse internal multi-source availability priority rules into one owner projection while preserving public contract shape. | Web session available for three-surface comparison. | **Narrowed 2026-06-12**: resolver verified mostly route-first already; the concrete violation fixed is stale evidence (`runtime.agent_controller_report_stale`) acting as a public-unavailable reason - now diagnostic-only. Full structural collapse re-scoped as not worth the regression risk while the surface is healthy. |
| Add the durable Wake execution ledger improvements behind the RuntimeCoordinator path. | Availability convergence complete and Felix present for the deployment window. | Deferred |

Do not execute these items directly from this note. Re-plan from current code,
current owner docs, and current production behavior.

## Evidence From The 2026-06-11/12 Incident

- DaemonHub hibernation and socket attachment size limits caused healthy
  sockets to be closed as `session_not_found` after cold wake. The structural
  repair moved service runtime records into Durable Object storage and kept
  socket attachment small.
- Before the repair, route display survived mostly because frequent re-register
  events refreshed route evidence inside the old TTL window. That was not a
  stable source of readiness truth.
- A 90s lease TTL was too narrow for the client's adaptive heartbeat ceiling,
  proxy latency, and cold Durable Object start. The implementation later moved
  to a wider TTL margin.
- The owner service read path no longer requires a live socket reference to say
  the owner's service evidence is fresh. Delivery route lookup still requires a
  deliverable live route.
- Web readiness polling for many profiles overloaded DaemonHub when each row
  performed a separate route lookup. Batch lookup now reuses the same per-route
  logic in one Durable Object round trip so batch and single-profile answers do
  not drift.
- A silently dropped idle keep-alive connection can fail the first request from
  a long-lived process. The CLI/service path now retries that specific network
  request once on a fresh connection instead of asking users to change proxy
  configuration.

## Reference Links

- Goal note: `docs/goals/2026-06-12-state-model-convergence.md`
- Smoke script: `docs/architecture/production-smoke.md`
- Smoke log: `docs/architecture/smoke-log.md`
