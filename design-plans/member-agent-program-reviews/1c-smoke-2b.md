# Smoke R2B-05 · First-run MemberAgent creation — external review

Package: 1c follow-up for smoke round 2b finding R2B-05 of
[the MemberAgent program](../member-agent-program.md) (§4.1, §4.5).
Branch: `claude/map-1c-smoke-2b`, cut from `claude/member-agent-program` at
`4472018eb`.

## Finding

After the Service connected and reported six harnesses, the first Agents
surface sync created four MemberAgents (Antigravity, Cursor, Grok Build,
OpenCode). Codex and Claude Code were created only by a later surface-open
sync, about five minutes on. The new rows first showed zero Profiles.

## Root cause

Evidence: `dev-tmp/member-agent-smoke/round-2b/dev-stack.txt`. Twelve
accepted controller reports (two passes of six) precede the first
`member_agents.sync` (`trigger: 'surface_open'`, four `created`). The second
sync that creates `claude-code` and `codex` is also `surface_open`; no
`catalog_update` reconciliation ran.

1. **Core creation gate.** `isRuntimeHarnessCreatable` required an unexpired
   report. For controllers that report an interface snapshot (Codex, Claude
   Code), Core limits a report's expiry to the two-minute auth-check
   freshness (`acceptRuntimeAgentControllerReport`). It also keeps the earlier
   expiry when the Service republishes the same snapshot
   (`preserveObservationEvidence`). The Service reports every minute and
   reuses a snapshot for up to a minute. Between checks, those two rows read
   expired while the computer kept reporting, so the sync skipped them.
   Installation does not depend on auth freshness.
2. **The catalog-update trigger could not help.** Those harnesses were first
   reported before any MemberAgent existed in the Organization, which
   matches the lazy rule. Later reports were steady detections, not
   transitions.
3. **Web.** The sync query re-ran only after its five-minute `staleTime`.
   After a sync it refreshed the MemberAgent listing but not the Profile
   directory. A new row built from the fresh listing found none of its
   Profiles in the stale directory, so it showed zero Profiles.

## Fix

- Core: creation requires a computer that Core accepted a report from within
  ten minutes (`HARNESS_CATALOG_REPORT_RECENCY_MS`, the Service's minimum
  report lifetime) and that detects the harness now. The report expiry no
  longer gates creation. The Binding target prefers a ready report, then an
  unexpired one, then the newest.
- Web: after a sync that changed something, Web refreshes the listing,
  presence, Profile directory, runtime overview, and the owner's Profiles.
  While a sync leaves a Binding or Direct Message unfinished, Web syncs
  again, at most 12 times, every 10 seconds. A detected MemberAgent whose
  Profiles are not readable yet shows **Setting up** instead of "0 Profiles".
  The row is refreshed every 3 seconds, at most 20 times, then shows what is
  readable.
- Tests: `member-agent-sync-service.test.ts` creates all six harnesses when
  the auth check expired two reports, and prefers an unexpired report for
  the Binding. `member-agent-directory-model.test.ts` covers the setup state
  for detected, migrated, and lagging rows. `sync-member-agents.test.ts`
  covers the pending-setup rule.

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `medium`, `--sandbox read-only`).

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | The diagnosis matches the expiry clamp and the snapshot-preservation code. | Yes | — |
| 2 | `reportCurrent ‖ recent acceptance` still let an old report create, and recent reporting does not prove the computer is connected now. | Yes, in part | Fixed: the gate uses only the acceptance age. Not changed: a computer that stops reporting stays eligible for up to ten minutes, the same lifetime the Service gives its report. Creation never required a live connection. |
| 3 | Forgotten computers and disabled reports. | — | None found. |
| 4 | Web sync retries are bounded per query, not per setup episode. A successful Binding followed by a failed Direct Message is never retried by Core, because the next sync sees the Binding. | Yes | Bounded retries kept. The Direct Message retry was not added: opening the DM surface creates it through open-or-create. Pre-existing since 1c, now recorded. |
| 5 | Any Profile-count mismatch marked migrated rows as setting up, and a stuck row could stay that way. | Yes | Fixed: only detected MemberAgents can be setting up, and after the refresh budget the row shows what is readable. |
| 6 | An expired newer report could outrank an unexpired one for the Binding when neither is ready. | Yes | Fixed: an unexpired report wins before observation time. |
