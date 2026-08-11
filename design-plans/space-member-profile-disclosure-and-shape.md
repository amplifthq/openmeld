# Make Space member profiles scannable, discoverable, and shape-aware

Written against: `733a1662a5f033dd0fbc64b339e15f69a42e5749`

Implemented in: `f542aed5c`, `11c43a5a2`

## Evidence chain

- Surface: authenticated Space desktop Members side panel and mobile Members drawer, rendered through `clients/web/src/components/spaces/space-members-drawer.tsx` -> `clients/web/src/components/spaces/space-member-row.tsx` -> `clients/web/src/components/profiles/profile-list-item.tsx`.
- Problem: a full Agent Profile row permanently renders three independent detail layers: the readiness or connection summary, controller/model metadata, and a joined recovery/membership/history sentence. In the supplied narrow Members panel, the last layer wraps into a paragraph and repeats facts that are available in Profile Details.
- Problem: Profile Details already opens from the profile name/avatar, but that implicit target is not discoverable. `SpaceMemberActionsMenu` contains only the gated edit and removal actions, so a Center Agent or an Agent Profile without either mutation has no three-dot menu at all.
- Problem: the Members action menu is a hand-built `Popover.Popup` without a semantic radius class. Its item buttons also omit semantic radius classes. The shared `DropdownMenuContent` and `DropdownMenuItem` already use `rounded-md`, so they follow the root `--radius` token; this one local menu bypasses that primitive and therefore remains square in Rounded mode.
- Design evidence: `developing/product/experience-principles.md` requires one current outcome, one next action, and a diagnostic path, and says optional detail should expand only when requested. `developing/product/agent-profiles.md` reserves richer owner diagnostics for Profile Details. `developing/clients/web.md` requires Web Profile Details to consume the shared snapshot rather than stitch browser facts. `developing/clients/shared-ui.md` requires semantic Tailwind radius utilities and explicitly says menus and popovers are not shape exceptions.
- Existing detail owner: `packages/agent-profile/src/profile-details.ts::buildProfileDetailsSnapshotFromSpaceMember` already places model/controller facts under **Connection**, `Added by` and `Last seen` under **Space membership**, the Core summary under **Wake availability**, and reason codes under **Advanced details**. No parallel details model is needed.
- Existing menu exemplar: `clients/web/src/components/organization-documents/organization-document-list-rows.tsx` composes `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, and `DropdownMenuItem` around the shared `Button` while preserving locally owned actions and dialogs.
- Shape inventory: all four current consumers of shared `DropdownMenuContent` inherit semantic rounding. Of the seven direct `Popover.Popup` consumers, five already use `rounded-md`; only `clients/web/src/components/spaces/space-member-row.tsx` and the outer popup in `clients/web/src/components/spaces/space-mention-popover.tsx` omit it.
- Owner: Space row composition and action visibility remain in `clients/web`; menu mechanics and radius tokens remain in `@openmeld/ui`; Profile Details data remains in `@openmeld/agent-profile`.
- Scope and affected surfaces: full Space member rows in desktop and mobile Members surfaces, the shared Space Profile Details dialog entry, and the Space `@mention` picker outer surface. Compact member rows, Directory Agent Profile card structure, readiness computation, recovery planning, and Profile Details schemas remain unchanged.
- Uncertainty: none. The supplied screenshots, current rendering path, existing shared detail snapshot, existing action-menu exemplar, and shape contract determine one correction.

## Design decision

Make the full Members row a summary, not a diagnostic report. Keep the profile identity, public availability badge, and one primary readiness/connection sentence or actionable recovery control visible. Stop permanently rendering controller/model metadata and the joined recovery/membership/history sentence in the row; those facts remain available through the existing Profile Details snapshot. Do not move paragraphs into tooltips: keep the existing short status tooltip, and use **About the profile** as the explicit disclosure path for richer information.

Give every full Agent Profile row a three-dot action menu whose first item is the existing product label **About the profile**, regardless of profile ownership or mutation permission. Preserve the profile-name/avatar shortcut. Keep Edit and Remove independently gated by their existing permissions. Implement the menu with the shared Dropdown Menu primitives so both the popup and items inherit the global shape token instead of duplicating menu mechanics with a raw Popover.

Apply the same missing semantic radius to the `@mention` picker outer popup. This is the only other direct Web popup proven to bypass the shape token; its option rows already use semantic radius classes.

## Reuse

- `@openmeld/ui/components/dropdown-menu`: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, and `DropdownMenuItem`.
- `@openmeld/ui/components/button`: retain the existing `icon-sm` trigger size and accessible member-specific label.
- `clients/web/src/components/spaces/use-space-profile-details-dialog.tsx`: retain the one details state/snapshot owner and pass `openProfileDetails` into the action composition.
- `packages/agent-profile/src/profile-details.ts::buildProfileDetailsSnapshotFromSpaceMember`: retain as the single details model; do not create row-local copies of its sections.
- Exemplar: `clients/web/src/components/organization-documents/organization-document-list-rows.tsx`.

## Changes

1. `clients/web/src/components/spaces/space-member-row.tsx`
   - Change: remove the full Agent row's `secondaryDetail` controller/model line and `metadataDetail` joined recovery/membership/history line. Keep `primaryDetail`, badges, and the existing recovery action control so the row still answers the current state and immediate next step.
   - Preserve: raw Core/Space readiness data, display-only Wake smoothing boundaries, recovery eligibility, `Check again`, Wake access guidance, sorting, mention behavior, owner visibility, and Profile Details content.
   - Verify: Available, Checking, Offline, and Unavailable rows show no more than one explanatory text line group below the identity/status line, plus one action only when the existing recovery contract provides it.

2. `clients/web/src/components/spaces/space-member-row.tsx`
   - Change: add `openProfileDetails` as an explicit Agent action and render the full Agent row menu even when Edit and Remove are absent. Order items as **About the profile**, then Edit when owned/editable, then Remove when permitted. Keep Human Profile action visibility unchanged.
   - Change: replace the raw `Popover` action-menu composition with the shared Dropdown Menu primitives. Use `DropdownMenuItem` for every action and its `variant="destructive"` for removal. Preserve dialog state and async removal behavior in the Space component.
   - Preserve: the existing profile-name/avatar About shortcut, `Member options for <name>` trigger label, edit ownership check, removal eligibility, confirmation dialog, pending state, toast copy, and error context.
   - Verify: Center Agent, owner Agent Profile, and other-owner Agent Profile rows all expose **About the profile**; only authorized rows expose Edit or Remove; choosing About opens the same shared details dialog.

3. `clients/web/src/components/spaces/space-member-row.test.tsx`
   - Change: add behavior coverage for opening Profile Details from the menu for an Agent Profile with no mutation actions, and for menu visibility/action gating across Center Agent or non-manageable, manageable, and removable rows.
   - Change: assert controller/model, recovery narrative, `Added by`, and `Last seen` are absent from the row but present in the opened details dialog when the shared snapshot permits them.
   - Change: assert the rendered menu popup and items contain semantic radius classes through the shared primitive; do not assert a literal pixel radius.
   - Preserve: existing tests for name-click details, editing, removal confirmation, readiness truth, owner-only details, display smoothing, and recovery behavior.

4. `clients/web/src/components/spaces/space-members-drawer.test.tsx` and `clients/web/src/components/spaces/space-landing.integration.test.tsx`
   - Change: update only assertions that currently require the removed inline metadata or recovery paragraph. Reassert those facts through **About the profile** where the test is about data visibility; delete the assertion when the test is only about readiness or member ordering.
   - Preserve: end-to-end member ordering, current-profile behavior, permission gates, refresh behavior, and Core-owned status expectations.

5. `clients/web/src/components/spaces/space-mention-popover.tsx` and `clients/web/src/components/spaces/space-mention-popover.test.tsx`
   - Change: add `rounded-md` to the outer `Popover.Popup` and cover the semantic class in the existing component test.
   - Preserve: listbox semantics, keyboard/hover selection, fixed positioning, collision behavior, clipping, option-row shape, and relation actions.

## Scope

- Inherit: desktop Members side panel and mobile Members drawer both consume the same full `SpaceMemberRow`, so they receive the concise row and About menu together. Rounded, Square, and future custom radii inherit from the existing root token.
- Verify: owned local Agent Profile, other-owner Agent Profile, Center Agent, Available, Checking, Offline, Unavailable, narrow resized panel, mobile drawer, and the `@mention` picker.
- Exclude: Human Profile menu policy, Directory Agent Profile layout, Agent Profile Details schema changes, readiness/recovery computation, global tooltip redesign, animation changes, and unrelated Popover consumers already using semantic rounding.

## Validation

- Product: in one Space with a Center Agent and at least two local Agent Profiles, confirm each row is scannable, every Agent Profile menu opens the existing details dialog, and only the authorized mutation actions appear.
- Interface: verify at narrow and wide Members panel widths plus the mobile drawer; test long profile names, long readiness summaries, missing model, missing `Last seen`, all four public availability states, and the `@mention` picker.
- Interface: switch Appearance between Rounded and Square. In Rounded, the member menu popup/items and mention picker use the current root radius; in Square, the same semantic classes resolve to square corners. Preserve intrinsic circular avatars and status dots.
- System: confirm no new Profile Details state or schema was introduced, row display changes do not alter the raw `entry`, and the action menu imports the existing shared primitive instead of adding local fixed radius values.
- Repository: `pnpm --filter openmeld-web test -- src/components/spaces/space-member-row.test.tsx src/components/spaces/space-members-drawer.test.tsx src/components/spaces/space-mention-popover.test.tsx` -> focused component behavior passes.
- Repository: `pnpm --filter openmeld-web test:integration -- src/components/spaces/space-landing.integration.test.tsx` -> affected Space integration behavior passes.
- Repository: `pnpm run check:affected` -> affected package formatting, lint, and type checks pass.
- Repository: `git diff --check -- clients/web/src/components/spaces design-plans` -> no whitespace errors.

## Stop conditions

- Stop if the shared Profile Details snapshot no longer contains the model, membership/history, Wake summary, or advanced reason facts; repair that single contract instead of creating row-local details state.
- Stop if a mutation action needs menu behavior that the shared Dropdown Menu cannot represent without changing its generic contract; document the missing primitive behavior before adding another local menu abstraction.
- Stop if the implementation would change readiness, recovery eligibility, owner visibility, or Space membership authority; those are outside this presentation change and require their owner documents and behavior tests.

## Design documentation

- After acceptance and validation: none. The change applies the existing experience, Agent Profile diagnostic-disclosure, Web Profile Details, and shared shape contracts without changing them.
