# Credits

OpenMeld builds on the work of open-source maintainers, designers, and contributors.
Thank you for sharing the tools and components that make this project possible.

## UI and interaction

Special thanks to **[Fluid Functionalism](https://github.com/mickadesign/fluid-functionalism)**
by **Micka Touillaud**. Many of OpenMeld's shared controls adapt its registry
components and interaction patterns, including Fluid Hover, menus, dialogs,
tabs, sidebars, and scroll areas. These live in [our shared UI package](packages/ui).
We retain its [MIT license](packages/ui/licenses/fluid-functionalism.MIT.txt).

| Project | Used in OpenMeld |
| --- | --- |
| [Base UI](https://base-ui.com/) and [Radix UI](https://www.radix-ui.com/) | Accessible interaction primitives |
| [shadcn/ui](https://ui.shadcn.com/) | Component sources and registry tooling |
| [Motion](https://motion.dev/) | Component animation and transitions |
| [Tailwind CSS](https://tailwindcss.com/) | Styling and design tokens |
| [Phosphor](https://phosphoricons.com/), [Lucide](https://lucide.dev/), and [Lobe Icons](https://github.com/lobehub/lobe-icons) | Interface and provider icons |
| [Geist](https://github.com/vercel/geist-font) | Geist, Geist Mono, and Geist Pixel fonts |
| [Apache ECharts](https://echarts.apache.org/) and [Evil Charts](https://evilcharts.com/) | Charts and chart components |
| [Extend UI](https://www.extend.ai/ui) | Adapted components in [the Web client](clients/web/src/components/extend) |

Other copied code and assets include AICSS Approval Card, Motion Primitives Dock,
Rare UI by Swami Malode, Animata, Tailark, and Hairline. Their source links and
notices are in [Third-party notices](THIRD_PARTY_NOTICES.md).
That index also credits demo portraits, emoji data, protocol code, community
documents, and development skills.

## Application foundations

| Project | Used in OpenMeld |
| --- | --- |
| [React](https://react.dev/) | Web and desktop interfaces |
| [TanStack](https://tanstack.com/) | Routing, application framework, and query state |
| [Electron](https://www.electronjs.org/) | Desktop application |
| [Hono](https://hono.dev/) | HTTP services |
| [Zod](https://zod.dev/) | Schema validation |
| [Fumadocs](https://fumadocs.dev/) | Public documentation |
| [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [pnpm](https://pnpm.io/), [Biome](https://biomejs.dev/), and [Vitest](https://vitest.dev/) | Development, builds, formatting, and tests |

## Dependencies and notices

This is a selected set of acknowledgments, not a complete dependency inventory.
Workspace `package.json` files declare direct dependencies; [pnpm-lock.yaml](pnpm-lock.yaml)
records the resolved dependency graph. Each dependency retains its own license.

For copied material and required notices, see [Third-party notices](THIRD_PARTY_NOTICES.md).
Credits do not replace license texts, copyright notices, or distribution requirements,
and inclusion here does not imply endorsement.

When adding a major upstream project or adapting its code, update these credits
and preserve the relevant notices as described in [Contributing](CONTRIBUTING.md#contribution-licensing).
