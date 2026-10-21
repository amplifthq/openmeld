# Shared UI Client Package

## Agent Context

- Purpose: Define the ownership boundary for `@openmeld/ui`, the
  shared UI primitive package used by OpenMeld clients.
- Read this when: You are adding, moving, or changing shared UI primitives,
  design tokens, global UI CSS, Fluid components, reusable UI hooks, or imports
  from `@openmeld/ui`.
- Update this when: A UI primitive moves into or out of `packages/ui`, the
  design-token source changes, a new client starts consuming the package, or the
  package export contract changes.
- Do not use this for: OpenMeld product semantics, Space/Wake behavior, Web route
  ownership, Desktop service behavior, visual redesign briefs, or one-off page
  styling.
- Source of truth: This file owns the shared UI package boundary. Individual
  product surfaces remain owned by their client/product documents.

## Shared brand presentation

Web, packaged Desktop, and Website share `AppLogo`, `OpenMeldWordmark`,
`AppBrandStatusLabel`, `TextShimmer`, `PublicPageHeader`, and page-frame spacing.
Callers supply navigation destinations and slots; primitives read no sessions
or Organization state. `packages/ui/public` owns fonts, logos, icons, and favicon
outputs. `scripts/vite/shared-public-assets.mjs` materializes ignored client
copies when Vite loads. Edit shared sources, not generated copies. Shared font
declarations live in `packages/ui/src/styles/fonts.css`.

`OpenMeldLoadingScreen` accepts an optional content slot beneath the shared
opening mark. Clients own any guidance in that slot; the primitive reads no
platform, credential, or session state.

Static brand exports follow [the brand asset guide](../../packages/ui/brand/README.md).
Run `pnpm brand:generate` to update the shared public images and the existing
Desktop resources; `pnpm brand:preview` renders the approved surface matrix.
Browser tabs and menu bars use the wider monochrome O. Large brand images and
Desktop retain the outlined glow treatment. The generator and interactive logo
share `lib/openmeld-logo-lines.ts`; clients must not introduce private masters.

Public and retained cross-page headers reuse `OpenMeldLogoStrong`, the Website's
glowing wordmark. They omit a status label by default; an explicit label remains
available to the caller. `PublicPageHeader` accepts an optional navigation slot
and app-entry slot. `OpenAppButton` owns the public app-entry appearance: the
homepage uses its hero size; Website and Docs headers use its compact size and
regular control corners. The shared `PlatformBadge` supplies the Web label.
Website composes its existing lazy metal effect through the badge slot, with a
static reduced-motion fallback. These presentation slots do not own navigation
destinations or change the App's Log in action.

Docs also consumes the wordmark, fonts, and shared public assets. It retains
Fumadocs' layout CSS and accessible compound components. See `docs.md` for
the boundary when composing Fluid primitives with its Base UI version.

## Boundary

`packages/ui` is the shared home for reusable client UI primitives:

- base components such as Button, Card, Badge, Dialog, Input, Label, Tooltip,
  Avatar, Skeleton, Separator, Textarea, and ProgressiveBlur
- Fluid components that are reused across surfaces
- shared brand presentation primitives such as OpenMeld logo and mark variants
- global UI CSS tokens imported by clients
- reusable UI-only hooks and helpers such as proximity hover, springs, font
  weights, and `cn`
- reusable motion mechanics such as pointer-proximity magnification, with
  stable interaction hit areas and reduced-motion behavior

`lib/utils` re-exports `cn` from shadcn's zero-dependency `cn` package. Keep
client imports through `@openmeld/ui/lib/utils`; the shared package owns this
dependency. It combines conditional class joining and Tailwind v4 conflict
resolution without a local `clsx` / `tailwind-merge` wrapper. See the official
[cn migration](https://ui.shadcn.com/docs/cli#migrate-cn). Do not add a second
client-local implementation or a class-table build plugin without a measured
need.

This package owns UI mechanics and visual primitives only. It does not own
product copy, business rules, readiness, Wake state, setup state, Space truth,
or client routing.

`components/border-beam` exposes Libraries.dev's installed `border-beam`
primitive without a second effect implementation. Consumers own activation,
reduced motion, visibility, and presentation tuning. The frozen Website demo
uses it to draw attention to a prefilled Composer; product Composers do not.

`components/evilcharts` owns the official registry-installed Apache ECharts
area primitive and its theme, tooltip, legend, dot, and brush modules. Its
README records source provenance and local adaptations. Consumers compose
the compound API and lazy-load the rendering module; product scope, queries,
and surrounding interactions remain outside the chart primitive. Use Fluid
surfaces and controls around charts. Preserve null gaps, escaped tooltip text,
and reduced-motion loading behavior when refreshing registry source.

`lib/brand-chart-colors` owns the shared light/dark chart accents for model
brands and Local Agent controllers. OpenAI models reuse Codex's blue-purple;
Anthropic models reuse Claude Code's orange. Web chooses stable model variants
from model identity, never result order, spending, or the selected period.
Variants stay within the brand hue; unrecognized brands use neutral gray.
`BrandChartDot` consumes the same theme pair as the chart, so legends, curves,
and tooltips agree. Organization and Computer Local Agent charts retain the
same controller colors and monochrome-logo chart accents. Do not add a
client-local categorical palette that reassigns these brand colors.

`components/folder-component` adapts Rare UI's folder artwork and demo content.
It exposes controlled open state, a content slot, numeric scaling, and decorative
composition for an external accessible trigger. Repeated instances use unique
SVG filter IDs; reduced motion removes travel. Agent grouping and shared avatar
transitions stay in the Web-owned composition. The upstream license and credit
are retained beside the source and in the repository README. The Web-owned
`AgentFolders` composition is retained as an unused alternative; the directory
uses `AgentGroupCards`, composing Fluid Card and Fluid Nav Menu instead.

`VideoPlayer` composes Media Chrome's controls with shared design tokens and solid
surfaces. It owns no file fetching, credentials, cache, or Space identity. Global
media hotkeys are disabled so the chat composer retains its keys.
`MorphingDialogFrame` supplies a non-button shared-layout target for separate
Play and Expand controls. Base UI retains focus and dismissal ownership, including
caller-supplied close labels. An optional backdrop class disables video blur
without changing existing image previews.

`SettingsDialogContent` is the shared presentational shell for Space settings
and App settings: Fluid dialog behavior, a navigation slot, and independently
scrolling content. The default keeps the Space dialog dimensions; the spacious
variant scales width and height together for App settings. Its optional
`headerActions` slot places client-owned controls before the shared Close button.
Navigation models, section selection, permissions, and URL state remain in the
consuming client.

Prefer existing Fluid components whenever the required primitive is available,
including dropdowns, selects, and action menus. Do not reconstruct menus from
generic Popover and Button components; reuse Fluid interaction behavior and the
shared radius tokens. Sidebar section actions reveal on their own section's
hover or keyboard focus, with open-menu and touch-device visibility preserved.
Dropdown and context-menu popups default to content width, bounded by the
available viewport width. Short action labels stay on one line without inheriting
the trigger's width; constrained or explicitly sized menus may still wrap.
Space Agent work and reasoning share `fluid/thinking-steps` as their disclosure;
client code supplies the private reasoning, public progress, and admitted work
content without a second shared disclosure component.

### Fluid Hover reuse

`FluidNavMenu.listClassName` composes list or grid layout over the same measured
SidebarMenu hover, selection, focus and action scope. Product surfaces supply
responsive columns and disclosure; they do not introduce another hover engine.
`hoverMaxDistance` optionally bounds proximity by the distance in viewport pixels
from a real item edge. It maps to the shared hook's `maxDistance`; consumers that
omit it retain upstream nearest-item behavior. Pinned grids use 4px to bridge
their small gaps without highlighting across empty cells.

`hooks/use-fluid-hover` and `fluid/fluid-hover-highlight` are installed from the
official Fluid Functionalism registry. The import retains the vendor's nearest
enabled-item picking, coalesced measurement, pointer-session reset, optional
gap activation, and reduced-motion fade without travel. Package imports,
`interaction-hover`, and the existing shared spring tokens are the local
adaptations. Installation source:

```sh
pnpm dlx shadcn@latest add https://www.fluidfunctionalism.com/r/use-fluid-hover.json --overwrite
```

Review registry imports in an isolated directory before transferring them into
this package; do not overwrite existing shared tokens or adapted primitives.
`FluidActionList` composes this hook and highlight for shared action menus.
Gap activation is opt-in because generic menus can contain destructive actions;
the Sidebar display menu enables it for its reversible alternatives.

For context menus, use Base UI's ContextMenu root and trigger with
`FluidDropdownMenuContent` and `FluidDropdownMenuItem` or
`FluidDropdownMenuRadioItem`. The installed Base UI version shares its popup,
positioner, and item primitives between Menu and ContextMenu. Reuse these slots
instead of introducing a second Fluid context-menu visual or hover engine.
Base UI retains roles, keyboard navigation, selection, positioning, dismissal,
and focus restoration; Fluid Hover does not own those responsibilities.

`fluid/context-menu` composes these same slots. `FluidContextMenuScope` renders
the existing row/card through its trigger slot; an action owner supplies
`FluidContextMenuContent` beside its ordinary dropdown and reuses the same
items. `useFluidContextMenuOpen` exposes that root's controlled open state for
eligibility reads. Nested scopes open only the nearest menu. Inputs, editable
content, selected text, and disabled scopes retain native context menus.
`FluidDropdownMenuGroup` splits measured hover lists at semantic dividers;
`FluidDropdownMenuSubTrigger` keeps submenu triggers in their owning list.
Menu separators leave one spacing unit (4px) on each side, matching the menu's
content inset. Both shared menu families own this spacing.
Checkbox alternatives compose `FluidDropdownMenuCheckboxItem`,
so Base UI owns checked state and keyboard semantics while Fluid owns hover.
The reusable sidebar category/group filters own their semantic hover groups;
an embedded group trigger can instead register in its parent's indexed list.
Sidebar hover pauses
for open context-menu trigger slots as well as ordinary popup triggers; Base UI
context-menu areas expose an open marker without `aria-haspopup`.

Prefer this primitive for stable, closely spaced clickable alternatives in
menus, navigation, tabs, and grids. Use one list per semantic group; split at
dividers and register only real click targets. Skip proximity or gap activation
when a wrong click would hurt, clickability is mixed, empty space is large, or
rows move while scrolling. Disabled rows and intervening controls must retain
their own semantics. Existing specialized sidebar and tab geometry remains
owned by those components; clients must not recreate it. Verify travel across
rows and gaps, gap activation, keyboard operation, reopening, disabled states,
touch behavior, and reduced motion in the complete surface. Official reference:
[Fluid Hover](https://www.fluidfunctionalism.com/docs/fluid-hover).

Shared card and Inbox highlights notify only the departed and entered items.
`SharedLayoutGroup` and the sidebar reuse the UI-only `active-item-store`
subscription helper; this is a presentation projection, not product selection
or persistence. Sidebar rows batch DOM ordering and registration within a commit
instead of repeating whole-list work for each row. Preserve the existing DOM,
Motion layout identity, spring values, focus behavior, and reduced-motion path
when changing these optimizations. Check long groups in production-mode React;
development compiler memoization is not a production performance guarantee.


## Import Rule

`fluid/tooltip` adapts Fluid Functionalism's Base UI Tooltip registry. The
existing `components/tooltip` import forwards to this single implementation;
editor toolbars, sidebar controls, and former native-title hints all reuse it.
Hover waits 500ms, including standalone instances and adjacent triggers.
Keyboard focus remains immediate. Fluid shape, typography, spacing, and the
shared fast spring apply globally; reduced motion keeps the fade without travel.
Base UI owns placement, dismissal, and portal lifetime. Product code uses
`TooltipHint` for a single renderable child or the compound slots for composition.
Native iframe titles retain their accessibility meaning.

Repeated message actions use Base UI's native typed tooltip handle with the
same Fluid content. Detached triggers pass an explicit 500ms delay and share
the content's accessible description ID. One conversation owns the handle;
it is never a global cross-conversation popup or a second positioning system.

`components/link-preview-card` owns compact link metadata presentation only:
site, title, bounded description, and optional bounded image. It accepts
validated data from its consumer and performs no metadata requests or Space
authorization. Message-specific extraction, caching, and disclosure stay in Web.

`fluid/dialog` adapts the official Fluid Functionalism Base UI Dialog registry
(September 9, 2026). It owns the small/large/extra-large width ladder and elevated
surface, while reusing `components/dialog` for portal, focus, dismissal, and CSS
motion. It does not add a second state or animation engine. Reduced motion
removes panel animation. Product settings compose the existing `SettingsNav`
and `ScrollArea`; product sections and mutation rules remain Web-owned.
Dialogs use the fixed level-2 surface (`#1e1e1e` in dark mode) with level-4
shadow depth. Nested dialogs keep this same background rather than progressively
brightening with their parent's surface. Child controls inherit level 2.

### Scroll ownership

`@openmeld/ui/fluid/scroll-area` owns scroll presentation. It adapts Fluid
Functionalism's Base UI implementation using the installed Base UI ScrollArea:
4px thumbs in 10px tracks, wider thumbs on hover, and visibility on hover or
scroll. Reduced motion disables transitions. Coarse pointers retain native
scrolling; custom tracks are hidden. The viewport remains the same element
across pointer modes, preserving focus and scroll position.

Base UI owns overflow measurement. A 12px content mask appears only on edges
with hidden content, without guessing the parent surface color. Vertical areas
constrain intrinsic content width; horizontal areas keep intrinsic measurement.
The mask's four `--fluid-fade-*` properties do not inherit: an edge change must
not invalidate styles throughout a long transcript beneath the viewport.
`viewportRef` and `viewportProps` target the actual scrolling element.

Use `ScrollArea` for ordinary panes, directories, settings, card details,
account/workspace lists, and code previews. `ScrollAreaRoot`,
`ScrollAreaViewport`, and `ScrollAreaContent` support render composition with
existing scroll owners. The MessageScroller uses these parts while retaining
its own prepend, anchor, and automatic-follow behavior.

Work summaries, live work details, file viewers, command lists, selects, and
horizontal tables also compose this owner with fades enabled. Keep refs and
scroll handlers on the viewport, and content layout and padding on the content
slot. The viewport is positioned so measured hover geometry stays relative to
the scrolling element. Do not maintain viewer-local copies of ScrollArea or
disable their fades. Long dialogs keep their close control outside the scrolling
body and reuse ScrollArea for that body.

Native browser document scrolling, editable fields, editor-owned selection
containers, and geometry-sensitive overlays keep their owning DOM and use the
shared hover-only native scrollbar color ramp. Do not insert an extra scrolling
element inside an editable field or give a menu a second keyboard owner. The
old Web-only Radix ScrollArea and its separate edge observer were removed.

When a shared primitive exists in `@openmeld/ui`, clients should
import it from the package instead of keeping or recreating a local duplicate.

Examples:

```ts
import { Button } from "@openmeld/ui/components/button";
import { TabsSubtle } from "@openmeld/ui/fluid/tabs-subtle";
import { cn } from "@openmeld/ui/lib/utils";
```

Client-local UI files are allowed when the primitive is genuinely client-bound
or not yet shared. They must not duplicate an existing package export with a
different API or visual meaning.

`MagnifyingDock` owns only pointer-proximity motion and fixed item geometry. A
client composes product-specific choices, labels, selection semantics, and
Fluid shared-layout backgrounds inside its items. Magnification is limited to
fine-pointer hover, keeps the selectable hit areas stationary, and becomes
static when reduced motion is requested. Product surfaces must keep choices
identifiable without requiring the magnification effect.

`fluid/sidebar`, `fluid/sidebar-state`, `fluid/sidebar-group`, and
`fluid/sidebar-menu` adapt the Fluid Functionalism Base UI Sidebar registry
(retrieved September 5, 2026). They own resize/collapse/peek, slots, disclosures,
and menu hover/focus mechanics. Geometry, expanded-width bounds, and whether
the icon-only snap tier is allowed are injected by the client. Web module lists
disable that tier for pointer dragging and keyboard resizing; they use the same
two-state contract in the Website demo. The visible list stops shrinking at its
readable minimum; collapsing requires the pointer to travel another third of
that minimum width plus 16 px inward. Expansion retains its separate boundary
at two-thirds of the minimum width plus 8 px, so outward dragging opens sooner
without toggling around one boundary. Geometry is saved by the client; these
primitives do not read cookies, routes, account state or
organization state. OpenMeld uses its existing Base UI/Motion dependencies and
semantic shape, typography and color tokens. Menu highlights use transforms;
measured group height and sidebar width only change when layout must change.
Sidebar hover picking and rendering reuse `useFluidHover` and
`FluidHoverHighlight`, with the vertical axis and gap clicks disabled. A new
pointer entry fades in at its nearest item; route selection has its own marker.
Purely visual dividers within a navigation group do not create another hover
scope. Hover-preview triggers opt out of popup suspension with
`data-sidebar-hover-preview`; actual context menus still suspend tracking.
Portaled popup pointer events do not drive the sidebar's highlight.
`fluid/nav-menu` supplies navigation semantics and controlled selection over
`fluid/sidebar-menu`; it does not own another hover or selection engine. Main
and secondary navigation share the same selection renderer. Clients supply a
stable `activeLayoutId` across route remounts, scoped to the sidebar presentation,
so selection also travels between groups. Composite rows retain their existing
links, actions, dimensions, and color overrides. Reduced motion removes travel.
`fluid/sidebar-user-footer` adapts the official horizontal user dropdown block;
clients provide identity and menu actions. `SidebarUserMenuItem` supplies the
account trigger and a composed menu slot. Web places Search, Settings, and
theme controls inside that menu, with one Fluid hover group per semantic section.
`FluidActionList` accepts a horizontal axis for compact controls while preserving
its existing reduced-motion behavior.
The existing `components/sidebar` family remains the inner resize-only surface;
clients must not nest both engines for one Main Sidebar.
Its unused menu primitives have been removed; menu consumers use the Fluid family.
Sidebar rows compose `SidebarMenuButton`, `SidebarMenuAction`, and
`SidebarMenuActions` from the Fluid source. Hidden actions reserve width only
while revealed by hover, keyboard focus, or an open menu; touch layouts keep
actions visible. Do not add permanent action padding or a second reveal
implementation in clients. Unread and active-Wake markers keep their own slot.
Status precedence
continues to come from the Space presentation owner. Standalone visual cases
are documented in `scripts/dev/sidebar-fixtures.md`.

`TabsSubtle` with `variant="underline"` preserves flat header tab geometry while
sharing the Fluid proximity-hover surface and a Motion selection underline.
Space and Center Agent headers reuse this variant. Route-remounted headers pass
a stable `indicatorLayoutId`; DOM tab/panel IDs remain instance-specific.
Reduced motion removes travel, and hover animation requires a fine hover pointer.

Shared interaction surfaces use `interaction-hover` and `interaction-active`.
These follow Fluid's neutral alpha layers (light: black 4%/7%; dark: white
6%/10%), so selection remains stronger than hover and overlapping states
accumulate. Sidebar, action menus, tabs and select options reuse these tokens;
do not substitute opaque surface colors. Keyboard focus retains its ring.

`FluidSelect` accepts a composed React display value so a product-owned choice
may pair its text with an existing shared primitive such as `Badge`. The Select
continues to own listbox behavior, focus, keyboard navigation, and layout; the
client owns the choice metadata and copy.
Embedded editors may use `onCloseAutoFocus` to cancel trigger focus restoration
and return focus to their editing selection. Ordinary Selects continue to return
focus to the trigger. Disabled options expose their state to assistive technology.

## Change Rule

Add or change shared primitives in the smallest place that preserves reuse:

- shared across clients or likely to become shared: `packages/ui`
- Web-only route or product surface composition: `clients/web`
- Desktop-only shell, tray, or setup composition: `clients/desktop`

Do not move whole product surfaces into `packages/ui`. The package should expose
small primitives and UI helpers; client documents own the user flow and meaning.

The dark `--background` value in `packages/ui/src/styles/globals.css` is the
canonical app and platform-chrome background color. Web theme metadata, Web app
manifests, and the Desktop native window keep literal copies because those
surfaces cannot read a runtime CSS custom property. After changing the canonical
token, run `pnpm sync:theme-background`; `pnpm verify:theme-background` fails
when any required copy drifts.

### Interface shape tokens

`packages/ui/src/styles/globals.css` owns one interface-shape source of truth:
`--radius`. Every Tailwind radius token from `--radius-xs` through
`--radius-4xl` derives from it, so shared and client-local components must use
semantic Tailwind radius utilities instead of fixed pixel radii or
`rounded-none`. The root defaults to the Rounded appearance; a client applies
its selected shape and base radius to the document root before rendering. The
shared `DEFAULT_ROUNDED_SHAPE_RADIUS_PX` preset supplies Linear's standard
control radius of `8px` to both the CSS root token and Fluid's numeric geometry.
A future custom pixel control passes its value through those same two inputs,
not individual components.

`ShapeProvider` owns the shared React shape contract and the numeric radii used
by Fluid merge/split geometry. It is intentionally persistence-agnostic: each
client injects its selected shape, numeric radius, and persistence behavior.
Fluid selected, hover, highlight, merged, and focus backgrounds consume the
same semantic classes as ordinary controls and surfaces.

Web's People, Agents, and Computers directory cards compose the same Fluid
shared-layout primitive through one Web-owned card-grid wrapper. Each item owns
the semantic `bg-card` resting surface, while the shared-layout background owns
hover and delegated-focus highlighting. Card content remains transparent so it
cannot hide that shared indicator, and consumers must not add a competing CSS
hover background.

Organization picker cards use this same Fluid Card group. The Fluid item keeps
direct link/button content transparent so the shared highlight remains visible.

`Surface` pairs the existing substrate and shadow tokens. The shared `Card`
starts at the semantic card surface; nested `Surface` or `Card` instances rise
one level, capped at level three to keep dense settings quiet. These surfaces
use the configurable radius tokens. Account provider rows, password forms,
session rows, and their loading placeholders reuse this primitive. Static
surfaces do not acquire interactive card hover behavior.

`SharedLayoutGroup` also accepts controlled active-item state for listbox and
combobox compositions. Controlled consumers must feed pointer and delegated
focus changes back into the same owning selection store; they must not add a
second local hover background beside the shared indicator.

`Tabs`, `TabsList`, `TabItem`, and `TabPanel` are the vendored Fluid Base UI
Tabs composition. They reuse the shared proximity hook and surface tokens,
with raised selection at two levels above the surrounding substrate.
`TabsList background={false}` removes the track without flattening selection.
The upstream hover color maps to the existing `interaction-hover` token.
Conditional children are indexed after React removes empty slots. Value order,
measurement registration, and the selected indicator use that same rendered
order; hiding a tab must not leave a hole before the next selectable tab.
`PageToolbar` owns the shared 48px minimum row height, wrapping, and vertical
alignment for page navigation and actions. It adds no interaction roles or state;
the composed Fluid controls retain their keyboard and pointer behavior. Files
and Routines use this same row instead of independent toolbar geometry.
Tab content inherits its selected substrate so nested badges can rise one step.
The eight-level context and paired class resolver live in `@openmeld/ui/lib`;
Web's `Elevated` consumes those same primitives.

Agent configuration cards use that same substrate-relative surface at offset
two, matching the runtime Tabs selection. Cards and their shared hover
indicators use `rounded-md`; editor popovers rise one further surface level.
Do not reintroduce card-local border/shadow recipes or oversized radius overrides.

The Agent dashboard includes a read-only Usage limits card in the same grid.
For the Agent's owner it reuses the shared quota donut, status rules, provider
labels, and observation times; it is not an editable setting or an independent
source of Wakeability. Its readout must load independently of the owner's
editable Binding settings.

Team-facing usage never shows a quota percent. The teammate's Usage limits
card, the profile popover, the mention picker, and the local-agent rings on a
person's card stay quiet while the Agent has room. They show only **Near usage
limit** when a fresh limit is at or below the Low threshold (20% left), or
**Usage limit reached · resets in 6 days** when a fresh limit is exhausted. The
owner's Local agents settings keep the full rings.

### Loading regions

`OpenMeldLoadingScreen` presents a centered, pointer-responsive shared Logo
without visible loading copy or a progress bar. Web first-run admission and
Desktop session loading reuse this surface. Their callers retain pending,
authentication, error, and retry ownership; the Logo honors reduced motion.

Keep the authorized shell, navigation, known identity, and unrelated usable
content visible while a region loads. Shared `SkeletonRegion`, `SkeletonRows`,
`SkeletonForm`, and `SkeletonTable` are presentation only: the caller owns query
state, authorization, retry, and empty-state decisions. Choose shapes and
geometry that match the actual card, list, form, table, or conversation; one
whole-page gray rectangle is not an equivalent replacement. Shapes are
decorative, with one accessible announcement per region and reduced-motion
support. Never turn an unknown setting into an unchecked switch or default
selection while waiting for its saved value.

First-load placeholders must not clear same-subject content during background
refresh. Do not preserve one account, Organization, Profile, Computer, or Binding's
content under another identity; revocation and identity failures are not normal
stale-data refreshes. Keep error/offline outcomes separate from pending and
confirmed-empty results. Existing mutation progress, download progress, and
pagination feedback remain inline rather than replacing loaded content.

Lazy Space panels import their fallback shapes from a lightweight module, not
from the lazy panel itself. Code loading and data loading reuse the same panel
geometry without defeating the code-splitting boundary.

Welcome Create/Join actions reuse Fluid Card shared-layout hover with disabled
items excluded from highlighting. Radio selection uses the same offset-two
surface recipe as Tabs. Web composers share `PromptInput` and the shared UI
`styles/composer.css` finish, also used by the Website Codex demonstration:
fixed light/dark backgrounds, one quiet 1px border, no shadow, and 18px corners.
Shared card token changes must
not change this finish. Its content retains level-two context so Wake/Reference
tokens use level three. These changes do not alter access policy or send behavior.

Space and Thread pending actions mount inside the shared composer width. Their
inset, collapsible strip overlaps behind the composer edge. Plan, question, and
permission forms reuse the AICSS-adapted `ApprovalCard` anatomy; its shared Fluid
ScrollArea bounds request details and provides edge fades, while response actions
remain outside the scrolling body. The primitive never approves or advances a
request; the existing interaction owner retains all response and access policy.

`TabsSubtle` also exposes an `underline` variant for flat navigation embedded
against a structural divider. It keeps selection rectangular, uses the owning
surface edge as the indicator baseline, and does not introduce a second rounded
selection surface.

Intrinsic circles remain `rounded-full` in both styles. This exception is only
for shapes whose meaning depends on being circular, including avatars, status
dots, radio indicators, switch tracks and thumbs, and loading rings. It is not
an escape hatch for buttons, cards, menus, dialogs, inputs, or layout surfaces.

Avatar images and fallbacks own their circular clipping. The Avatar root must
allow overflow so `AvatarBadge` can sit over the outer edge with its background
ring intact; client surfaces should not repair badge clipping with local
positioning exceptions.

`AvatarAction` owns the top-right interactive avatar affordance. It keeps the
visible control compact while preserving a 44-by-44-pixel pointer and touch
target, including its focus treatment. Client surfaces supply only the action,
label, icon, and visibility policy.

`DitherAvatarBackground` owns only deterministic, decorative Canvas rendering
at the requested display size and a bounded device pixel ratio. It does not own
Profile seed construction, Human initials, uploaded-image
priority, or any product identity rule; those remain client composition.

`FluidAvatar` owns the decorative fluid avatar primitive, adapted from Rare UI's
Fluid Orb. It is distinct from Web's `SpaceAgentOrb` working-status indicator.
Its `animated` and `animateOnHover` props are independently opt-in. Each avatar
returns to its initial frame when animation ends or reduced motion is enabled.
Offscreen and hidden documents suspend playback until visible again.
The single-avatar creation preview opts into autoplay;
other surfaces opt in through working state or hover. One
128-pixel WebGL renderer serves the page; avatar instances retain small 2D
frames. Static frames are cached by color with a 64-frame limit. Idle instances
do not subscribe to animation frames. Context failure preserves a rendered
frame or the supplied fallback without repeatedly allocating GPU contexts.

Web's `RemoteAgentAvatar` uses the stable Profile ID as the saved fluid avatar
seed. Hosted Remote Agents default to the selected model provider's existing
`ModelBrandIcon`, using the exact provider namespace of the directory's current
`avatarModelId`, never the model display name or the OpenRouter calling channel.
Unknown providers or missing logo assets use the generic Agent mark. Saved images
and explicitly selected fluid avatars take precedence across model changes.
Center Agents display their saved Bot or fluid style; authorized admins can
select either. Missing or legacy automatic style uses the shared Clover Bot
default, without persisting a selection or hashing the Profile ID to invent one.
The app shell provides one read of the existing Organization
Profile Directory to every avatar entrance. Saved preferences are applied to
loaded profile caches and invalidated after a successful save. Idle and read-only
editors use the same saved Profile; only an unsaved user selection is a preview.
Center Agent's welcome area also uses this Profile avatar instead of the brand
logo, with the shared playful click animation and nearby pointer tracking.
After Save, shell avatars derive an optimistic view from the pending
Organization/Profile-scoped mutation; the confirmed directory cache stays intact.
Failed saves remove that pending view and return to the current saved identity.
Successful saves also send an account/Organization/Profile-scoped browser refresh
hint. Other tabs re-read their own authorized directory; the hint carries no
avatar data and does not add directories to browser persistence. Model saves
refresh the same directory projection and update automatic Remote logos.
Shared `BotAvatar` composes the public `bot-avatars` simulation and renderer so
click feedback and pointer following are independent. The shared default is Fabric;
its `shading` prop also supports Plastic. Both rendering paths use the same palette
and the library's material-specific lighting defaults. Still-frame cache keys include
the material and palette so changing either cannot reuse an old finish.
`lib/bot-avatar-palette` owns all eighteen Bot colors for Website and Web.
The cloud uses a neutral white in Original and Soft, with material lighting
providing its depth.
Appearance offers Original, Balanced, Soft, Slate, and Sand palettes through the existing browser
preference store; this is a viewer preference, not a change to saved Profile identity.
An explicit saved Profile palette takes precedence. A Bot without a saved palette
inherits Appearance colors in both the editor preview and every avatar entrance.
The editor leaves Profile color choices unselected until the user chooses one;
it must not label an inherited palette as a saved Original choice. Changing only
the Bot type uses the existing `avatarStyle` write and preserves Appearance
inheritance. Choosing a Profile palette saves that explicit choice without
persisting the viewer's inherited colors.
Both preview and saved rendering use the selected colors without extra saturation.
The Website demo
starts with Original to match the hero; the product keeps its existing Soft default.
The regular renderer includes an SVG first frame using the vendor's shape and
face placement in server HTML, then replaces it with the rendered canvas on mount.
Space avatars play one small hop on an explicit click. Center Agent sidebar
avatars use the shared Bot's `pointer` interaction: nearby mouse tracking with
no click motion, while real working state keeps its animation. Popover opening
and navigation still belong to their existing controls. Profile popovers use
the shared Bot's explicit `playful` interaction:
natural idle gaze, fine-pointer following, and the library's full click spin.
Avatar editors use the same simulation and rendering path, with saved identity
and draft identity remaining separate. The Team Center Agent card has a
separate avatar button that also
follows a fine pointer while hovered; its remaining area opens the conversation.
The avatar editor retains the library's original preview interaction. The Website
hero opts into `ambient` motion: the vendor's idle movement, nearby pointer
tracking, and full click jumps, with one shared vendor ticker. Its SVG first
frame remains visible before hydration; the canvas replaces it after its first
layout paint. Reduced motion keeps a still pose, and the vendor pauses ambient
rendering offscreen and in hidden documents.
Subtle Bot avatars do not hop when idle and animate for real working state.
Clicks do not queue or restart a subtle hop; playful clicks use the library's
own spin interruption rules. Static instances do not subscribe to animation
frames or visibility observation; active rendering pauses offscreen and in hidden
documents. A cache of at most 64 independently rendered still frames avoids
freezing the library's lighting blend when animation stops.
Finished or interrupted motion returns to the resting pose, and
reduced motion suppresses animation. Wrappers leave overflow visible so moving
Bot geometry is not clipped.
Personal Remote Agents use rounded squares, Center Agents use circles, and Local Agents
retain their harness logos. Web supplies authoritative working state; the
primitive never infers work from presence or starts its own status queries.

`SettingsAccountProfileCard` accepts an optional composed avatar node so each
client can render its owned product identity without moving Profile rules into
`packages/ui`. Its source, alt text, and initials props remain the generic
fallback contract when no composed avatar is supplied.

## Searchable Fluid Select

`SelectContent.search` provides an optional controlled search input outside its
listbox and bounded Fluid ScrollArea. Callers filter domain options; the shared
primitive owns focus, dismissal, selected-item scroll, and Fluid Hover geometry.
Reset a transient query through the Select root's `onCloseAutoFocus` without
preventing normal focus restoration. Do not rebuild a searchable popup in a
product component.
