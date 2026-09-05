# Web Application Error Diagnostics

The Web Worker owns `web.openmeld.application_error` structured logs. Browser
reports reach it through `POST /v1/observability/application-errors`; request and
server-function middleware use the same event. This is operational evidence,
not a product Audit Log or an execution authority.

## Find an incident

1. Open Cloudflare **Workers & Pages → openmeld-web → Observability → Logs**.
   Use `openmeld-web-stg` for staging.
2. Select the incident's time range and search for
   `web.openmeld.application_error`. Save this query and review it daily and
   after Web releases. A successful HTTP response from the reporting endpoint
   is not an invocation error, so invocation-error-rate alerts alone do not
   detect browser failures.
3. Inspect `report.source`, `report.error.code`, `report.routeId`, and
   `report.error.frames`. Route IDs are code templates, not actual account or
   Space URLs. Group by client build ID, code, route template, and first frame.
4. Compare `report.buildId` / `report.sourceSha` with `serverBuildId` /
   `serverSourceSha`. A mismatch establishes different builds, not the cause of
   the failure. `serverBuildDirty` marks uncommitted server builds. Each build
   has a UUID; SHA alone does not identify uncommitted source or bundled bytes.
5. Use the log's Worker invocation and `cfRayId` to inspect adjacent native
   framework logs, request failures, and traces. Server request records with
   `http_5xx` may have no exception frames: the framework's native log carries
   the original exception when it handled it internally.

Workers Logs currently retain 3 days on Free and 7 days on Paid. This facility
does not add long-term storage, Tail Workers, scheduled jobs, or GitHub Issues.
Do not wait weeks to investigate an incident.

## Coverage and privacy

The browser registers capture for global errors, unhandled rejections, script
and link resource failures, Vite preload errors, Router catch boundaries, and
React caught/uncaught/recoverable root errors. Reporting starts when the client
entry executes; it cannot observe a client entry that never loads. Offline,
blocked, or failed telemetry is not retried. Streaming SSR errors after response
headers remain in TanStack's native Worker console logs; they are not guaranteed
to produce the structured event.

Reports contain only allowlisted error names and categories, build asset
locations, code route templates, build identifiers, and random event IDs.
Arbitrary exception messages, full stacks, component stacks, local filesystem
paths, request bodies, query strings, cookies, user identities, and message text
are not collected by this reporter. Unknown exceptions keep their category and
available code locations; there is intentionally no arbitrary free-text field.
Native framework logs predate this reporter and are not intercepted or rewritten.

Browser reports omit credentials and require same-origin JSON at the receiver.
The server validates the shared schema, drops unknown fields, rejects client
claims of server-origin events, and reads at most 8 KiB even without a
Content-Length header. There is a 120-attempt/minute cap per Worker isolate and
a 20-distinct-error cap per loaded document. The isolate cap is a bounded
log-volume safeguard, not a distributed abuse-prevention guarantee. Client
reports are untrusted diagnostic evidence, never proof of a server failure.

## Source maps

Web builds generate hidden **browser** maps alongside client assets. The
`.assetsignore` file excludes `**/*.map` from Cloudflare static-asset uploads;
hidden maps alone would not prevent direct public downloads.

Hosted Web releases retain private `web-source-maps-<sha>-<run>-<attempt>`
GitHub Actions artifacts for 14 days. Download maps from the exact release run
matching the failed asset filename, not a later rebuild of the same SHA. In
browser DevTools, load the matching source map for the bundled file and locate
the reported line/column. Only repository-authorized operators should access
these artifacts: they include source code.

For the guarded **local** release lane, retain
`clients/web/dist/client/assets/**/*.map` in private operator storage with the
release SHA before deleting the release worktree. No remote archive is created
for local releases by this change. Keep the original filenames.

Full SSR source maps exceeded the existing 4 GiB Web release build budget during
validation, so this change does not enable them or increase release resources.
Server failures continue to use Worker invocation evidence and native bundled
stack traces.

## Rollout and verification

This is an additive Web-only endpoint and shared schema. Old browsers do not
report; new browsers encountering an older Web Worker may lose a report but
continue normal operation. CLI, Service, Skills, Core, Gateway, setup, Wake,
Space actions, and existing diagnostics retain their contracts and require no
version-floor bump or coordinated local-component release.

After an authorized Web deployment, verify one safe diagnostic report is
searchable in the production Logs UI and verify that its source map cannot be
downloaded from the public site. Local tests and a build do not certify
production log retention, ingestion, or dashboard permissions.

References:

- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Source maps](https://developers.cloudflare.com/workers/observability/source-maps/)
- [TanStack Start observability](https://tanstack.com/start/latest/docs/framework/react/guide/observability)
