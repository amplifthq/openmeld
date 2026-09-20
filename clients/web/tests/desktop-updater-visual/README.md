# Desktop updater visual fixture

This is a separate, loopback-only Vite entry. It renders the production
`DesktopUpdater`, `DesktopUpdatesSection`, outer Settings button, contextual
navigation primitive, shared Settings dialog, and production styles/fonts.
The small navigation group is fixture data; actual `SettingsInnerSidebar` wiring
is covered by `src/desktop/updater.test.tsx`. The component bridge implements the
existing updater interface with typed synthetic snapshots. It never accesses an
update feed, credentials, installed Desktop, or a Service.

From the repository root, after the usual dependency setup:

```sh
pnpm dev:run -- pnpm --dir clients/web exec vite build --config tests/desktop-updater-visual/vite.config.ts
pnpm --dir clients/web exec vite preview --config tests/desktop-updater-visual/vite.config.ts --host 127.0.0.1 --port 4176 --strictPort
```

Use an unoccupied loopback port (override `--port` rather than stopping another
worktree's process). Open `http://127.0.0.1:4176/?state=available&theme=dark&mode=settings`.
`theme` is `light` or `dark`; `mode` is `settings`, `notice`, or `dialog`.

Snapshots: `unknown`, `idle`, `checking`, `current`, `available`, `downloading`,
`indeterminate`, `verifying` (100% but not downloaded), `downloaded`, `preparing`,
`installing`, `unavailable`, `check-error`, `unknown-error`, `download-error`,
`restart-error`, and `install-error`. The visible fixture banner identifies the
simulation. `reject` rejects user actions at the bridge boundary; `hold` keeps an
action pending for disabled/busy inspection; `read-error` rejects the initial
snapshot read; `web` removes the bridge. The latter tests product updater suppression, not the fixture's
hard-coded navigation-group registry.

`window.updaterFixture.emit(window.updaterFixture.cases.downloaded)` publishes a
snapshot in the current session. `window.updaterFixture.actions` records explicit
user actions. A resolved action promise deliberately does not synthesize an
update transition. Reload to reset session-local dismissals. Unknown, preparing,
installing, and terminal install errors deliberately retain production input
freezing: change the query or emit a native-recovery snapshot through the console,
not by deleting `inert` or weakening the guard.

Review normal and narrow settings containers, both themes, the actual shared
primary-button treatment, Later's resting/hover/keyboard focus, wrapping,
indeterminate/known progress, and all error stages. Check that ordinary notices
do not steal focus and are suppressed while Updates is open. Keep screenshots
and measurements under this worktree's `dev-tmp/`, not in a production route.
The explicit CSS source directive is necessary because this fixture's Vite root
is not the Web application root.

With `agent-browser` installed and the preview running, execute the repeatable
browser check from the repository root:

```sh
node clients/web/tests/desktop-updater-visual/capture.mjs http://127.0.0.1:4176
```

It creates a unique browser session, checks normal/narrow layouts in both themes,
records real screenshots and measurements under `dev-tmp/pr1160-visual/`, and
closes only its own browser session. `verified-measurements.json` indexes this
run. Open the PNGs for visual inspection; geometry assertions do not replace
human review of the images.

This fixture does not prove authenticated full-shell navigation, a native menu,
real Electron rendering, persistence through a real relaunch, or a signed A-to-B
upgrade. Use the existing isolated worktree lane and root `pnpm desktop:start:dev`
for independent Desktop smoke. Do not use `desktop:start:prod`, the production
home or feed, or a production installed application to manufacture update states.
