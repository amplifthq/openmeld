# Production Smoke Runbook

> Acceptance means real user behavior. Do not substitute D1 SQL or internal DO
> inspection for user-visible results as smoke acceptance. Internal queries may
> only be used as design-gate evidence.
> After every production deploy, run the five baseline checks. Add failure drills
> by phase. Record results in [smoke-log.md](./smoke-log.md).

## Fixed Fixtures

| Item | Value |
|---|---|
| Smoke Space | `OpenMeld Production Smoke` - SpaceId `<smokeSpaceId>` |
| Smoke Agent Profile | `Claude Code Agent` - `<agentProfileId>` (claude-code adapter, bound to this machine) |
| Wake prompt | `Reply with exactly: pong <current ISO time>` |
| Expected reply | A real agent reply containing `pong` |
| Device | deviceId `<deviceId>` (operator's Mac, prod lane) |

## Five Baseline Checks (After Every Deploy, Agent-Executable)

1. **Cold start**: `launchctl kickstart -k gui/$(id -u)/com.openmeld.openmeld-background-service` -> `openmeld service status --view agent` becomes healthy within a few seconds (no repair warning) -> the corresponding card on the Web Agents page (https://openmeld.ai) is green.
2. **Wake main loop**: Wake the smoke profile in the Smoke Space -> receive a real reply containing `pong` -> `openmeld service trace --space <smokeSpaceId> --view agent` shows a complete chain.
3. **Three-surface comparison**: Agents page / Smoke Space member badge / `openmeld service status` show the same conclusion, or a valid split with an explanation on each side (local vs cloud perspective).
4. **Offline Wake**: run `openmeld service stop`, then Wake in the Smoke Space -> see an explicit failure reason plus next action (not Checking, not hanging) -> restart the service and recover.
5. **e2e scripts**: `pnpm test:e2e:gateway:http` and `pnpm test:e2e:journeys:cli` (pointing at the production gateway; created entities use a smoke prefix and are recorded in smoke-log).

## Failure Drills (Add By Phase; Wrap Long Windows In `caffeinate -dims`)

| Drill | Recipe (safe / reversible) | Pass criteria |
|---|---|---|
| Credential failure | Back up `~/.openmeld/auth/session.json` -> corrupt it -> observe -> restore backup. Do not touch the Keychain item; do not depend on `openmeld auth login`. | Service enters `degraded(auth_*)` and Web shows the reason; after restore, it recovers within seconds **without restart**. |
| Network failure | Only point the OpenMeld service's own gateway URL at a blackhole address, then restore it. Do not cut machine-wide network or change proxy settings. | Within 60s plus one TTL, it reaches a stable "lost contact at T" state with no flicker; after restore, it becomes green within seconds. |
| Kill process | Only use label `com.openmeld.openmeld-background-service` (`kickstart -k`). | KeepAlive restarts it and automatically converges to green with no manual repair. |
| Deploy disturbance | Observe during and after Core deploy. | Wake availability gap is at most one heartbeat interval; no lingering `route.not_registered`. |
| Execution interruption (Phase 3+) | Kill the socket during Wake execution. | Outcome still reaches a terminal state; Space shows either a reply or a failure with a reason. |

## User-Assisted Items (Record In smoke-log.md; Do Not Block Phase Exit)

- Full `openmeld auth login` validation (interactive OAuth).
- Proxy bypass A/B (requires changing the user's Clash config; agents must not touch it).
- Any path that may open a Keychain authorization dialog.

## Known Environment Facts (Read Before Judging Smoke Results)

- All traffic on this machine goes through Clash TUN fake-IP
  (`198.18.0.0/15`) proxying, and **that path fails intermittently**. `wrangler`
  and the service have both reproduced `fetch failed`. For a single network
  failure, suspect the proxy path first, check whether retry converges, then
  suspect cloud.
- See [facts.md](./facts.md) M-E for the interaction between DO hibernation and
  the 25s heartbeat.
