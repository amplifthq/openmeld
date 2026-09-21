# Desktop Application Names

## Agent Context

- Purpose: Keep production, test, and development applications distinguishable
  in native OS surfaces without merging their identities or storage.
- Read this when: Changing Desktop packaging metadata, native app names, or
  worktree application paths.
- Source of truth: `scripts/desktop/app-name.ts` maps the already selected
  application ID to its name. [Desktop Client](desktop.md) continues to own
  platform responsibilities and production update compatibility.

## Naming Contract

Only the production identity may use the unqualified name **OpenMeld**.
Signing status, `NODE_ENV`, and whether Electron is packaged are not channels.

| Build identity | Application name |
| --- | --- |
| Production: `sh.openmeld.desktop` | `OpenMeld` |
| Disposable test/acceptance: `sh.openmeld.desktop.test` | `OpenMeld Test` |
| Private or bare local development: `sh.openmeld.desktop.dev` | `OpenMeld Dev` |
| Worktree: `sh.openmeld.desktop.dev.wt-<id>.p<port>` | `OpenMeld Dev wt-<id>` |

Private packages pointed at a worktree origin use that worktree's Dev name.
Different worktrees retain their lane suffix. Unknown IDs fail configuration;
they must not silently become production. The existing target/auth selectors
still own the application ID, callback, and data isolation; the naming helper
only projects their selected identity.

`withDesktopAppName` applies the same name to builder `productName`, packaged
`extraMetadata.productName`, and macOS `CFBundleName`/`CFBundleDisplayName`.
Setting only builder `productName` is insufficient: inherited plist or package
metadata can still retain an unrelated channel name. Native main reads
`app.getName()` from this metadata for the application menu, About, initial
window title, tray tooltip, and Quit action. It must not overwrite a Dev or
Test name with the production brand at startup.

The default `clients/desktop/package.json` describes a development build.
Production packaging must select the installed production target explicitly;
its configuration restores the production name and metadata. Worktree path
planning uses the same name function, and bundle verification checks both
native plist names along with the callback identity.

Shared business UI and message content may still refer to the OpenMeld brand.
Do not mechanically replace every occurrence of "OpenMeld" in Web, notification
bodies, service names, or documentation with a build-channel label.

## Compatibility Boundaries

Production remains `OpenMeld.app`, with ID/callback `sh.openmeld.desktop`,
`OpenMeld Desktop` user data, and the existing update channels. The production
folder name is an updater contract, not cosmetic text. Do not rename it.

Installed test, private, and worktree IDs/callbacks and their explicit data
paths are unchanged. The previously unqualified bare local package now uses
the existing development ID instead of the production ID. A bare non-pilot
Electron shell can use a different default user-data directory after its name
changes; this is not a migration of installed production or pilot data.

Do not edit a signed app's plist in place or manufacture new bundle IDs to
refresh notification labels. Rebuild through the owning packaging entrypoint.
Native acceptance must check authentication/storage behavior as well as labels;
configuration tests alone do not prove Keychain or OS-registration behavior.

## Existing Duplicate Notification Entries

A list containing several "OpenMeld" rows does not identify their bundle IDs.
The historical packaging configurations allowed different IDs to share that
name. This explains the naming collision, but does not prove which historical
installation produced each row on a particular Mac.

Rebuilt apps receive the corrected names. This change does not delete old apps,
rewrite Notification Center history, reset permissions, or promise automatic
cleanup of macOS's existing registration records. Inspect the actual app bundle
and its `CFBundleIdentifier`, `CFBundleName`, and `CFBundleDisplayName` before
replacing or removing an old developer/test copy. Never select a production
installation for cleanup merely because its visible name matches another row.

Missing banners caused by screen sharing are a separate OS presentation
setting. No notification-delivery or screen-sharing policy change belongs to
this naming fix.

## Focused Validation

`app-name.test.mjs` checks the identity matrix, safe bare defaults, preservation
of unrelated configuration, and actual private-builder exports.
`app-name-config.test.mjs` evaluates the installed and development configs,
including the signed-acceptance metadata override. Its host-platform override
selects a configuration only; it does not claim a native package was built.
Desktop tests exercise native main naming and preserve the production updater
guard. Run normal repository focused checks before marking a PR ready.

On a Mac, build disposable Test and worktree Dev apps through their existing
entrypoints. Inspect both plist names, then launch each and check its app menu,
About, tray Quit/tooltip, and notification identity using Show an example.
Verify sign-in and the existing isolated data paths still work. For the actual
production release, follow the existing signing/update acceptance; confirm
`OpenMeld.app` and its production identity remain unchanged. Do not overwrite a
production app with a test build to perform this smoke.
