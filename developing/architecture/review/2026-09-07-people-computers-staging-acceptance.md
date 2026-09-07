# PeopleComputers staging acceptance

## Delivery boundary

Implementation and the staging smoke paths below are accepted at source
`572142a0fbdee2e1c7b54154a28cc77823753d77`. This is not production readiness
certification. The user requested stopping after staging smoke for follow-up
product work: do not merge main, publish production CLI, deploy production, or
run production smoke under the earlier full-release request.

## What changed and why

The old surfaces mixed saved registration, routing preferences, dated local-agent
reports and live Service evidence. A saved computer could look connected while
its detail page had no current session. Some consumers selected a different
device or lane when attaching readiness or controls. Center Agent candidate
discovery could use its Profile owner instead of the requesting member.

PeopleComputers now gives human-owned computer inventory a Core-owned read
projection. Names do not prove physical identity. Device aliases require
enrollment evidence, and unconfirmed records remain separate. A CLI can prove
its local installation; a browser cannot infer its physical machine from an
account preference. Explicit controls preserve owner, device and runtime lane.
No lookup failure is converted into a confirmed disconnection.

This is separate from hosted Center Agent / Cloudflare compute. Service produces
local observations and carries execution; Core owns current availability policy;
RuntimeCoordinator still owns a concrete workstation Wake. Historical failure
and current readiness are deliberately separate.

The Tools UI now emphasizes current outcome and a short next action. Versions
and historical reports are collapsed. Real update failures remain visible;
history does not claim current availability. A single execution target skips
the selector, while genuinely different environments remain distinguishable.
Selecting a local agent leaves advanced configuration collapsed.

## Observed acceptance

| Path | Evidence and limit |
| --- | --- |
| Local Web creation | Actual Chrome: sole-target picker absent; selecting Codex leaves customization collapsed. No claim about all multi-target submissions. |
| Staging Tools | Actual Chrome: current live target selected, historical reports collapsed and dated; explicit old target becomes Disconnected with controls disabled rather than retargeting the live computer. Friendly lane label shown before opening selector. |
| Packaged CLI / Service | Signed staging CLI `0.3.166-staging.20260907071248176.572142a0` installed in isolated root. Public Service status reports no owner anomalies and ready device evidence. |
| Workstation Wake | Private acceptance Space, client message `1d3dbaae-ed63-496c-8a62-882151184175`: public trace proves `visible_reply` / `reply.delivered`; Chrome shows `PEOPLE_COMPUTERS_STAGING_WAKE_OK` from the intended Codex Agent. |
| Owner Center Agent | `PC-COMPACT-1528`: two successful canonical computer reads; exact device and canary lane retained; no oversized-result fallback; browser physical identity explicitly unproven. |
| Non-owner Center Agent | `PC-MEMBER-1531`: actual inventory and candidate tools succeed for the member, return empty lists rather than the owner's nine records. Independent public member CLI inventory also returns empty. This does not test a connected member's mutation. |
| Cloud deployment | Guarded staging deployment and health verification completed. Remote portion required a guarded retry after Cloudflare 503. No D1 migration or production deployment. |
| Contract checks | Focused Core membership/foreign-target/lane tests, CLI owner regressions, affected Web/Remote checks and packaged local-component release verification passed. These do not replace real-user evidence above. |

## Failures preserved, not relabeled

- The first staging Wake failed because the test Agent lacked its required
  working-folder configuration. The failure remains visible; the later success
  followed a public configuration update and is a different dispatch.
- The first targeted Center Agent read exceeded the 128 KiB tool-result limit.
  The new projection removes full catalogs from inventory, retaining focused
  catalog tools and the safety limit. Only the later exact-target read passed.
- Isolated Service diagnostics exposed three distinct issues: stale exited
  process evidence mistaken for bundle corruption, another installation's OS
  registration counted as an owner, and one direct PID counted twice. Focused
  regressions and the final installed-binary status support the corrections.
- Staging inherited production-named cookies. Staging now uses its own cookie
  prefix, leaving production cookies and bearer sessions unchanged.

## Explicit coverage gaps and follow-ups

These are not silently counted as passed:

- A physically separate Mac, Node-absent clean installation and Windows.
- Production onboarding for an existing account on a genuinely new computer.
- A connected non-owner's real update/install mutation and every multi-target
  Agent creation variant. Permission and exact-target tests cover narrower seams.
- Deliberate upgrade or reconnect during an accepted running task, and a new
  staging stop/cancel scenario. The completed Wake does not prove those cases.
- The native folder picker reached Service in local testing, but its OS panel
  was not controlled by automation; native UI acceptance is incomplete.
- The CLI floor requires a separately authorized receiver-first production
  rollout and real recovery checks. Staging publication is not production rollout.

Do not promise that every local agent can run merely because one target is
ready. A controller requiring provider sign-in still needs its own explanation.
The release stamping tool also showed build/floor ordering drift; regenerating
after the floor stabilized passed verification, but the tooling issue is a
separable follow-up rather than a hand-edited manifest workaround.

## Evidence location and architecture review

Detailed contracts and compatibility decisions are in
[the contract impact audit](2026-09-07-people-computers-contract-impact-audit.md).
Local raw evidence is retained under this worktree's `dev-tmp/`, particularly
`people-computers-final-wake-trace.jsonl`,
`people-computers-compact-ca-full-result.jsonl`,
`people-computers-member-ca-full-result.jsonl`,
`people-computers-member-inventory.jsonl`,
`people-computers-final-owner-release-ready.log` and
`people-computers-remote-staging-retry.log`. These ignored files are local
evidence, not runtime or test dependencies.

The changes retain the scoped architecture invariants: Core policy, Service
local facts, RuntimeCoordinator execution authority, dispatch-owned publication,
explicit member/device/lane authorization, and unknown-versus-disconnected
honesty. No new execution authority, transport epoch, data migration or hosted
compute identity was introduced. Production compatibility remains subject to
the documented rollout and unperformed acceptance above.
