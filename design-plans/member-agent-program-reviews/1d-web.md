# 1d Web surfaces and Session operations external review

Package: Phase 1 · 1d of `design-plans/member-agent-program.md`.
Reviewer: Codex CLI (`gpt-6-astra`, reasoning high),
`codex exec --sandbox read-only`, 2026-10-18, over
`git diff 26ad3eb6d..84f6b6f7a` (Core Session operations, Web surfaces).
Questions: (1) a Profile that disappears from every Web surface for a
migrated user, including a failed, pending or stale MemberAgent read;
(2) a caller other than the Session's Human who can rename, archive or
delete a Session; (3) a MemberAgent appearing as a message author, Space
member or mention target; (4) Center Agent behavior changed by the
generalization. Each finding was checked against the code before acting.

## Program questions

| # | Question | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Profile disappears | No finding | A failed or pending listing keeps the per-Profile list (`use-member-agent-directory.ts`); a stale listing puts every owned Profile it does not group into Unassigned (`member-agent-directory-model.ts`). Covered by `member-agents.integration.test.tsx` and `member-agent-directory-model.test.ts` |
| 2 | Unauthorized Session mutation | No finding | `direct-message-session-access.ts` refuses converted DMs, Human–Human DMs, Agent callers, observers and Profiles outside the pair; Core checks the Space's Organization first; the Space DO applies the pair guard before any write. Covered by `direct-message-session-access.test.ts` |
| 3 | MemberAgent as author, member or mention target | No finding | Only display labels change; membership and mention insertion still use the Profile id and `@profileName` |
| 4 | Center Agent behavior | Two findings, below | Space id derivation, title-trigger authorization and the generic DM mutation rejections are unchanged |

## Findings

| # | Severity | Finding | Verdict | Disposition |
| --- | --- | --- | --- | --- |
| 1 | P1 | The welcome card always said "Permission mode is Ask first", even for a Profile in Full access | Verified | Fixed: the program's sentence appears only for each harness's Ask-first default (`isAskFirstAgentControllerPermissionMode` in agent-runtime); other modes are named; an unknown mode shows no line |
| 2 | P2 | Session archive (Core) and the personal chat archive (sidebar preferences) were two states for one chat; archived agent Sessions stayed in the sidebar; Center chats archived through the new control had no restore path | Verified | Fixed: a MemberAgent row skips archived Sessions and offers neither the personal archive nor the personal rename; the header offers Restore for an archived Session; Center chats keep only their existing personal archive in Web; the Center chat list ignores Session archive state while the flag is off |
| 3 | P2 | Rename changed the Space name but an older personal title still hid it | Verified | Fixed: a successful Session rename removes the personal title for that Space |
| 4 | P2 | A grouped MemberAgent row showed unread and running indicators of one Session only | Verified | Fixed: the row combines unread, running and attention indicators of all its Sessions |
| 5 | P2 | Session selectors stopped at 100 Sessions | Verified | Fixed: the Session read follows `nextCursor` (bounded at 2,000 per Profile) |
| 6 | P2 | The card element suppressed the existing empty-DM guidance even when no card rendered (Human DMs, unassigned Agents, flag off) | Verified | Fixed: the card is resolved by a hook before rendering; the body renders it only when one exists |
| 7 | — | Session rename accepted 160 characters; Space names cap at 80 | Verified (found while the review ran) | Fixed: rename uses the shared `spaceNameSchema` |

Nothing was rejected.

## Local-stack check after rebasing onto 1c (2026-10-19)

Local PostgreSQL stack with the flag switched on in the working tree only and
synthetic MemberAgents. Three defects found and fixed in `a5f2877da`: an icon
missing from Web's curated Phosphor facade broke the dev bundle (typecheck
and unit tests cannot see the facade); the MemberAgent DM header showed the
Agent's name instead of the Session's name; the latest Session on a
MemberAgent row could be an archived one.
