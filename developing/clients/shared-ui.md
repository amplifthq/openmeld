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

This package owns UI mechanics and visual primitives only. It does not own
product copy, business rules, readiness, Wake state, setup state, Space truth,
or client routing.

## Import Rule

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

`FluidSelect` accepts a composed React display value so a product-owned choice
may pair its text with an existing shared primitive such as `Badge`. The Select
continues to own listbox behavior, focus, keyboard navigation, and layout; the
client owns the choice metadata and copy.

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
