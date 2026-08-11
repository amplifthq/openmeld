Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
pnpm install
cp .dev.vars.example .dev.vars
cp .dev.vars.prod.example .dev.vars.prod
pnpm dev
```

Cloudflare Worker env governance lives in [docs/cloudflare-workers-env.md](../../docs/cloudflare-workers-env.md).

Required server envs:

1. `OPENMELD_GATEWAY_URL`
2. `WEB_APP_URL`
3. `BETTER_AUTH_URL`
4. `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`

Source of truth:

1. `OPENMELD_GATEWAY_URL`, `WEB_APP_URL`, and `BETTER_AUTH_URL` live in `clients/web/wrangler.jsonc`.
2. `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET` lives in `clients/web/.dev.vars` or `clients/web/.dev.vars.prod` locally, and in Cloudflare Worker secret storage for production.

Missing `OPENMELD_GATEWAY_URL` is a server runtime misconfiguration.
`clients/web` must fail fast instead of falling back to a direct gateway call or a path-prefixed workaround.

# Building For Production

To build this application for production:

```bash
pnpm build:prod
```

## Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
pnpm test
```

Run the heavier page-flow and route-flow suite with:

```bash
pnpm run test:integration
```

Run the full local Web test stack with:

```bash
pnpm run test:full
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

## Component Directory Rules

To keep `clients/web` maintainable and easy to review, follow these rules strictly:

1. `src/components/ui` is reserved for **upstream Shadcn UI primitive components only**.
2. Do not place business components, page-specific components, wrappers, or custom variants in `src/components/ui`.
3. All custom components must live under `src/components/<scope>` and be grouped by domain/scope.

Recommended structure:

```text
src/components/
  ui/               # Shadcn originals only
  landing/          # landing page custom components
  documentation/    # docs-related custom components
  auth/             # auth-related custom components
  profile/          # profile-related custom components
  space/            # space-related custom components
  shared/           # cross-scope custom components
```

PR review policy:

1. Any non-Shadcn component added to `src/components/ui` should be rejected.
2. Custom component files must be moved into a clear scope folder under `src/components`.

## Shadcn Instructions

Use the latest Shadcn CLI to add components. Do not hand-write or manually copy Shadcn components into `src/components/ui`.

Example:

```bash
pnpm dlx shadcn@latest add button
```

Rules:

1. `src/components/ui` must be generated/managed via latest Shadcn CLI output.
2. If a component is not from Shadcn upstream, it must not be placed in `src/components/ui`.
3. When updating existing Shadcn primitives, prefer re-generating with latest CLI and then applying minimal project-specific adjustments only when necessary.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Uninstall the packages: `npm install @tailwindcss/vite tailwindcss -D`

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:

```bash
pnpm lint
pnpm format
pnpm check
```

## Authentication Integration (OpenMeld Auth Worker)

This app does not run a second Better Auth server locally.
`clients/web` only consumes the existing OpenMeld Auth Worker (`services/auth`).

Runtime endpoints:

1. Dev: `http://localhost:8788`
2. Prod: `https://auth.openmeld.ai`

## OpenMeld Gateway Access Boundary

`clients/web` must not call the OpenMeld Gateway origin directly from browser code.

Locked foundation:

1. Browser OpenMeld requests use same-origin `/v1/*` routes on the web origin.
2. `src/routes/v1/$.ts` proxies those exact paths to `OPENMELD_GATEWAY_URL`.
3. `src/lib/openmeld-api/*` is the only allowed Web OpenMeld API foundation layer for future Start / Space features.
4. Current device targeting is backend-owned and must be read through the authoritative resolver in `src/lib/start/current-device-target.ts`.

## Local OpenMeld Start Runbook

Minimum local runtime env:

1. `OPENMELD_GATEWAY_URL`
2. `WEB_APP_URL`
3. `BETTER_AUTH_URL`
4. `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`

Recommended local startup order:

1. `pnpm --filter @openmeld/auth-worker run dev`
2. `pnpm --filter @openmeld/core run dev`
3. `pnpm --filter @openmeld/gateway run dev`
4. `pnpm --filter openmeld-web run dev`

Fixed local Wrangler inspector ports:

1. `services/auth` -> `19330`
2. `services/core` -> `19331`
3. `services/gateway` -> `19332`

Real-browser validation baseline:

1. Browser OpenMeld requests must land on web-origin `/v1/*` URLs.
2. Browser code must not call `OPENMELD_GATEWAY_URL` directly.
3. A browser request to `/v1/devices/current` should use the web origin, and its unauthenticated failure should match the gateway's unauthenticated failure semantics.

Troubleshooting:

1. If one of the fixed local inspector ports is already in use on your machine, restart only that worker with a free inspector port.
2. Example: `pnpm --filter @openmeld/core exec wrangler dev --inspector-port 13333`
3. This is a local dev runtime issue, not a product contract or Start orchestration issue.

## Auth Route Contract (DeepCrawl Alignment)

This section is the single source of truth for web auth route migration.

Target routes (batch 1: auth entry):

1. `/login`
2. `/sign-up`
3. `/magic-link`
4. `/forgot-password`
5. `/reset-password`
6. `/verify-email`
7. `/callback`
8. `/logout`

Target routes (batch 2: account domain):

1. `/app/account`
2. `/app/api-keys` (deferred in current stage)

Current OpenMeld routes (transition only):

1. `/auth`:
   - legacy read-only notice page
   - points users to `/login`, `/sign-up`, `/magic-link`, `/app/account`, `/device`
2. `/auth/protected`:
   - legacy read-only protected notice page
   - points users to `/app/account`
3. `/device` and `/device/approve`:
   - device authorization pages

Migration strategy (locked):

1. Stage 2 adds skeleton routes and component files for target URLs.
2. `/auth` and `/auth/protected` are transition routes only, not final contract routes.
3. Stage 6 converges web auth entry and keeps transition routes as read-only legacy notices.
4. Stage 2 does not change auth-worker interfaces or backend behavior.

Stage 2 skeleton status (historical baseline):

1. Skeleton routes exist for:
   - `/login`, `/sign-up`, `/magic-link`, `/forgot-password`
   - `/reset-password`, `/verify-email`, `/callback`, `/logout`
   - `/app/account`
2. DeepCrawl-aligned auth skeleton files exist under:
   - `src/components/auth/*`
   - `src/components/auth/forms/*`
3. Stage 2 only provided structure and placeholder rendering.
4. Real auth action wiring was completed in Stage 4.

Stage 3 TODO-E + TODO-C status:

1. Auth data layer is now in place:
   - `src/lib/auth-client.ts`
   - `src/lib/auth-client-types.ts`
   - `src/lib/auth-errors.ts`
   - `src/lib/auth-mode.ts`
   - `src/lib/passkey-utils.ts`
   - `src/query/*`
   - `src/hooks/auth.hooks.ts`
2. Server session helper has been added:
   - `src/lib/auth-session.ts`
   - `src/lib/auth-session.server.ts`
3. `src/routes/auth/protected.tsx` was migrated to server-session based protection in Stage 3, and later converted to a read-only legacy notice route in Stage 6.
4. `src/components/auth/*` has been upgraded to consume auth hooks/contracts and is ready for form-flow wiring.

Stage 4 TODO-D status:

1. Form flow hooks are now live:
   - `src/hooks/auth-form.hooks.ts`
   - `src/lib/auth-form-api.ts`
   - `src/lib/auth-redirect.ts`
2. These routes now support real submit + error handling + redirect:
   - `/login`
   - `/sign-up`
   - `/magic-link`
   - `/forgot-password`
   - `/reset-password`
   - `/verify-email`
   - `/callback`
   - `/logout`
3. `/auth` and `/auth/protected` remain transitional routes and are intentionally kept.
4. `/device` and `/device/approve` are unchanged in this stage.

Stage D2 TODO-D2 status:

1. Magic-link email URL is now web-first:
   - `${WEB_APP_URL}/magic-link?token=...`
2. `/magic-link?token=...` now renders a verification state flow:
   - `checking` -> `success` / `error` / `missing-token`
3. Magic-link success no longer auto-redirects to `/app`.
4. Manual actions are shown on success/failure:
   - `Go to sign in`
   - `Back to home`
   - `Request a new link` (failure paths)
5. This aligns OpenMeld behavior with DeepCrawl's magic-link page UX while keeping OpenMeld current product decision (no auto jump to app page yet).

Stage 5 TODO-F status:

1. `/app/account` is now implemented as an interactive account center (not a placeholder).
2. Added account-specific cards under `src/components/account/*`:
   - `user-avatar-card.tsx`
   - `user-name-card.tsx`
   - `providers-management-card.tsx`
   - `password-change-card.tsx`
   - `sessions-management-card.tsx`
3. Added account data/mutation layer:
   - `src/hooks/account.hooks.ts`
   - `src/query/auth-query.ts` (account mutations + list sessions contracts)
   - `src/query/query-keys.ts` / `src/query/query-options.ts` (adds `listSessions`)
4. `/app` now enforces session guard and redirects unauthenticated users to `/login`.
5. In this stage, hidden by decision:
   - multiple-account management
   - API keys UI implementation

Stage 6 TODO-G status:

1. `/auth` and `/auth/protected` are now read-only legacy notice pages.
2. `AuthConsole` has been removed from runtime route rendering.
3. one-time token UI has moved to `/app/account`:
   - `src/components/account/developer-auth-tools-card.tsx`
4. `/device` and `/device/approve` no longer link back to the old auth console.
5. Web auth entry is now unified around `/login` and `/app/account`.

Stage 7 TODO-H status:

1. Automated gates passed:
   - `pnpm turbo run check --filter=openmeld-web`
   - `pnpm turbo run build --filter=openmeld-web`
   - `pnpm turbo run test --filter=@openmeld/auth-worker`
   - `pnpm turbo run check --filter=@openmeld/auth`
   - `pnpm turbo run check --filter=@openmeld/auth-worker`
   - `pnpm test:e2e:auth:http` (unauth + verification health path)
2. Route convergence checks passed:
   - `/auth` and `/auth/protected` are read-only legacy pages
   - no runtime references to `AuthConsole` remain
3. Magic-link verification regression was fixed:
   - invalid token no longer reports success
   - `/magic-link?error=...` now renders explicit failure state
4. Current environment blockers for full closure:
   - Google OAuth returns `redirect_uri_mismatch` in provider console flow
   - device approve/deny requires a signed-in web session
   - full email/password reset + one-time-token loop still needs a verified signed-in test account session
5. Stage 7 is currently tracked as `In Progress` until blockers are cleared.

## URL State (NUQS)

This app now uses `nuqs` for URL query state handling in auth-related UX paths.

1. Installed version: `nuqs@2.8.9` (latest at implementation time).
2. Adapter integration:
   - `src/routes/__root.tsx` wraps app routes with `NuqsAdapter` from `nuqs/adapters/react`.
3. Why `react` adapter:
   - official docs state TanStack Router adapter is experimental and does not yet cover TanStack Start.
4. Current usage:
   - `/device` and `/device/approve` use `useQueryState("user_code", parseAsString.withDefault(""))`
   - this enables stable prefill and URL-driven continuation for device login flow.

Core files:

1. Auth client entry: `src/lib/auth-client.ts`
2. Auth hooks entry: `src/hooks/auth.hooks.ts`
3. Auth query contracts: `src/query/query-keys.ts` + `src/query/query-options.ts`
4. Server session helper entry: `src/lib/auth-session.ts`
5. Server fetch implementation: `src/lib/auth-session.server.ts`
6. Shared auth client config source: `@openmeld/auth` -> `createAuthClientConfig`

## TanStack Start SSR Boundary Rule

To avoid SSR black-screen/runtime breakages in TanStack Start:

1. Do not import modules named `*.client.*` into route/component code that participates in server rendering.
2. Keep route files and shared shells server-safe.
3. Put browser-only auth calls behind UI interaction hooks/modules and avoid server-side execution paths.
4. For TanStack Query v5, always use object form (`useQuery({ ... })`), never positional arguments.

## Environment Setup

Copy the local secret templates first:

```bash
cp .dev.vars.example .dev.vars
cp .dev.vars.prod.example .dev.vars.prod
```

Cloudflare Worker env partition for this package:

1. `clients/web/wrangler.jsonc` `vars` / `env.prod.vars`
   - `OPENMELD_GATEWAY_URL`
   - `WEB_APP_URL`
   - `BETTER_AUTH_URL`
   - `VITE_BETTER_AUTH_URL`
   - `VITE_APP_TITLE`
2. `clients/web/.dev.vars` / `.dev.vars.prod`
   - `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`
3. Production Cloudflare secret storage
   - `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`

Useful commands:

```bash
pnpm cf-typegen
pnpm run sync:secrets:prod
pnpm run sync:config:prod
pnpm run sync:prod
```

Refresh order after changing `wrangler.jsonc`, Worker env names, or bindings:

1. update the shared `wrangler` version in the workspace
2. `pnpm install`
3. `pnpm cf-typegen`
4. `pnpm run sync:config:prod` or `pnpm run sync:secrets:prod`

Protected-route pattern (for future routes):

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ensureSession } from "#/lib/auth-session.server";

export const Route = createFileRoute("/_protected/example")({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session) {
      throw redirect({
        to: "/",
        search: { redirect: location.href },
      });
    }
    return { user: session.user };
  },
  component: () => <div>Protected</div>,
});
```

## Env Partition Rules

1. `src/env.ts` is the single entry for web env validation.
2. Non-sensitive runtime URLs belong in `wrangler.jsonc`, not in `.dev.vars*` and not in Cloudflare secret storage.
3. Only `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET` belongs in `.dev.vars*` locally and Cloudflare Worker secret storage in production.
4. Never expose Worker secrets through `VITE_*`.
5. Use [docs/cloudflare-workers-env.md](../../docs/cloudflare-workers-env.md) as the cross-package contract.

## Dev vs Prod Environment Selection

This project can switch Cloudflare environments locally:

1. Default local env (`.dev.vars`):
   - `pnpm dev`
   - `pnpm build`
2. Prod-like local env (`.dev.vars.prod` + `CLOUDFLARE_ENV=prod`):
   - `pnpm dev:prod`
   - `pnpm build:prod`

Under the hood this uses:

```bash
CLOUDFLARE_ENV=prod
```

Cloudflare env file behavior:

1. `wrangler dev` uses `.dev.vars` by default.
2. `wrangler dev --env prod` uses `.dev.vars.prod`.
3. If `.dev.vars.<environment>` exists, `.dev.vars` is not loaded for that env.
4. Use `.dev.vars*` only for secrets in this package; keep the URL config in `wrangler.jsonc`.
5. Do not mix the same Worker env contract between `.dev.vars*` and `.env*`.
6. Use `.dev.vars.prod` as the canonical prod-like local file name.

## T3Env

- You can use T3Env to add type safety to your environment variables.
- Add Environment variables to the `src/env.ts` file.
- Use the environment variables in your code.

### Usage

```ts
import { env } from "#/env";

console.log(env.VITE_APP_TITLE);
```

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "My App" },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
});
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from "@tanstack/react-start";

const getServerTime = createServerFn({
  method: "GET",
}).handler(async () => {
  return new Date().toISOString();
});

// Use in a component
function MyComponent() {
  const [time, setTime] = useState("");

  useEffect(() => {
    getServerTime().then(setTime);
  }, []);

  return <div>Server time: {time}</div>;
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/hello")({
  server: {
    handlers: {
      GET: () => json({ message: "Hello, World!" }),
    },
  },
});
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/people")({
  loader: async () => {
    const response = await fetch("https://swapi.dev/api/people");
    return response.json();
  },
  component: PeopleComponent,
});

function PeopleComponent() {
  const data = Route.useLoaderData();
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  );
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
