# Hosted Computer browser preview research

## Agent Context

- Purpose: Record the verified Cloudflare route from a hosted Computer development server to Browser Run and the current package gap.
- Read this when: Building or reviewing private browser smoke for code running in the hosted Computer container.
- Update this when: A published browser helper gains private outbound routing or an end-to-end preview proof changes the recommendation.
- Do not use this for: Current Browser Run tool behavior, production release authorization, or a claim that private preview is shipped.
- Source of truth: Current package code, Cloudflare's Browser Run contracts, and an actual isolated deployed proof supersede this research note.

Status: Private preview implementation is in PR #1315; deployed Computer-port
acceptance remains to be proven.

Remove this note after a private preview implementation and deployed acceptance are recorded, with lasting contracts moved into `developing/product/remote-agent-runtime.md`.

## Finding

Cloudflare Browser Run now supports `outboundByHost` on the browser binding's
`launch()` or `acquire()`. For an exact virtual hostname, Browser Run forwards
HTTP requests to a Worker Fetcher instead of public DNS. This allows a browser
to reach a private service without publishing a preview URL. Cloudflare's
[Outbound Workers guide](https://developers.cloudflare.com/browser-run/features/outbound-workers/)
documents the request path and its limits: HTTP only, a Fetcher created in the
same Worker invocation, and no retained routing in a later invocation.

The installed `@cloudflare/computer@0.2.1` already exposes
`AgentComputer.getWorkspaceContainer().fetchPort(port, request)` and `port(port)`.
It can provide the Worker-side path to a development server in the same
Computer container. Keep the container and filesystem owner: the retired
per-Space Sandbox SDK would add another execution environment. Cloudflare's
[Sandbox SDK preview example](https://github.com/cloudflare/sandbox-sdk#quick-api-example)
shows a public proxy alternative, but a public tunnel is unnecessary for an
Agent-only smoke.

The currently published browser helpers are the obstacle to a small product
implementation. The installed `agents@0.22.0` `createBrowserTools` accepts a
Browser Run binding but has no `outboundByHost` input; the current `agents@0.24.0`
package has the same limitation. The latest published
[`@cloudflare/playwright@1.3.6`](https://www.npmjs.com/package/@cloudflare/playwright/v/1.3.6)
also does **not** pass `outboundByHost`: its published `WorkersLaunchOptions`
omits the field and its `acquire()` calls the older HTTP browser endpoint.
The [Playwright repository README](https://github.com/cloudflare/playwright#route-selected-browser-requests-through-your-worker)
shows the desired API on `main`, but that example is ahead of its published
package. Do not rely on an unrecognized option or assume it reached Browser Run.

Cloudflare's official [browser binding example](https://developers.cloudflare.com/browser-run/features/outbound-workers/)
already shows direct `launch({ outboundByHost })` and a bounded CDP connection.
An isolated deployed Worker proved that a Worker Entrypoint created in the same
Durable Object invocation is accepted by Browser Run and renders JavaScript
from a virtual `.test` hostname. A Durable Object stub passed directly to
`outboundByHost` was rejected. Prefer the official Playwright
helper once a published release implements the option; avoid maintaining a
general browser harness solely to bridge this release gap.

## Required product boundary

Bind one preview to the current Agent Computer and a live execution, with a
bounded allowed port. Route only an exact virtual hostname and preserve
same-origin paths and query strings. Do not expose a generic HTTP proxy, a
public tunnel, Worker bindings, or credentials to model-written code. A stale
or stopped container must fail visibly. Browser Run sessions must close after
the smoke; the result should record the page reached, assertion outcome,
console/network errors, and any screenshot. A screenshot alone cannot prove
backend behavior or authenticated user paths.

The Computer container has no Node.js in the baseline image, so JavaScript
development also needs a supported Node and package-manager toolchain. This
prerequisite can be shipped independently of the preview bridge.

## Proof before enabling a Hosted Agent tool

In a disposable deployed lane, start a tiny server in the current Computer
container, route its allowed port through a Worker Fetcher, and have Browser
Run load the virtual HTTP hostname. Verify JavaScript-rendered DOM content,
same-origin assets, one UI action, console errors, and browser close. Then
reject a different Computer, arbitrary port, and stale execution. Repeat with
a representative built Web app and a same-origin API route before claiming a
general development smoke path. Local `wrangler dev` alone does not prove the
production Browser Run binding and container route.
