# Phase 4 · Colleague use — external review

Packages: 4a, 4b, 4c, 4d of [the MemberAgent program](../member-agent-program.md)
(§4.6, §5, §6, §7, §10 Phase 4).
Branch: `claude/map-4-collab-9db126`, reviewed diff `c3d8697fa..67f4dd9b1`
(the `[4a]`–`[4d]` Core commits before the fixes below; the Web commit came
after and was not part of this run).

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: any path that wakes or adds another owner's personal Agent
  before that owner consented (posts, edits, automatic Wake, Agent replies
  and auto-relay, threads, queued input, Space Tasks, work recovery, Direct
  Message conversion, self-join, invitations, Center Agent tools, Remote
  Agent native delivery, the release path itself); a non-owner who can
  grant, revoke, decide or read grants; an observer who can write or keeps
  reading after a request closes; an Inbox item or email that leaks message
  text; hold and sync state, idempotency, constraints, the fresh Session,
  external users getting "always allow". Reviewed as if
  `MEMBER_AGENTS_ENABLED` were on.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Converting a Direct Message to a Space skipped the non-owner check, so a new member list could include another owner's Agent, which then joined with its owner. | Yes (`expandAgentOwnersInDirectMessageConversion` bypassed `rejectNonOwnerPersonalAgentAdditions`) | Fixed. Conversion refuses a new personal Agent of another owner (`agent_access.request_required`); Agents already in the Direct Message were consented to and keep the existing conversion behavior. |
| 2 | Opening the live stream upserted the viewer as a member, so an observer became a writer; the stream also accepted posts after only a read check. | Yes (`handleSession` → `upsertJoinedSpaceMember`; `webSocketMessage` → `publishTextSignal`) | Fixed. One observer predicate (`isAgentOwnerObserver`) now decides the HTTP write refusal, keeps an observer's stream from joining them, and refuses posts over that stream. Test asserts the predicate for owner and requester and that the owner never becomes a member. |
| 3 | Personal Agent Profiles without a MemberAgent escaped the consent gate (inner join on `member_agent_id`). | Yes | Fixed. Any active personal Agent Profile with an owner is protected; `agent_access_requests.member_agent_id` is nullable (migration 0045 regenerated, not yet merged anywhere). Test: "asks before a personal Agent that has no MemberAgent yet". |
| 4 | The one-time owner-participation repair added the owner of an Agent that joined on someone else's request, turning the observer into a member. | Yes (`ensureAgentOwnerMembershipPolicy`) | Fixed. Agents with a released `space_join` hold are excluded. Test after an approved join. |
| 5 | A failed Space call after Core recorded a decision left Core and the Space split indefinitely (message held, observer kept). | Yes | Fixed. A decision Core recorded but the Space did not apply is applied again whenever its owner or requester reads it (repair on read, bounded, joins only on the owner's read so attribution stays the owner's). |
| 6 | A voided request kept its allow-once grant, so the next message in the same Direct Message passed without asking. | Yes | Fixed. Voiding revokes the request's `once` grant; a standing grant is about the person and stays. Test: "does not let a voided allow-once cover the next message". |
| 7 | A personal hosted Remote Agent derives its conversation from Organization, Profile and Space and ignores `contextSelection: new`, so an approval in a Direct Message it already worked in continues its conversation. | Yes (`native-delivery-service.ts`) | Not changed: hosted native delivery is outside this package. New Direct Message Sessions are new Spaces, so the common case is fresh. Reported as a program correction. |
| 8 | External requesters cannot read or withdraw their own requests: every request route requires membership in the active Organization. | Yes | Not changed: external users have no Web surface for this yet. Reported as a program correction (needs a Space-scoped requester read). |
| 9 | Retrying the same decision after it was applied (a lost response) failed with `request_closed`, and a failed Reply by DM could not be completed. | Yes | Fixed. The same answer is idempotent at any time; the Space re-applies idempotently and Reply by DM reopens the owner's Direct Message. Test asserts a repeated decision. |
| — | A direct non-owner grant, decision, revoke or grant read. | — | None found. |
| — | Message content in the Inbox title, preview, context label or source facts, and so in the urgent email. | — | None found (fixed copy, names only). |

## Checks after the fixes

- `services/core`: `tsc --noEmit`; `tests/agent-access-consent.integration.test.ts` (9 passed);
  `tests/organization-rpc.test.ts` focused cases; `tests-node/agent-access-policy.test.ts` (8 passed).

## Local-stack check (2026-10-19)

Local PostgreSQL stack (`pnpm dev:postgresql`) with `MEMBER_AGENTS_ENABLED`
switched on in the working tree only, two local test accounts (Felix owns
"PR Reviewer", Tali is a member). Setup used the local database for the
organization membership and the Agent Profile, and Tali's Wake was posted
through her own session because Web holds a Wake for an Agent with no
connected computer before sending it. Everything after that went through
the product UI.

| # | Found | Disposition |
| --- | --- | --- |
| 1 | A held Wake showed "Working…" with Stop: Wake progress synthesized `request_sent` for a target without a dispatch. | Fixed (Core): held or closed requests report no progress. Test asserts empty progress for a held Wake. |
| 2 | "Allow once" hung: the release flushed the dispatch outbox inside the Space's concurrency gate, and the flush calls back into the Space. | Fixed (Core): projection, broadcast and flush run after the gate. The stranded decision was then applied by repair on read, as designed. |
| 3 | The owner's answer card rendered twice in a selected Inbox item. | Fixed (Web): detail only, short eyebrow label. |
| 4 | Add members said the owner "Joins with selected Agent" and offered "Add 1 member". | Fixed (Web): "<owner> decides whether the Agent joins", "Send request". |

Observed after the fixes: requester banner and Space list label while
pending; urgent Inbox item with names only; owner observer view of the
Direct Message and of a private Space ("View only", Join, answer in place);
an observer write refused with `space.access.read_only`; Allow once released
the held message; Let the Agent join added only the Agent; Revoke emptied the
access list.
