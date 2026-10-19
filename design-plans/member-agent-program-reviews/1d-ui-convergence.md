# 1d · UI convergence audit

Branch `claude/map-1d-ui-convergence`, cut from `origin/claude/member-agent-program`
after `ed1e279cc` and rebased onto `4687f85f7` (after p2 smoke 3 and the Inbox answer merged). Applies program principles 12 (extend existing UI, no
parallel forms) and 13 (no dead ends; Sessions clear and switchable).

Source list: `git diff --diff-filter=A --name-only origin/main...HEAD -- clients/web/src`
plus the program's modified Web files. Tests, fixtures, query modules and pure
models are listed only when they carry a surface.

## Surfaces

| Surface (file) | Existing component / pattern it duplicates or should extend | Decision |
| --- | --- | --- |
| Default Profile "Edit Agent" dialog on the detail workspace (`agents/agents-page-agent-profiles-card.tsx`, `agents/agent-profile-workspace-detail.tsx`) | The workspace's own inline cards (name, controller, model, collaboration and permission modes, OpenCode permission) | **Merged.** The detail workspace no longer opens `AgentProfileEditDialog` and its overflow menu has no "Edit Agent", for every Profile: every field the dialog edits is already inline there, so the entry was redundant. On `main` the entry opened nothing (no dialog was mounted on the workspace), so flag-off loses only a no-op item. The name card shows the harness name read-only with "The default Profile is named after its harness."; other cards stay inline-editable. The list card keeps its existing editor (it has no inline cards). |
| MemberAgent Session history (`member-agents/member-agent-chat-history.tsx`) | `organizations/center-agent-chat-history.tsx` (same title dropdown, search, New chat, Current marker) | **Merged** into one `spaces/chat-history-dropdown.tsx`. Center passes one "Chat history" group; a MemberAgent passes one group per Profile. |
| Session rename / archive dialogs (`member-agents/direct-message-session-actions.tsx`) | `organizations/chat-title-editor.tsx` (rename) and `spaces/chat-header-menu.tsx` Archive item + confirmation | **Merged.** Rename uses `ChatTitleEditor` as the dropdown's title action and calls Core's Session rename. Archive is the existing chat-menu item with `archiveKind="session"` (same item, same confirmation, Session-specific description). The new rename/archive dialogs are gone. |
| Session Delete (`direct-message-session-actions.tsx`) | none: no existing Delete for a chat | **Kept** (Core Session delete is new). One confirmation dialog, reached from the history dropdown. |
| Agent access request card (`agent-access/agent-access-request-card.tsx`) | `ApprovalCard` family as used by `inbox/plugin-action-request.tsx` | **Merged.** Already on `ApprovalCard`; its unavailable / outcome / error / refresh-error states now come from shared `inbox/approval-request-states.tsx`, which `plugin-action-request.tsx` uses too. A failed refresh now offers "Refresh request" instead of only disabling the buttons. |
| Sensitive CLI confirmation card (`sensitive-operations/credential-confirmation-card.tsx`) | same | **Merged** onto the same shared states (it gained the refresh-error notice it lacked). |
| Permission-mode suggestion card (`spaces/space-permission-mode-suggestion-card.tsx`) | `ApprovalCard` body and footer conventions | **Merged.** Uses `ApprovalCardBody` and the primary-first small footer (Apply, then Not now). |
| MemberAgent rows in Agents list (`member-agents/member-agent-directory-section.tsx`, `member-agent-directory-model.ts`) | `agents/agent-directory-lists.tsx` Profile cards | **Kept.** New model (one row per org × owner × harness). Unassigned Profiles keep the existing Profile card. |
| MemberAgent detail and Profiles/Sessions secondary sidebar (`member-agents/member-agent-detail.tsx`) | `AppContextualSidebarNav` | **Kept** (new model), built on the existing contextual sidebar. |
| Open MemberAgent's Sessions in the conversations sidebar (`member-agents/member-agent-session-nav.tsx`, `spaces/conversations-sidebar.tsx`) | `AppContextualSidebarNav` groups; header dropdown data | **New, on existing primitives.** While a MemberAgent Session is open, the sidebar lists that MemberAgent's Profiles with their Sessions; the current Session is the sidebar's active item; switching is one click. It reads the same `useMemberAgentSessionGroups` as the header dropdown, so both always agree. |
| One sidebar row per MemberAgent (`member-agents/member-agent-conversations.ts`, `conversation-sidebar-row.tsx`) | Center Agent's collapsed entry (`sessionSpaceIds`) | **Kept**, mirrors the Center entry; personal rename/archive are off on the grouped row because Session ops live in the header. |
| DM welcome / repair card (`member-agents/member-agent-direct-message-card.tsx`) | `spaces/center-agent-direct-message-intro.tsx` | **Kept.** The Center intro is a static greeting; this card is driven by Wakeability and its public reason, which nothing existing presents. |
| Owner's harness · Profile display names (`member-agent-display-name.ts`, `use-member-agent-profile-display-name.ts`) | `formatAgentDisplayName` call sites | **Kept** as a formatter used by the existing surfaces (no new UI). |
| Agent access section in Profile settings (`agent-access/agent-profile-access-section.tsx`) | Profile settings sections | **Kept** (new grants model) inside the existing settings layout. |
| Agent access banner in a Space (`agent-access/space-agent-access-banner.tsx`) | Space banners | **Kept** (requester / observer states are new). |
| Sensitive changes audit (`sensitive-operations/sensitive-operation-audit-section.tsx`) | none | **Kept** (new data). |
| People/Agent picker MemberAgent grouping (`spaces/people-agent-picker-*.ts(x)`) | the existing picker | **Kept**, extends the picker in place. |
| Folders dialog (`profiles/agent-profile-folders-dialog.tsx`, `agent-profile-folders-model.ts`) vs the old Working folder dialog (`profiles/agent-profile-project-settings-dialog.tsx`) | The existing Working folder card and control | **Merged** (after p2 merged, repair on `claude/map-1d-folder-repair`). The folder list is titled "Working folder" and is the one surface behind the detail workspace's Working folder card, the list card's menu entry (renamed from "Default Project and folder") and working-folder recovery (`agent-profile-working-folder-recovery-action.tsx`, from failed tasks and the Agents page); the detail workspace drops its duplicate menu entry and the old dialog is deleted. Recovery keeps every ability the old editor had: a new folder `repair` operation replaces unreadable settings (Core previously refused them with `profile_folder.configuration_invalid`); "Set up again" prepares the current default again (recreating a missing OpenMeld folder); a failed readiness or eligibility refresh, or a changed Computer or local agent, blocks writes; a saved default rechecks availability; and unfinished creation setup is cleared. |
| Composer folder choice (`spaces/space-composer-folder-choice.ts`) | Folder list model | **Kept**: per-task choice in the composer reads the same folder list; no separate editor. |
| Inbox answer to an Agent's question (`inbox/inbox-agent-interaction.tsx`, from `claude/map-4-inbox-answer`) | `spaces/space-agent-interaction-card.tsx` | **Already shared**: it renders the Space's `SpaceAgentInteractionCard` and answers through the same Space endpoint. Its load-failure state now uses the shared `ApprovalRequestUnavailable` (with "Refresh question" beside "Open conversation"); the answered and paged-out notices stay, as nothing else covers them. |

## Navigation paths

| Path | Before | After |
| --- | --- | --- |
| Inbox → Agent access request → "Open the conversation" / "Open the Space" (owner may only observe) → back | The app shell keeps Inbox in the primary navigation, and the request card stays in Inbox. | Unchanged; verified no dead end. |
| Inbox → credential confirmation | Answered in place. | Unchanged. |
| Agents → MemberAgent → Profile → back | "Back to Agents" landed on the Agents list, losing the MemberAgent. **Dead end.** | Opening a Profile from a MemberAgent page carries `memberAgentId`; Back reads "Back to <MemberAgent>" and returns to that page. |
| Agents → MemberAgent → Session → back | The DM page had no way to the MemberAgent page (only the global sidebar row). **Dead end.** | The sidebar's Session groups link to the MemberAgent page ("Open <MemberAgent>"). |
| DM Session switching | Header dropdown only; sidebar showed one row per MemberAgent with no Sessions. | Header dropdown and sidebar both list Profiles → Sessions from the same data; current Session highlighted; one click. |
| Deep link to a Session (including an archived one) | Header named it; sidebar showed only the MemberAgent row. | Same, plus the Session groups and the link back to the MemberAgent. |
| Deep link to `agents?memberAgentId=<unknown>` | "This Agent isn't available in this Organization." inside the Agents page, whose list and navigation stay visible. | Unchanged; not a dead end. |

## Screenshots

Local dev stack with `MEMBER_AGENTS_ENABLED` flipped locally (reverted
before commit). "Before" is the program branch head; "after" is this branch.
Files are in the session notes folder `1d-ui-convergence-shots/`.

| Surface | Before | After |
| --- | --- | --- |
| (a) Default Profile detail | `before-a-f-edit-agent-and-back-to-agents.jpg`: menu has Edit Agent | `after-a-default-profile-no-edit-agent.jpg`: no Edit Agent; name read-only with reason |
| (b)(d) Header Session history | `before-b-d-header-dropdown-own-rename-archive.jpg`: own Rename/Archive dialogs | `after-b-header-history-dropdown.jpg`: shared dropdown, pencil rename, Delete only |
| (d) Session archive | (no Archive in the chat menu for a Session) | `after-d-session-archive-existing-confirm.jpg`: existing chat-menu Archive and confirmation |
| (e) Sidebar | `before-e-sidebar-one-row.jpg`: one MemberAgent row | `after-e-sidebar-sessions.jpg`: Profiles → Sessions, current highlighted, link to the MemberAgent |
| (f) Profile back | `before-a-f-edit-agent-and-back-to-agents.jpg`: "Back to Agents" | `after-f-profile-back-to-memberagent.jpg`: "Back to Felix Lu's Claude Code" |
| Working folder | `before-folders-duplicate-menu-entry.jpg`: card plus "Default Project and folder" menu entry, dialog titled "Folders" | `after-folders-working-folder-surface.jpg`: one entry (the card), dialog titled "Working folder" (the local Computer is offline, so the list can't be read) |
| (c) Request cards | not captured: no pending Agent access or credential requests in the local data; covered by tests | |

## Checks

- Web typecheck: clean.
- Tests: chat-history dropdown, chat-header-menu (personal vs Session archive),
  approval request states, MemberAgent Session nav, agent-list return, plus the
  touched suites (center-agent chat history/new chat, inbox, agent-access,
  sensitive-operations, permission-mode suggestion, people-and-agents,
  agents-page profile cards, conversations sidebar). The conversations sidebar
  suite was already failing on the base (its organization-context mock lacked
  `useOptionalAppOrganization`); the mock is fixed here.
- Pre-existing, unrelated failures on the program head: `agents/selected-computer-panel.test.tsx`
  (`ComputerPowerSettings` needs a QueryClient), `profiles/dither-profile-avatar.test.tsx`,
  and seven suites under `spaces/` (device-wait locale, offline send, Center intro,
  header DM icon, landing error boundary, delivery status, outcome row); none
  imports a file this branch changes.

## External review (Codex, gpt-6-astra, high)

Codex reviewed `origin/claude/member-agent-program...HEAD` (Web) read-only.

| Finding | Verdict | Action |
| --- | --- | --- |
| P2: removing the workspace "Edit Agent" entry changes flag-off behavior | Not a regression | On `main` the entry set state but mounted no dialog (a dead control); every field it covered is inline. Kept, reason recorded above. |
| P2: Session rename accepted 81–160 characters (shared editor limit 160, Session limit 80) | Confirmed | `ChatTitleEditor` takes an optional `maxLength`; MemberAgent Sessions pass `AGENT_DIRECT_MESSAGE_SESSION_NAME_MAX_LENGTH`. |
| P2: new sidebar Session groups started collapsed, hiding the current Session | Confirmed | The open MemberAgent's groups start open and fold for the visit only (`useMemberAgentSessionDisclosure`). |
| P2: Session groups ignored sidebar search, kind filters and the archived view | Confirmed | They are hidden while any filter or search is active. |

Second pass, after the folder and Inbox-answer convergence:

| Finding | Verdict | Action |
| --- | --- | --- |
| P1: routing recovery to the folder list loses repair of invalid folder settings | Confirmed (`clients/openmeld-cli/src/profile-workspace/folders.ts` `requireList`) | Recovery keeps the workspace editor; recorded above. |
| P2: recovery could not reapply the current folder | Confirmed | Resolved by the same revert. |
| P2: a failed refresh left recovery writes enabled | Confirmed | Resolved by the same revert (its `saveBlockedReason` stays). |
| P2: recovery no longer cleared unfinished creation setup | Confirmed | Resolved by the same revert. |
| Inbox answer extraction | No findings | — |

Third pass, recovery on the Working folder dialog (`claude/map-1d-folder-repair`,
Codex gpt-6-astra high, `7d5b24bef..HEAD`):

| Finding | Verdict | Action |
| --- | --- | --- |
| P1: a new Service advertising `repairProfileFolders` can't register with an older Core (strict capability schema) | Confirmed, existing release constraint | Same as every capability (`manageProfileFolders` included): Core deploys before CLI per production-release. Recorded in agent-profiles.md. |
| P2: an older Service answers "Set up again" (`set_default` on the current default) without preparing the folder | Confirmed | "Set up again" sends `repair`, which an older Service refuses through the capability gate. |
| P2: a Default Project set in another tab survives a repair | Confirmed | Every local default change clears Default Project, even when this opening saw none. |
| P2: "Make default" on the saved default with a Default Project skipped preparing it | Confirmed | It always sends `set_default`, which now prepares the current default again, before the Project clear. |
| P2: Project controls in the add panel ignored the write block | Confirmed | The source chooser gets the panel's disabled state. |
| P2: a failed Default Project clear after repair was lost with the unmounted form | Confirmed | The partial failure is a dialog-level error. |
| P2: a repair's restarted counter could stay below Core's recorded revision | Confirmed | Core replaces its record with a repair receipt; Web replaces its cached list too. |


## Smoke round 4 fixes (`claude/map-1d-smoke-4`)

Findings from `dev-tmp/member-agent-smoke/round-4/report.md`. R4-01 (the owner's
own path in the owner's own DM) is not a defect.

| Finding | Root cause | Fix |
| --- | --- | --- |
| R4-02 (P2) Inbox question renders, then becomes a load error | The Inbox question polls the shared active-wake-progress query every 5 s with `retry: false`; one failed or timed-out poll set `isError`, and the component let that replace the question it already had. | A failed poll keeps the question; only a first read with no data shows the load error. |
| R4-06 (P3) different outer framing for the Inbox question and access request | The Inbox question rendered the Space interaction card with `presentation="surface"` (no frame); every other Inbox request (access, credential, Plugin) uses the framed ApprovalCard. | The Inbox question uses the framed card. |
| R4-04 (P2) identical "OpenCode" cards in Direct messages | Each Session is its own DM Space and its card was named after the peer Profile. | Each MemberAgent Session's card reads "<Agent> · <Session title>", the title the chat header shows. A first attempt collapsed Sessions into one card per section; Codex showed it lost other Sessions' unread and attention, duplicated the MemberAgent across pinned/grouped sections and broke search and personal titles, so it was reverted. |
| R4-05 (P3) unknown MemberAgent page has no local return | The placeholder had only text. | `UnknownMemberAgentNotice` offers "Back to Agents", like other Agent detail pages. |
| R4-03 (P2) answered plain Codex request missing from Continue previous | A plain DM wakes the peer without activation targets (runtime evidence: `activationTargetCount: 0`, `messageEnvelopePresent: false`), so the request had no `wakeTargetProfileIds` and `buildSpaceTaskSources` never offered it, although Core linked the published reply to it (`finalVisibleLinkage=matched_published_signal`). | Continuation targets come from the published final replies that answer the request (`replyToSignalId`), ordered by any named wake targets. |

### External review (Codex, gpt-6-astra)

| Finding | Verdict | Action |
| --- | --- | --- |
| P2: collapsed cards lose other Sessions' unread and attention | Confirmed | Collapse reverted; per-Session titles instead. |
| P2: pinned/grouped sections duplicate the collapsed MemberAgent card | Confirmed | Same. |
| P2: collapsed name ignored personal titles and search | Confirmed | Same; the new name flows through `useChats`, so search and personal titles apply per Session. |
| R4-02, R4-03, R4-05, R4-06 | No findings | — |
| P2 (second pass): Core-archived Sessions lost their distinguishing title | Confirmed | The title map also reads the archived Session lists, which `useArchivedMemberAgentSessionIds` already loads. |
| P2 (second pass): a rename made on another client can stay stale in the directory until the Session list refetches (30 s stale time, refetch on focus/mount) | Accepted as a known limit | Same-client renames invalidate it. The chat header has the same cache, so the two never disagree. |
