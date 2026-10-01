# Evil Charts primitives

Installed with the official registry CLI:

```sh
pnpm dlx shadcn@4.21.1 add @evilcharts/echarts-area-chart --cwd packages/ui --yes
```

Source: https://github.com/legions-developer/evilcharts, inspected at
`e78bc53bb4de28cd0e31bf407884b12ffb441227` (MIT; retained in `LICENSE`).
Registry: https://evilcharts.com/r/{name}.json. Runtime: Apache ECharts 6.1.

Import `@openmeld/ui/components/evilcharts/charts/echarts-area-chart` and compose
its Area, Grid, axes, Tooltip, Legend, or Brush slots. These slots compile into
ECharts options; they are not separate visual DOM components. The root owns
renderer lifecycle, ResizeObserver, theme observation, and loading effects.
`chartOptions` is a shallow top-level override, not a recursive merge.

Keep application data, period selection, and access scope in the client owner.
Lazy-load chart consumers. Use existing Fluid surfaces, Select, and Accordion
for surrounding UI. The first consumer adapts the official Audience Growth
block to daily token totals with one gradient area, linear segments, a zero
baseline, SVG, and an accessible daily table. It does not use decorative
multicolor fills, brush, selectable legends, or continuous stroke animation.

Local adaptations to preserve when updating registry source:

- Project aliases and existing `framer-motion` instead of a second Motion package.
- Strict indexed-access typing and bounded color interpolation.
- Null input values remain chart gaps rather than becoming fabricated zeros.
- Tooltip labels/values are escaped before entering ECharts HTML.
- Reduced motion stops loading and dashed-stroke loops, and the loading spinner.

The vendored source retains upstream structure and formatting, with lint rules
scoped off for this directory so upgrades stay reviewable. It remains subject to
TypeScript, build, and browser validation. Product consumers retain normal lint.
