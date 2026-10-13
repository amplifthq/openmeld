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
| [Beam / border-beam](https://libraries.dev/beam), by Jakub Antalik | Animated borders, exposed through the shared UI package |
| [Bot avatars](https://libraries.dev/bots), [Thinking orbs](https://libraries.dev/orbs), [Gooey](https://libraries.dev/gooey), [Metal](https://libraries.dev/metal), and [Image](https://libraries.dev/image), from Libraries.dev | Agent avatars, activity indicators, and visual effects |
| [Tailwind CSS](https://tailwindcss.com/) | Styling and design tokens |
| [Phosphor](https://phosphoricons.com/), [Lucide](https://lucide.dev/), [Lobe Icons](https://github.com/lobehub/lobe-icons), [Hugeicons](https://www.npmjs.com/package/@hugeicons/react), and [Tabler Icons](https://www.npmjs.com/package/@tabler/icons-react) | Interface and provider icons |
| [Outpace Avatars](https://github.com/outpacelabs/avatars) | Avatar rendering |
| [Geist](https://github.com/vercel/geist-font) | Geist, Geist Mono, and Geist Pixel fonts |
| [Apache ECharts](https://echarts.apache.org/) and [Evil Charts](https://evilcharts.com/) | Charts and chart components |
| [Extend UI](https://www.extend.ai/ui) | Adapted components in [the Web client](clients/web/src/components/extend) |
| [Motion Primitives](https://motion-primitives.com/) and [Skiper UI](https://skiper-ui.com/) | Adapted Dock, Text Morph, Morphing Dialog, and progressive blur components |
| [Ariakit](https://www.npmjs.com/package/@ariakit/react), [cmdk](https://www.npmjs.com/package/cmdk), [Vaul](https://www.npmjs.com/package/vaul), and [Sonner](https://www.npmjs.com/package/sonner) | Accessible controls, command menus, drawers, and notifications |
| [React DayPicker](https://www.npmjs.com/package/react-day-picker), [React Joyride](https://www.npmjs.com/package/react-joyride), and [Frimousse](https://github.com/liveblocks/frimousse) | Date selection, guided tours, and emoji selection |
| [dnd kit](https://www.npmjs.com/package/@dnd-kit/core), [React Flow](https://www.npmjs.com/package/@xyflow/react), and [Dagre](https://www.npmjs.com/package/@dagrejs/dagre) | Drag and drop, interactive graphs, and graph layout |
| [Three.js](https://www.npmjs.com/package/three), [Media Chrome](https://www.npmjs.com/package/media-chrome), and [Cuelume](https://github.com/Danilaa1/cuelume) | Graphics, media controls, and captions |

Other copied code and assets include AICSS Approval Card, Animata, Tailark,
and Hairline. Their source links and
notices are in [Third-party notices](THIRD_PARTY_NOTICES.md).
That index also credits demo portraits, emoji data, protocol code, community
documents, and development skills.

### Rare UI

The folder artwork and primitive are adapted from [Rare UI](https://rareui.com)
by **Swami Malode**.
The component retains its [MIT + Commons Clause + Attribution license](packages/ui/src/components/folder-component.LICENSE.md),
including additional restrictions beyond OpenMeld's root MIT license.
See [Rare UI terms](THIRD_PARTY_NOTICES.md#rare-ui-terms) for the notice and distribution requirements.

The shared avatar shader also adapts Rare UI's Fluid Orb. Its
[source and notice](packages/ui/THIRD_PARTY_NOTICES.md#rare-ui-fluid-orb)
are recorded separately from the folder component.

## Application foundations

| Project | Used in OpenMeld |
| --- | --- |
| [React](https://react.dev/) | Web and desktop interfaces |
| [TanStack](https://tanstack.com/) | Routing, application framework, and query state |
| [Electron](https://www.electronjs.org/) | Desktop application |
| [Hono](https://hono.dev/) | HTTP services |
| [Better Auth](https://better-auth.com/) | Authentication, sessions, organizations, passkeys, and desktop sign-in integration |
| [Drizzle ORM](https://www.npmjs.com/package/drizzle-orm) and [node-postgres](https://www.npmjs.com/package/pg) | PostgreSQL access, schemas, and migrations |
| [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) and [Dexie](https://www.npmjs.com/package/dexie) | Local SQLite and browser IndexedDB storage |
| [Zod](https://zod.dev/) | Schema validation |
| [Valibot](https://www.npmjs.com/package/valibot) and [Temporal polyfill](https://www.npmjs.com/package/@js-temporal/polyfill) | Validation and date/time handling |
| [Croner](https://www.npmjs.com/package/croner) and [date-fns](https://www.npmjs.com/package/date-fns) | Scheduling and date utilities |
| [Fumadocs](https://fumadocs.dev/) | Public documentation |
| [React Email](https://www.npmjs.com/package/react-email) | Email components and rendering |
| [Clack](https://www.npmjs.com/package/@clack/prompts), [Commander](https://www.npmjs.com/package/commander), and [Pi TUI](https://www.npmjs.com/package/@mariozechner/pi-tui) | Command-line prompts, commands, and terminal interfaces |

## Editors, documents, and files

| Project | Used in OpenMeld |
| --- | --- |
| [Plate](https://www.npmjs.com/package/platejs) and its plugins | Rich text, Markdown, tables, and mentions |
| [Streamdown](https://www.npmjs.com/package/streamdown), [remark-gfm](https://www.npmjs.com/package/remark-gfm), [mdast](https://www.npmjs.com/package/mdast-util-from-markdown), and [micromark](https://www.npmjs.com/package/micromark-extension-gfm) | Streaming Markdown and document parsing |
| [DOMPurify](https://www.npmjs.com/package/dompurify) and [rehype-sanitize](https://www.npmjs.com/package/rehype-sanitize) | Content sanitization |
| [EmbedPDF](https://www.npmjs.com/package/@embedpdf/core), PDFium, and [pdf-lib](https://www.npmjs.com/package/pdf-lib) | PDF viewing and processing |
| [Extend React DOCX](https://github.com/extend-hq/react-docx), [React PPTX](https://www.npmjs.com/package/@extend-ai/react-pptx), and [React XLSX](https://www.npmjs.com/package/@extend-ai/react-xlsx) | Office document previews |
| [Glide Data Grid](https://github.com/glideapps/glide-data-grid) and [Papa Parse](https://www.npmjs.com/package/papaparse) | Data grids and CSV parsing |
| [Pierre Trees](https://www.npmjs.com/package/@pierre/trees) | File trees |
| [Lowlight](https://www.npmjs.com/package/lowlight) and [Emojibase](https://www.npmjs.com/package/emojibase-data) | Syntax highlighting and emoji data |

## Agents and integrations

| Project | Used in OpenMeld |
| --- | --- |
| [Flue](https://flueframework.com/) | Hosted agent runtime and tools |
| [AI SDK](https://www.npmjs.com/package/ai) and [Pi AI](https://www.npmjs.com/package/@earendil-works/pi-ai) | Model integration |
| [Anthropic SDK](https://www.npmjs.com/package/@anthropic-ai/sdk) and [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Anthropic and Claude Code integration |
| [Agent Client Protocol SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk) and [Model Context Protocol SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | Agent and tool protocols |
| [OpenCode SDK](https://www.npmjs.com/package/@opencode-ai/sdk) and [OpenCode client](https://www.npmjs.com/package/@opencode/client) | OpenCode integration |
| [Zep SDK](https://www.npmjs.com/package/@getzep/zep-cloud) | Memory service integration |
| [Cloudflare Agents](https://www.npmjs.com/package/agents), [Computer](https://github.com/cloudflare/computer), and [Code Mode](https://www.npmjs.com/package/@cloudflare/codemode) | Hosted execution, Computer operations, and tool execution |
| [Slack SDK](https://www.npmjs.com/package/@slack/web-api), [Lark SDK](https://www.npmjs.com/package/@larksuiteoapi/node-sdk), and [protobuf.js](https://www.npmjs.com/package/protobufjs) | Messaging integrations, protocol support, and development tools |

The installed packages do not imply that the corresponding hosted services or
agent subscriptions are included. Connected services retain their own terms.

## Runtime and development tools

| Project | Used in OpenMeld |
| --- | --- |
| [Node.js](https://nodejs.org/), [Python](https://www.python.org/), [Git](https://git-scm.com/), and [FFmpeg](https://ffmpeg.org/) | Application runtime and cloud Computer tools |
| [PostgreSQL](https://www.postgresql.org/) | Relational storage |
| [Debian](https://www.debian.org/), [Docker](https://www.docker.com/), [FUSE](https://github.com/libfuse/libfuse), and [Tini](https://github.com/krallin/tini) | Computer container image, filesystem access, and process management |
| [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [esbuild](https://www.npmjs.com/package/esbuild), [Rolldown](https://www.npmjs.com/package/rolldown), and [tsdown](https://www.npmjs.com/package/tsdown) | Compilation and builds |
| [pnpm](https://pnpm.io/) and [Turborepo](https://www.npmjs.com/package/turbo) | Package and workspace tasks |
| [Biome](https://biomejs.dev/), [ESLint](https://www.npmjs.com/package/eslint), [Prettier](https://www.npmjs.com/package/prettier), and [Ultracite](https://www.npmjs.com/package/ultracite) | Formatting and static checks |
| [Vitest](https://vitest.dev/), [Testing Library](https://www.npmjs.com/package/@testing-library/react), [Playwright](https://www.npmjs.com/package/@playwright/test), and [jsdom](https://www.npmjs.com/package/jsdom) | Automated tests and browser verification |
| [Wrangler](https://www.npmjs.com/package/wrangler), [Miniflare](https://www.npmjs.com/package/miniflare), and Cloudflare's Vite and test plugins | Worker development and deployment |
| [electron-builder](https://www.npmjs.com/package/electron-builder), [electron-vite](https://www.npmjs.com/package/electron-vite), and [electron-updater](https://www.npmjs.com/package/electron-updater) | Desktop builds, packaging, and updates |
| [Husky](https://www.npmjs.com/package/husky), [lint-staged](https://www.npmjs.com/package/lint-staged), [Sherif](https://www.npmjs.com/package/sherif), and [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | Contribution checks and TypeScript declarations |

## Dependencies and notices

The sections above group major projects by use. The generated
[direct dependency index](docs/dependencies.md) lists every external dependency
declared in tracked package manifests, including development and peer dependencies,
with links to each declaring package. It also includes smaller utility packages.
[pnpm-lock.yaml](pnpm-lock.yaml) records the resolved transitive dependency graph.
Each dependency retains its own license.

Copied components and system tools are tracked separately from npm packages.
The [cloud Computer image](services/remote-agent/Dockerfile) records its base image,
installed tools, and the pinned upstream Computer source.

For copied material and required notices, see [Third-party notices](THIRD_PARTY_NOTICES.md).
Credits do not replace license texts, copyright notices, or distribution requirements,
and inclusion here does not imply endorsement.

When adding a major upstream project or adapting its code, update these credits
and preserve the relevant notices as described in [Contributing](CONTRIBUTING.md#contribution-licensing).
