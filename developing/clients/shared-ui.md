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

This package owns UI mechanics and visual primitives only. It does not own
product copy, business rules, readiness, Wake state, setup state, Space truth,
or client routing.

Prefer existing Fluid components whenever the required primitive is available,
including dropdowns, selects, and action menus. Do not reconstruct menus from
generic Popover and Button components; reuse Fluid interaction behavior and the
shared radius tokens. Sidebar section actions reveal on their own section's
hover or keyboard focus, with open-menu and touch-device visibility preserved.

## Import Rule

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
`viewportRef` and `viewportProps` target the actual scrolling element.

Use `ScrollArea` for ordinary panes, directories, settings, card details,
account/workspace lists, and code previews. `ScrollAreaRoot`,
`ScrollAreaViewport`, and `ScrollAreaContent` support render composition with
existing scroll owners. The MessageScroller uses these parts while retaining
its own prepend, anchor, and automatic-follow behavior.

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
and menu hover/focus mechanics. The three-mode geometry is injected and saved
by the client; these primitives do not read cookies, routes, account state or
organization state. OpenMeld uses its existing Base UI/Motion dependencies and
semantic shape, typography and color tokens. Menu highlights use transforms;
measured group height and sidebar width only change when layout must change.
`fluid/nav-menu` supplies navigation semantics and controlled selection over
`fluid/sidebar-menu`; it does not own another hover or selection engine. Main
and secondary navigation share the same selection renderer. Clients supply a
stable `activeLayoutId` across route remounts, scoped to the sidebar presentation,
so selection also travels between groups. Composite rows retain their existing
links, actions, dimensions, and color overrides. Reduced motion removes travel.
`fluid/sidebar-user-footer` adapts the official horizontal user dropdown block;
clients provide identity, menu actions, and adjacent settings/theme buttons.
The existing `components/sidebar` family remains the inner resize-only surface;
clients must not nest both engines for one Main Sidebar.
Its unused menu primitives have been removed; menu consumers use the Fluid family.
Space pin controls reuse `SidebarMenuAction`: fixed action slots and opacity
reveal replace bespoke translation and blur. Unread and active-Wake markers
keep their own fixed slot while an adjacent action appears. Status precedence
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
Profile seed construction, Human-versus-Center-Agent foregrounds, uploaded-image
priority, or any product identity rule; those remain client composition.

`SettingsAccountProfileCard` accepts an optional composed avatar node so each
client can render its owned product identity without moving Profile rules into
`packages/ui`. Its source, alt text, and initials props remain the generic
fallback contract when no composed avatar is supplied.
