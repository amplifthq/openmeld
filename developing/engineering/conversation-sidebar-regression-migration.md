# Conversation sidebar regression migration

This audits the test removal in PR #909 at `e6d975f3`. The original
`app-spaces-sidebar.test.tsx` contained 42 named scenarios plus two parameterized
failed/stopped outcomes. All map to the new regression suite; none are silently
dropped or permanently skipped.

The suite renders the production `ConversationsSidebar`, `useConversations`,
`useChats`, React Query observers, activity projection hooks, and account pin
mutation. It stubs I/O boundaries and the unrelated creation dialog, not the
conversation model. Personal-preference persistence is stubbed as in the old
suite; separate model tests cover its write ownership. This is local behavioral
validation, not authenticated production or provider smoke.

The `S01`–`S42` identifiers are stable test-name prefixes in
[`conversations-sidebar.regression.test.tsx`](../../clients/web/src/components/spaces/conversations-sidebar.regression.test.tsx).
`S25-terminal` retains both original parameterized outcomes. “Adapted” identifies
an explicitly accepted product change; other rows retain their original
behavior while updating selectors for the shared components.

| ID | Original scenario | Disposition | Current assertion / rationale |
| --- | --- | --- | --- |
| S01 | uses the unopened Space snapshot and removes its marker when its tasks finish | Retained | Real Core snapshot refresh removes the finished unopened conversation marker. |
| S02 | shows the indexed message time without subscribing to per-Space previews | Retained | Index preview time renders with no per-Space incoming-preview query or observer. |
| S03 | moves unpinned Spaces with unread messages first and shows a static accessible indicator | Retained | Unread priority and accessible unread styling remain; use the shared row marker. |
| S04 | prioritizes unread pinned Spaces when Priority is selected by default | Adapted | Pinned is explicitly manual in the accepted design; unread must not reorder it. |
| S05 | keeps unread recency ahead of newly joined Spaces | Retained | Message activity, not join/visit time, orders unread conversations; unread emphasis remains. |
| S06 | keeps pin order when a Space has never been opened | Retained | A never-opened pin retains the canonical pin order. |
| S07 | preserves pin and unread ordering when the open owner records lastSeenTs | Retained | Changing lastSeenTs does not alter pin membership or Inbox-owned unread ordering. |
| S08 | does not mark a previously seen Space as new when its join timestamp advances | Retained | A join timestamp change alone does not create unread emphasis. |
| S09 | keeps an unseen Space available through render, hover, and focus | Retained | Render, hover and focus do not write Space history or mark it read. |
| S10 | shows a newly joined Space as soon as the window regains focus | Retained | Window focus refetches the real Account Space query and reveals new membership. |
| S11 | keeps cached Spaces visible when a foreground refresh fails | Retained | A failed foreground refetch leaves cached authorized conversations visible. |
| S12 | hides the pinned section when no Spaces are pinned | Retained | No empty Pinned section is displayed. |
| S13 | hides legacy welcoming spaces from the sidebar | Retained | Legacy welcoming Spaces stay out of both ordinary and pinned presentation. |
| S14 | keeps current Direct Messages out of the Spaces sidebar | Adapted | DMs now appear in shared navigation, but never in the ordinary Spaces group; converted conversations stay Spaces. |
| S15 | keeps a channel icon when member previews are not available | Retained | The shared row keeps a Space icon when member previews are absent. |
| S16 | filters account-scoped spaces to the current organization before grouping | Retained | Organization filtering occurs before grouping and pin display. |
| S17 | hides personal legacy welcoming spaces in the personal context | Retained | Personal-context welcoming Spaces and foreign-Organization rows remain hidden. |
| S18 | renders the Spaces title without repeating the OpenMeld brand | Adapted | The shared header is Conversations; duplicate product/account chrome remains absent. |
| S19 | keeps the Web profile out of Space navigation metadata | Retained | Viewer/profile participation metadata is not exposed in navigation copy. |
| S20 | reclaims the timestamp area when a space item is narrow | Retained | Shared row truncation/reservation replaces old CSS classes; browser geometry covers 180/220/320px and mobile overflow. |
| S21 | shows active Agent names only from the Working orb tooltip | Retained | Attributed activity appears in its tooltip, not as permanent extra row text. |
| S22 | lists every named Agent in the Working orb tooltip | Retained | Every named active Agent remains available in the tooltip. |
| S23 | uses the frozen target name when current Working progress only has a raw Agent id | Retained | Current progress uses the retained display name, not a raw Agent ID. |
| S24 | shows that the current Agent is waiting when its current task is occupied | Retained | Waiting for the current controller task stays distinct from active work. |
| S25 | keeps the current Space orb aligned with a recovered Core active Wake summary | Retained | A recovered current-Space projection remains visible when account summary refresh fails; failed/stopped variants remove only that Space. |
| S26 | clears the current Space orb when a final reply resolves the visible projection | Retained | A final visible projection clears the current marker without clearing another active Space. |
| S27 | uses an already-final projection on the first Space shell paint | Retained | An already-final visible projection wins on first paint over cached running data. |
| S28 | does not render a working orb from an expired cached summary | Retained | An expired cached account summary cannot render an active marker. |
| S29 | keeps the orb visible while hover or focus reveals the pin beside it | Retained | Activity remains visible and stationary while hover/focus reveals actions; browser geometry and pointer targeting are required. |
| S30 | waits for initial activity evidence instead of showing a temporary idle ordering | Retained | The Space query is explicitly settled before asserting that Priority waits for activity evidence. |
| S31 | keeps active Wake status visible ahead of unread while retaining unread semantics | Retained | Active status takes precedence over ordinary unread dots; unread semantics and collapsed group counts remain. |
| S32 | reserves the pinned action gutter only when revealed | Retained | The shared primitive reserves trailing space only as controls reveal; browser checks actual bounds. |
| S33 | shows the full space name quickly on row hover | Retained | The complete name remains available promptly on hover/focus despite visual truncation. |
| S34 | opens a space with the current Web profile even when the index open profile is an agent | Retained | Space links use the current Human viewer when the index open profile is an Agent. |
| S35 | opens an agent-only Space with the current Human Web viewer | Retained | Agent-only membership retains same-account Human viewer navigation. |
| S36 | uses the Router link for Space navigation | Retained | Router links, not a second imperative navigation path, open conversations. |
| S37 | renders the current space with the fluid sidebar selection surface | Retained | The selected conversation retains the shared selection treatment. |
| S38 | removes the redundant discovery section outside a conversation | Adapted | The empty-state copy is No conversations yet; redundant discovery actions remain absent. |
| S39 | offers creation from the Spaces section in a personal organization | Retained | Personal workspaces can create a Space from its own section; DM creation has a distinct accessible label. |
| S40 | places the create-space action in the Spaces section after pinned spaces | Retained | Space creation remains with Spaces after the shared Pinned section. |
| S41 | optimistically moves a space into the pinned section | Retained | Pinning becomes visible optimistically through the actual pin mutation/query cache. |
| S42 | keeps the optimistic pinned state while the Space Index overlay is pending | Retained | Pending Space Index overlays survive refetch, then expire at the existing bounded convergence window. |

## Browser evidence

S20, S29 and S32 have a reproducible geometry check because jsdom cannot establish
actual visibility, collision or pointer stability:

```sh
pnpm --filter openmeld-web exec vite --config scripts/conversation-preview/vite.config.ts --port 30182
node clients/web/scripts/conversation-preview/check-layout.mjs
```

The check uses fictional data and an isolated `agent-browser` session. It can
use the installed macOS Chrome binary or `AGENT_BROWSER_EXECUTABLE_PATH`.
Screenshots are local outputs under `dev-tmp/conversation-layout/`.

## Regressions found during migration

- Ordinary Space rows created unnecessary disabled message-preview observers.
  They now render directly from the Index preview; only direct messages mount
  their message-preview reader.
- Priority could show temporary idle ordering before the initial activity
  snapshot arrived. It now waits for that evidence while manual pins and Recent
  retain their independent ordering.
- Full-name and attributed activity tooltips had been lost. They are restored
  using the existing Tooltip and canonical Router link behavior.
- A collapsed group lost its unread count, and an active row showed a redundant
  ordinary unread dot. Both again follow the existing Inbox presentation policy.
- The direct-message group reused the Space creation action label. The two
  creation actions now name their own conversation kind.
- The inline activity icon moved 54px when hover revealed controls at 180px.
  It now uses the existing fixed `SidebarMenuBadge` slot; the browser check
  asserts stationary activity and non-overlapping actions on hover and focus.
