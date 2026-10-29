# CLI Binary Release

## Agent Context

- Purpose: Define the CLI binary release, setup distribution, smoke, upload,
  production-channel synchronization, and release validation workflow.
- Read this when: You are building, serving, testing, uploading, releasing, or
  debugging the managed OpenMeld CLI binary distribution or the Web setup
  `dist=` switch.
- Update this when: Binary artifact shape, manifest routes, setup distribution
  defaults, binary smoke commands, upload flow, production-channel checks, or
  CLI release gates change.
- Do not use this for: General CLI command semantics, local OpenMeld Service
  lifecycle rules, Web setup UX ownership, or production release lane and
  rollout selection. Use `developing/engineering/production-release.md` for
  those decisions.
- Source of truth: This file owns the CLI binary distribution workflow and
  release-validation commands.

## Iterate

- Build the local Apple silicon binary with:

```sh
node scripts/release/build-cli-binary.mjs
```

- The build reads `clients/openmeld-cli/package.json` as the only version source.
- The current output is written under `cli/dist/`, outside the npm package.
- macOS Keychain addon builds use the running Node installation's headers when
  the installed headers and version match. Otherwise node-gyp uses its normal
  header acquisition. This avoids a redundant network download when the exact
  headers are already installed without building against another Node version.
- The artifact name is `openmeld-cli-<platform>-<version>`.
- Local and production download channels also publish
  `openmeld-cli-<platform>-<version>.gz`. Setup and current binary CLI upgrades
  prefer this compressed transport while retaining the raw executable for
  older clients.
- A new install downloads the complete gzip archive. Its manifest size is what
  setup shows to the user, so the current roughly 24.5 MiB transfer appears as
  about 25 MB instead of the roughly 70 MiB installed executable size.
- When the production channel can read the previous signed release, it also
  publishes
  `openmeld-cli-<platform>-<version>-delta-from-<previous-version>.gz`.
  An upgrade uses this smaller exact-base delta only when the running binary's
  version, size, and sha256 all match that previous release. Any base, download,
  parse, reconstruction, or final-hash failure automatically falls back to the
  complete gzip archive.
- The signed stable production binary channel currently supports `darwin-arm64`.
  An explicitly selected, separate `windows-preview` manifest can carry the
  unsigned internal Windows x64 trial; it does not change the signed stable
  channel or authorize a public Windows release.
- Signed Windows release records require `windows.publisherName` and an immutable
  `windows.processHelper` URL, size, and SHA-256 alongside the primary carrier.
  CLI and Service records use the same shape. Windows publisher metadata is
  rejected on another platform and cannot be combined with Apple signing
  identity. The shared native Authenticode verifier is used by CLI acquisition
  and Desktop updates; missing Windows publisher metadata is an integrity
  failure, not permission to run an unsigned binary. Companion acquisition
  reuses the existing bounded download policy and verifies the same publisher
  before installation. The caller owns the disposable directory and failure
  cleanup. The separate internal preview record instead declares
  `mode: internal-unsigned-preview` and requires exact manifest opt-in in the
  production Windows clients. Its size/hash checks do not authenticate the
  publisher, so it is limited to known coworkers and may encounter Windows
  warnings or enterprise blocks.
- The binary distribution marker is injected at compile time by `bun build --compile`.
- Release builds minify bundled code while preserving function and class names
  for diagnostics. This reduces the current executable by about 4.4 MiB and
  the complete gzip download by about 0.45 MiB; it cannot remove the roughly
  60 MiB Bun runtime embedded in every standalone executable.
- The iterate build is intentionally unsigned. Production publishing signs and
  notarizes the final executable before calculating the release sha256.
- Managed installs also retain the active binary Service's source version while
  it remains referenced, even if several CLI versions have been installed since.
  Service retention is independent of CLI rollback selection.
- The Windows managed layout uses immutable `versions/<version>/openmeld.exe`
  plus its process helper, and one `bin/cli-installation.json` selection record.
  When the exact production Windows internal-preview manifest and explicit
  preview opt-in installed that version, this record also retains the preview
  channel. Only the selected managed CLI restores that choice for later update
  checks, upgrades, and Service registration; a temporary bootstrap or unrelated
  executable does not inherit it. Version metadata caches are scoped to their
  release source so a stable minimum version cannot gate a preview installation.
  `bin/openmeld.exe` is a thin native console launcher built from the same helper
  artifact; it forwards argv, inherited streams, and exit status to that selected
  CLI. It has no account, connection, or update authority. Windows never creates
  privileged symlinks or overwrites mapped executable bytes. Install and existing
  maintenance reconcile an interrupted launcher replacement from the selected
  immutable version. A retained running launcher is removed on a later pass.
  The shared installer lock and semver/rollback policy remain the owners. Native
  version cleanup acquires all known bundle files before removal; an in-use or
  unrecognized directory is retained. These installation changes remain under
  native acceptance and do not advertise a Windows production channel.
- Managed installs retain the active CLI version and one usable rollback
  version older than the active version. Incomplete and older managed
  semantic-version directories are removed during `install-self`; unrecognized
  directories are preserved because the installer cannot prove that it owns
  them.
- During migration from a legacy update-worker registration that names a
  versioned executable, `install-self` temporarily protects that referenced
  version in addition to the active and rollback versions. The update worker is
  copied to a verified stable lane-owned carrier and its OS registration is
  rewritten before cleanup runs again. Never delete a version still named by
  the active worker registration.
- On macOS, those version directories remain the verified update and rollback
  sources, while launchd runs OpenMeld Service from one stable physical
  executable path. Installing, upgrading, or rolling back atomically copies the
  selected signed binary to that path and verifies its sha256 before launchd
  starts it. Do not replace this copy with a symlink: macOS Files and Folders
  authorization must not acquire a new executable path on every release.
- Production `install-self` also prepends `~/.openmeld/bin` in the user's zsh,
  bash, or fish startup configuration so future `openmeld` commands resolve to
  the managed binary instead of an older package-manager copy. Custom
  `OPENMELD_HOME`, dev-local, and canary installs never modify the user's shell
  startup files.
- Production binary setup also reconciles a known older global `openmeld` npm
  package before `openmeld setup` can report completion. It installs the exact
  version declared by the downloaded binary manifest, then verifies that the
  current terminal's `openmeld --version` reaches that version. A failed or
  ineffective npm update is reported but does not block the verified binary's
  setup. Follow-up commands name the managed binary path, so they remain usable
  even when the current terminal still resolves the older npm command;
  an already-authoritative command adds no npm install or network round trip.

### Windows native carrier acceptance

For the internal Windows x64 trial, `.github/workflows/windows-internal-preview.yml`
builds CLI, Service, and the process helper on a native Windows runner and
exercises the delivered carriers without user Node/Bun in the fixture PATH.
It exports an independently validated CLI artifact before building the unsigned
production-account Desktop installer. The Desktop stage inspects the actual
installer payload and exports a separate complete artifact. A Desktop build
failure does not invalidate the earlier CLI carrier result. The workflow runs
on explicit dispatch, not every Draft or Ready update. Check the run's source
SHA:

```sh
gh workflow run windows-internal-preview.yml --ref <candidate-branch>
```

Run its
read-only handoff check from a clean checkout of the artifact's source SHA:

```sh
node scripts/release/publish-windows-internal-preview.mjs check <extracted-artifact-directory>
```

For the `windows-cli-preview-*` artifact, use `check-cli` instead. Its guarded
`publish-cli` mode publishes only the exact CLI, Service, helper, and Windows
preview manifest. It does not change the Desktop pointer. The complete
`windows-internal-preview-*` artifact still uses `check` and `publish`.

The guarded publish modes are separate, authorized release actions after
merging; do not run them merely to mark the feature PR Ready. On release, build
again from the exact merged main SHA and check the downloaded artifact. Publish
immutable executables before their preview manifest or Desktop pointer. The Web
deployment must include the preview routes before the command or Desktop link
is shared. This trial does not change the signed stable CLI publisher, supply
Authenticode trust, or enable Desktop auto-updates.

On a Windows x64 build machine, build the console CLI and GUI-subsystem
background Service from the same production entry:

```powershell
node scripts/release/build-windows-process-helper.mjs
node scripts/release/build-cli-binary.mjs --platform windows-x64
node scripts/release/build-cli-binary.mjs --platform windows-x64 --background
```

Artifacts are `cli/dist/openmeld-cli-windows-x64-<version>.exe` and
`cli/dist/openmeld-service-windows-x64-<version>.exe`, with the shared
`cli/dist/openmeld-windows-process.exe` next to them. The native helper is built
with .NET SDK 10.0.401 / Native AOT on Windows; it needs no user-installed .NET
runtime or compiler. Both the binary version bundle and npm's `dist/windows`
must carry that helper. Signing and multi-platform publication assembly remain
part of the installation/release gate; these development artifacts must not be
published as a complete Windows channel. The builder verifies the carriers'
actual PE subsystem values; a build flag alone is not sufficient evidence.
The Windows acceptance workflow pins Bun 1.4.2: the previous 1.3.14 Windows
compiler returned before applying `--windows-hide-console`. This does not change
the macOS publisher's toolchain.

`native-artifacts` in Windows compatibility exercises the real Service/private
Host channel, account fencing and shutdown, plus compiled SQLite and Agent SDK
protocol boundaries. Its child consumption environment uses disposable user
state and Windows-system-only PATH. Build tools on the hosted runner are not a
clean standard-user environment, and the protocol peer is not model inference.
Any failed native acceptance step fails its job. Artifacts are unsigned and
retained for bounded review, not published to a product channel.
This native workflow is also explicit, and is not a required PR check. Run it
when changing Windows carrier or process behavior, or before a Windows release;
check that the run used the intended candidate SHA:

```sh
gh workflow run windows-compatibility.yml --ref <candidate-branch>
```

For Mac development, a successful native artifact job also retains a small
`windows-process-<run>-<attempt>` artifact. Download that exact artifact from a
run of this branch, then import it with:

```sh
gh run download <run> --name windows-process-<run>-<attempt> --dir dev-tmp/windows-process-download
node scripts/release/windows-process-artifact.mjs dev-tmp/windows-process-download
```

Import verifies the pinned native build inputs and binary hash before copying
the helper into the workspace outputs. A changed C# source, SDK selection, or
helper build script requires a new Windows build. CLI packaging verifies it
again and rejects stale bytes; it never compiles C# on a user's machine. This
is build-input integrity, not Authenticode or production provenance. Production
assembly must consume its own trusted source-matched Windows build. That
release integration is still required before this implementation can be ready.

The implementation status and exact native evidence live in
[Windows Computer Connection Design](../architecture/windows-computer-connection-design.md).

### Local Web Setup Download Smoke

Use this when you need to manually test the same download shape that production
users exercise from the Web setup command.

- Start the local dev stack and Web in their normal terminals:

```sh
pnpm dev
pnpm dev:web
```

- Start the local CLI binary server in another terminal:

```sh
pnpm cli:binary:serve
```

- The server builds the current local `darwin-arm64` binary and serves:

```text
http://127.0.0.1:3197/cli/manifest.json
http://127.0.0.1:3197/cli/download/openmeld-cli-darwin-arm64-<version>
http://127.0.0.1:3197/cli/download/openmeld-cli-darwin-arm64-<version>.gz
```

- Local Web setup uses that manifest by default for the `dev-local` binary
  lane. Copy a fresh setup command from `http://localhost:3000` and run it in a
  normal terminal.
- Do not reuse an old setup command. Prepare Session tokens and one-time tokens
  expire.
- This smoke verifies the full setup path: Web-generated setup command,
  manifest download, gzip download and verification, decompression, final
  executable verification, `install-self`, managed CLI path, and
  `openmeld setup`.
- Directly running `cli/dist/<artifact>` is useful for
  CLI debugging, but it does not test the Web setup download, manifest, sha256,
  or managed install path.

## Verify

- Run the focused binary smoke with:

```sh
pnpm cli:binary:smoke
```

- The smoke builds a binary, runs `install-self` into a temporary dev-lane `OPENMELD_HOME`, checks the managed binary version, serves a local manifest plus raw and gzip artifacts, verifies both gzip and final executable sha256 values, and checks the generated dev-local binary bootstrap contract.
- Run the production-like binary setup smoke with:

```sh
pnpm cli:binary:prod-smoke
```

- The production-like smoke builds the real binary, serves a localhost manifest
  plus raw and gzip artifacts instead of R2, generates the production
  `dist=binary` setup bootstrap with a temporary `OPENMELD_HOME`, simulates
  `curl | sh`, verifies the gzip archive and decompressed executable, runs the
  real `install-self`, and checks the managed production-lane binary version.
  It also seeds one fixture account through the real CLI login flow, drives the
  Web-style piped bootstrap into a second-account confirmation in a real PTY,
  verifies arrow selection, Enter, Escape, and candidate-session cleanup, and
  proves the same path fails promptly without rendering a prompt when no
  controlling terminal is available. Auth responses use the shared Better Auth
  vendor-contract schemas and Prepare responses use the shared Prepare schema.
- To keep the temporary `OPENMELD_HOME` for manual inspection, run:

```sh
OPENMELD_KEEP_BINARY_PROD_SMOKE=1 pnpm cli:binary:prod-smoke
```

- Run release script and GitHub release workflow tests with:

```sh
node --test scripts/release/build-cli-binary.test.mjs scripts/release/cli-channel-sync.test.mjs scripts/release/cli-release-workflow.test.mjs scripts/release/macos-cli-signing.test.mjs scripts/release/release-cli.test.mjs scripts/release/upload-cli-binary.test.mjs scripts/release/verify-release-ready.test.mjs
```

- Run CLI version gate tests with:

```sh
pnpm --filter openmeld exec vitest run tests/version-state.integration.test.ts --config vitest.integration.config.ts
```

- Run Web route and setup tests with:

```sh
pnpm --filter openmeld-web exec vitest run src/lib/cli-binary-release.test.ts src/lib/setup-bootstrap-script.test.ts src/lib/cli-entry-command.test.ts --config vitest.config.ts
```

## Release

### Apple Signing And Notarization

The production `darwin-arm64` artifact must complete this sequence before any
R2 upload or manifest write:

```text
Bun compile -> Developer ID Application signing -> signature verification ->
Apple notarization Accepted -> final executable sha256 -> gzip the final
executable -> archive sha256 -> exact-base delta from the previous signed
release when available -> immutable raw, gzip, and delta uploads -> manifest
upload
```

- Signing uses the Hardened Runtime, a trusted timestamp, identifier
  `sh.openmeld.cli`, and the Bun JIT entitlements in
  `scripts/release/macos-cli.entitlements.plist`.
- The bare Developer ID CLI must remain launchable without an embedded
  provisioning profile. Its entitlements therefore include only the Bun
  runtime requirements and must not include `keychain-access-groups`. A signed
  launch, native macOS Keychain login/read/logout, and protected-item
  noninteractive-read smoke must pass before any binary upload. That smoke also
  proves the signed binary can launch itself as the bounded private Keychain
  helper for store, read, and delete. Unit and
  integration tests separately prove that the parent kills an unresponsive
  helper after five seconds and continues through the private-file fallback.
  CI signing temporarily places its ephemeral signing Keychain before the
  existing user Keychain search list, keeps the normal login Keychain in that
  list, and restores the original list after signing. It must not replace or
  hide the login Keychain, because the post-signing smoke needs normal user
  Keychain access.
- Notarization uses a temporary ZIP submission envelope. After Apple accepts
  that exact signed executable, release creates the gzip transport from it.
  Decompression therefore reconstructs the signed executable byte for byte.
- The manifest publishes the expected code identifier and Apple Team ID.
  Setup and managed-binary upgrade verify Developer ID Application authority,
  that exact identity, Hardened Runtime, and trusted timestamp before
  `install-self`. Delta reconstruction never modifies a signed binary in
  place: it creates a temporary candidate and must reproduce the final
  notarized executable's exact sha256 before signature verification.
- Every rebuilt binary must be signed and notarized again. The same active
  Developer ID certificate and Team API key can be reused across releases.
- The release fails closed before R2 upload when the signing identity is
  missing, signature verification fails, notarization is not `Accepted`, or
  any required credential is absent.

The GitHub `cli_release` job runs on Apple silicon `macos-15` and reads these
GitHub Environment secrets from `production`:

```text
APPLE_DEVELOPER_ID_P12_BASE64
APPLE_DEVELOPER_ID_P12_PASSWORD
APPLE_NOTARY_KEY_P8_BASE64
APPLE_NOTARY_KEY_ID
APPLE_NOTARY_ISSUER_ID
APPLE_TEAM_ID
```

Credential ownership is explicit:

- `APPLE_DEVELOPER_ID_P12_BASE64` is the base64-encoded `.p12` containing the
  Developer ID Application certificate and its private key.
- `APPLE_DEVELOPER_ID_P12_PASSWORD` is the dedicated `.p12` export password. It
  must not be an Apple Account password, a Mac login password, or a shared human
  account password.
- `APPLE_NOTARY_KEY_P8_BASE64`, `APPLE_NOTARY_KEY_ID`, and
  `APPLE_NOTARY_ISSUER_ID` authenticate `notarytool` with an App Store Connect
  API key.
- `APPLE_TEAM_ID` is the public Apple Developer team identifier used to reject a
  signing identity from the wrong team.
- The downloaded `.cer` and the CSR used to request it are issuance records.
  They are not CI release inputs and must not be added as GitHub secrets.

The `.p12`, `.p8`, and their plaintext passwords must never be committed or
printed in release logs. CI imports the `.p12` into an ephemeral Keychain,
selects that Keychain as the CI user's isolated search list for signing, and
deletes the Keychain and decoded files after signing.

GitHub secret values are write-only. This command confirms that all required
names exist in the `production` Environment, but it cannot validate or reveal
their values:

```sh
gh secret list --env production --repo amplifthq/openmeld
```

Do not print, download, or echo secrets to validate them. The release validates
the `.p12` password by importing the signing identity, verifies the identity's
Team ID, and authenticates with Apple before any R2 upload. A wrong or incomplete
credential therefore fails the release closed without publishing a binary.
The macOS publication step receives the production credentials and runs release
readiness inside the release command before any irreversible upload or publish.
Apple secrets are first consumed and validated by the signing step; earlier
setup and build steps do not receive them.

Local release uses the Developer ID identity already installed in the login
Keychain and the default `notarytool` Keychain profile `openmeld-notary`.
Configure that profile once with:

```sh
xcrun notarytool store-credentials "openmeld-notary" \
  --key /secure/path/AuthKey_<KEY_ID>.p8 \
  --key-id <KEY_ID> \
  --issuer <ISSUER_ID>
```

After the credentials validate, the local lane uses the same signing,
notarization, verification, R2, npm, and tag path as GitHub:

```sh
pnpm run deploy -- --scope cli --lane local
```

Local release still requires a clean worktree and the normal production npm,
Cloudflare, and deploy credentials. Override the public team or local profile
names only when rotating configuration:

```sh
APPLE_TEAM_ID=<TEAM_ID> \
APPLE_NOTARY_KEYCHAIN_PROFILE=<PROFILE_NAME> \
pnpm run deploy -- --scope cli --lane local
```

Do not export only part of the CI credential set during a local release. Any CI
credential input selects the ephemeral CI Keychain path, which requires the
complete six-secret contract. A normal local release should rely on the login
Keychain identity and `openmeld-notary` profile instead.

### Release Operator Checklist

The CLI releases as the `cli` component of
[production release](production-release.md#cli-release):

```sh
pnpm run deploy -- --scope cli --lane github
```

1. The feature PR bumps `clients/openmeld-cli/package.json` and records the
   `available` or `required` decision in `release/local-components-policy.json`.
2. Database prerequisites release first (`--scope db`) when the CLI needs them.
3. Require an `Apple notarization accepted` submission ID before treating the
   binary upload as valid.
4. Close the release only after the npm version and `gitHead`, the production
   CLI manifest, downloadable raw and gzip artifacts, the release tag, and the
   R2 `cli/local-components.json` all agree.

`--lane local` runs the same `publish-cli.mjs` from a clean checkout at the
exact SHA with the local Developer ID identity, `openmeld-notary` Keychain
profile, npm authentication, and Cloudflare production credentials. A rerun of
the same SHA resumes after the last completed stage.

- The publisher writes the raw executable, `<artifact>.gz`, and any materially
  smaller exact-base delta to `openmeld-desktop-downloads-prod/cli/`.
- It writes the binary manifest to
  `openmeld-desktop-downloads-prod/cli/manifest.json`.
- The npm package field `openmeld.minRequiredCliVersion` is the tracked CLI
  compatibility floor. The same guarded release reads that field into
  `channels.stable.minRequiredCliVersion`; npm latest and the R2 stable manifest
  must expose the exact same floor after publication. A compatibility-floor
  raise targets the first proven-safe CLI, not automatically the latest CLI.
- The public Web routes are `/cli/manifest.json` and `/cli/download/<artifact>`.
- The shared manifest reader accepts an optional `channels.stable.service`
  selection containing its version and immutable platform artifacts. It reuses
  the CLI artifact integrity/signature/transport schema and must cover every
  advertised CLI platform. Legacy manifests omit it. CLI release acquisition
  preserves the selected Service metadata separately from the CLI artifact.
  A binary CLI can embed that same selection in package metadata at
  `openmeld.service`, so setup and repair retain their release target without
  consulting a mutable local version cache. Preparing a selected artifact uses
  the existing verified downloader and Service bundle directory; it does not
  run `install-self` or move the user's CLI pointer. Maintenance checks the
  installed managed CLI version rather than treating its own retained carrier
  version as the current CLI. The carrier remains available to repair a missing
  managed CLI.
  Binary builds can receive the same immutable selection from the publisher;
  it is embedded at compile time and written unchanged to the channel manifest.
  Staging `publish --retain-service` exercises that path against the existing
  staging-only Service artifact. Production may retain the prior published
  Service only when the base-aware release classifier proves no Service-owned
  input changed. The selected Service version must be no newer than the CLI,
  and the publisher, resumable stage probes, and channel-sync gate all verify
  its exact raw and gzip artifacts before the manifest can move. Any
  Service-owned change keeps the release coupled. Deploy Web manifest readers
  before publishing the field; older Web readers strip unknown metadata.
- Each platform record keeps `url`, `sha256`, and `sizeBytes` for the raw
  executable so older clients continue to work. The additive
  `archiveFormat`, `archiveUrl`, `archiveSha256`, and `archiveSizeBytes` fields
  describe the preferred gzip transport. Current clients fail closed if those
  fields are only partially present.
- Optional `deltas` records describe only exact previous binary bases. The
  shared schema also owns the block-range patch payload. Existing Web and CLI
  consumers ignore these additive fields; current upgrade clients inspect all
  candidates for the running version, use only the exact size-and-sha256 local
  match, and retain gzip as the mandatory fallback. Multiple signed builds may
  share a version, so candidate order is not selection authority.
- Immutable raw, gzip, and delta objects are uploaded before the mutable
  manifest. A manifest must never advertise a delta that is not downloadable.
- A new production CLI version publishes its binary channel before npm and
  before the release manifest that Core reads.
- `.github/workflows/cli-release.yml` is the GitHub entrypoint, called by
  `deploy.yml`. The npm package's trusted publisher must match repository
  `amplifthq/openmeld`, workflow `cli-release.yml`, and GitHub Environment
  `production`. The workflow uses GitHub OIDC with `id-token: write`; do not add
  an `NPM_TOKEN` fallback. npm provenance is disabled because the source
  repository is private. The publishing job runs on macOS for Developer ID
  signing and `notarytool`; the Windows helper builds in the same run.
- The default production setup script uses the binary distribution on supported
  macOS computers. Use `?dist=npm` to force the npm lane.
  The Apple silicon bootstrap uses macOS `plutil` to read the exact stable CLI
  version and platform artifact paths. It must not search JSON text for field
  names: a selected Service, another platform, or delta metadata can contain the
  same names with different values. This does not require Node.js or jq.
- The dev-local setup script also defaults to binary distribution. Use
  `?dist=npm` to force the npm lane during local testing.
- Windows binary setup selects the public Windows preview entrypoint when the
  signed stable channel lacks Windows artifacts. Its channel choice must remain
  attached to the managed installation; a newer macOS stable version is not a
  Windows update target.

## Source-specific binary update projection

Binary publishers include `componentPolicy` from the exact release manifest.
Each policy version must match its selected CLI or Service artifact; never rewrite
a bundle hash to an executable SHA-256. Core reads the required policy from
`cli/local-components.json` independently of the optional `cli/manifest.json`
and `cli/windows-preview/manifest.json` channel catalogs. Each successful read
is valid for at most one minute from its start, per isolate. Reads after 30
seconds trigger one shared background refresh per source group through Workers
`waitUntil`; queries continue using the validated, unexpired policy without
waiting for that refresh. Cold or expired policy reads wait only for required
policy, never for the optional channels. A slow first R2 policy read can therefore
still delay a cold request.

RuntimeTransportHub constructor and registration gates are snapshot consumers:
they start background refresh before entering the gate and never await it there.
They use only unexpired validated policy, or a missing-policy snapshot while R2
is pending. This keeps local initialization and registration responsive even
when R2 never returns. The ordinary Core new-Wake admission path independently
reads and validates required policy; a connected Service is not evidence that
new work may bypass that check.

A missing or invalid required manifest fails closed and blocks new Wake work.
Transport failures retry after ten seconds but never extend a previously
validated policy's expiry. Once that policy expires, a failed read leaves Wake
blocked until a valid required manifest is read again. Channel reads and their
pending work cannot hold up required-policy refresh. Channel availability also
expires after one minute; it is derived against the current valid required
policy, so a late channel read cannot restore an older required policy. A
Windows-preview 404 means channel absence. A new CLI or Windows preview needs
no Core deploy. Deploy all strict Gateway/Core/Web report receivers before
publishing a new CLI/Service source field.

The native Windows preview builder currently builds a fresh GUI Service carrier
at the CLI version. It rejects a retained older Service policy before compilation;
prepare the corresponding Service release rather than relabelling the new image.
The stable publisher supports verified separately retained Service artifacts.
Staging/custom binary versions omit production component policy unless the caller
supplies an exact-artifact policy; they never inherit production version identity.
