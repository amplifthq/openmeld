# Web Application Error Diagnostics

The Web Worker owns `web.openmeld.application_error` structured logs. Browser
reports reach it through `POST /v1/observability/application-errors`; request and
server-function middleware use the same event. This is operational evidence,
not a product Audit Log or an execution authority.

## Find an incident

1. Open Cloudflare **Workers & Pages → openmeld-web-prod → Observability → Events**.
   Use `openmeld-web-stg` for staging.
2. Select the incident's time range and search for
   `web.openmeld.application_error`. Save this query and review it daily and
   after Web releases. A successful HTTP response from the reporting endpoint
   is not an invocation error, so invocation-error-rate alerts alone do not
   detect browser failures.
3. Inspect `report.source`, `report.error.code`, `report.routeId`, and
   `report.error.frames`. Route IDs are code templates, not actual account or
   Space URLs. `report.navigation.fromRouteId` identifies the previous route
   template for a recent in-app navigation; `elapsedMs` is the time from that
   navigation to capture. `report.reactBoundary`, when present, identifies a
   local UI error boundary. Neither field identifies the failing component or
   proves that navigation caused the error. Group by client build ID, code,
   route template, and first frame.
4. Compare `report.buildId` / `report.sourceSha` with `serverBuildId` /
   `serverSourceSha`. A mismatch establishes different builds, not the cause of
   the failure. `serverBuildDirty` marks uncommitted server builds. Each build
   has a UUID; SHA alone does not identify uncommitted source or bundled bytes.
5. Use the log's Worker invocation and `cfRayId` to inspect adjacent native
   framework logs, request failures, and traces. Server request records with
   `http_5xx` may have no exception frames: the framework's native log carries
   the original exception when it handled it internally.

The application error screen offers **Send error report** in addition to
automatic capture. Explicit submissions use the same minimized contract and
intake, with optional `report.submission: "user"`. They bypass automatic
deduplication. The UI confirms only a 204 response, displays `report.id` for
lookup, and offers a user-initiated retry after failure. Requests time out after
10 seconds; there is no background retry. A receipt confirms Web intake, not
Cloudflare retention or dashboard availability.

### Investigate a Wake progress flash

Search the same Web Worker's Events for
`web.openmeld.wake_progress_presentation_unconfirmed` at the reported time.
Filter by `report.wakeProgress.spaceId`, then inspect `dispatchId`,
`clientMessageId`, `sourceSignalId`, `streamId`, the Thread pointers,
`updatedAtMs`, and the `fromRestoredPresentation`, `fromCachedSpaceSummary`,
`fromCachedOwnSummary`, and `fromBootstrapStream` flags. The three
`FetchedAfterMount` fields show which reads had completed in this page visit.
`report.buildId`, `report.sourceSha`, and `report.pageSessionId` identify the
browser build and page session; compare them with the server build fields.

This event means Web presented work without a matching current active-Wake
read. It does **not** mean the Wake had ended. Use the dispatch and source IDs
to inspect the Core trace and Space outcome. For a Web-authored Wake, the normal
operator handoff is:

```sh
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

A missing event
does not rule out a flash: reporting can be blocked, capped, or outside the
Workers Logs retention window. The intake does not retry failed reports.

Error details are collapsed by default with a short fading preview. Expanded
details and copying remain local to the browser; sending a report does not
upload that raw text. Go back uses browser history, or the home page when no
previous entry exists. Environment repair instructions appear only in local
development and inside the disclosure.

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

Ordinary application-error reports contain only allowlisted error names and
categories, build asset locations, code route templates, build identifiers,
random event IDs, and, when available, a recent previous route template and
one of the known local error-boundary labels. Navigation context expires after
10 minutes and is held only in page memory. The Wake presentation event
additionally contains bounded Space, Profile, dispatch, message, stream, and
Thread pointers, the progress update time, and fixed source/freshness flags.
Arbitrary exception messages, full stacks, component stacks, local filesystem
paths, request bodies, query strings, cookies, account names, email addresses,
and message text
are not collected by this reporter. Unknown exceptions keep their category and
available code locations; there is intentionally no arbitrary free-text field.
Native framework logs predate this reporter and are not intercepted or rewritten.

Browser reports omit credentials. The receiver accepts same-origin JSON from Web
and the fixed `openmeld-desktop://app` Origin only with the installed Desktop
contract header and version. Desktop Main owns that Origin and header; the
renderer cannot choose them. This admits a diagnostic report, not an
authenticated business action.
The server validates the shared schema, drops unknown fields, rejects client
claims of server-origin events, and reads at most 8 KiB even without a
Content-Length header. There is a 120-attempt/minute cap per Worker isolate and
a 20-distinct-error cap and a separate 10-distinct-Wake-presentation cap per
loaded document. The isolate cap is a bounded
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

Check that the matching map has nonempty `sources` and `mappings` before relying
on it. Desktop renderer builds currently emit an empty map for their large
`index-*.js` entry even when client source maps are enabled; other chunks have
valid maps. An empty map cannot resolve a production frame. The route and
boundary fields above can still narrow the incident, but they do not replace
symbolication.

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

The manual-submission addition is backward compatible: older Web receivers
strip the optional submission marker but still log the same report and ID;
new receivers accept automatic reports without it. No CLI, Service, Core,
Gateway, Skills, setup, Wake, or Space action contract changes. This satisfies
the Contract Impact Audit without a local-component version bump.

The optional Wake presentation diagnostic is Web-only. New Web receivers
continue to accept older reports; an older receiver rejects the new source
enum, losing only this best-effort diagnostic during a mixed-version Web
rollout. No CLI, Service, Core, Gateway, setup, or Wake execution contract
changes, so no local-component version floor is required.

After an authorized Web deployment, verify one safe diagnostic report is
searchable in the production Logs UI and verify that its source map cannot be
downloaded from the public site. Local tests and a build do not certify
production log retention, ingestion, or dashboard permissions.

References:

- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Source maps](https://developers.cloudflare.com/workers/observability/source-maps/)
- [TanStack Start observability](https://tanstack.com/start/latest/docs/framework/react/guide/observability)
