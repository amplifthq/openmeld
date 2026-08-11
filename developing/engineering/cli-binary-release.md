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
- The current output is written under `clients/openmeld-cli/dist/binary/`.
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
- The supported platform for this milestone is `darwin-arm64`.
- The binary distribution marker is injected at compile time by `bun build --compile`.
- Release builds minify bundled code while preserving function and class names
  for diagnostics. This reduces the current executable by about 4.4 MiB and
  the complete gzip download by about 0.45 MiB; it cannot remove the roughly
  60 MiB Bun runtime embedded in every standalone executable.
- The iterate build is intentionally unsigned. Production publishing signs and
  notarizes the final executable before calculating the release sha256.
- Managed installs retain the active CLI version and one usable rollback
  version older than the active version. Incomplete and older managed
  semantic-version directories are removed during `install-self`; unrecognized
  directories are preserved because the installer cannot prove that it owns
  them.
- Production `install-self` also prepends `~/.openmeld/bin` in the user's zsh,
  bash, or fish startup configuration so future `openmeld` commands resolve to
  the managed binary instead of an older package-manager copy. Custom
  `OPENMELD_HOME`, dev-local, and canary installs never modify the user's shell
  startup files.
- Production binary setup also reconciles a known older global `openmeld` npm
  package before `openmeld setup` can report completion. It installs the exact
  version declared by the downloaded binary manifest, then verifies that the
  current terminal's `openmeld --version` reaches that version. A failed or
  ineffective npm update stops the bootstrap with explicit recovery guidance;
  an already-authoritative command adds no npm install or network round trip.

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
- Directly running `clients/openmeld-cli/dist/binary/<artifact>` is useful for
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

- The production-like smoke builds the real binary, serves a localhost manifest plus raw and gzip artifacts instead of R2, generates the production `dist=binary` setup bootstrap with a temporary `OPENMELD_HOME`, simulates `curl | sh`, verifies the gzip archive and decompressed executable, runs the real `install-self`, and checks the managed production-lane binary version.
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

After the credentials validate, the normal local production command uses the
same signing, notarization, verification, R2, npm, tag, and Core rollout path as
GitHub:

```sh
pnpm run release:cli --with-binary
```

Local release still requires a clean worktree and the normal production npm,
Cloudflare, and deploy credentials. Override the public team or local profile
names only when rotating configuration:

```sh
APPLE_TEAM_ID=<TEAM_ID> \
APPLE_NOTARY_KEYCHAIN_PROFILE=<PROFILE_NAME> \
pnpm run release:cli --with-binary
```

Do not export only part of the CI credential set during a local release. Any CI
credential input selects the ephemeral CI Keychain path, which requires the
complete six-secret contract. A normal local release should rely on the login
Keychain identity and `openmeld-notary` profile instead.

### Release Operator Checklist

For the normal GitHub production path:

1. Confirm the exact release commit is on `main`; run
   `pnpm run release:preflight`, then prepare the tracked release version and
   `release/local-components.json` with the base-aware
   `pnpm release:local-components stamp --next ...` command. The command reads
   npm `latest` and R2 stable, prints the decision, and fails without guessing
   when either channel is unavailable. Use mutually exclusive
   `--version X.Y.Z` only for an already-approved explicit target. Then pass
   `pnpm run verify:release-ready`.
2. Confirm the six Apple secret names above exist in the GitHub `production`
   Environment.
3. Run `.github/workflows/cli-release.yml`. It defaults to `mode=verify`, which
   is a safe manual readiness check. Select `mode=release` with
   `release_path=normal` and the exact release commit SHA when publishing. The
   publish command verifies release readiness before its first irreversible
   action, so a separate verify run is optional rather than a required repeated
   gate. Use the separate Scoped Production Release workflow when the release
   also requires database or cloud fleet changes.
4. Require an `Apple notarization accepted` submission ID before treating the
   binary upload as valid.
5. Close the release only after the npm version, production CLI manifest,
   downloadable raw and gzip artifacts, release tag, and Core projection all
   agree.

For the first release that introduces gzip manifest fields, deploy Web from the
same approved SHA before step 3. The old Web manifest parser removes unknown
fields when it reserializes R2 metadata; the new Web is therefore the consumer
that must be live before the CLI channel can expose the archive. See
`developing/engineering/production-release.md` for the first-launch order.

For an explicitly approved local production release:

1. Use a clean worktree at the exact `main` commit intended for release.
2. Confirm the local Developer ID identity, `openmeld-notary` Keychain profile,
   npm authentication, and Cloudflare production credentials are available.
3. Run `pnpm run release:verify:local -- --scope cli` for full confidence, then
   run `pnpm run release:deploy:local -- --scope cli`; deploy owns the cheap
   preflight and the complete binary release path without repeating tests.
4. Require the same notarization, upload, npm, tag, Core, and channel-alignment
   results as the GitHub path.

Do not run `upload-cli-binary.mjs` as the normal production entrypoint. It is a
scoped binary-channel operation for an approved recovery or diagnostics flow;
the complete release entrypoint is `release:cli --with-binary`.

- For an approved scoped recovery or diagnostics flow, upload the binary and
  manifest to the production R2 bucket with:

```sh
node scripts/release/upload-cli-binary.mjs
```

- The upload writes the raw executable, `<artifact>.gz`, and any materially
  smaller exact-base delta to `openmeld-desktop-downloads/cli/`.
- The upload writes the manifest to `openmeld-desktop-downloads/cli/manifest.json`.
- The public Web routes are `/cli/manifest.json` and `/cli/download/<artifact>`.
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
- A new production CLI version must publish its binary channel before Core can
  advertise that version. Use the binary release path:

```sh
pnpm run release:cli --with-binary
```

- The release builds and uploads the manifest and platform artifacts before its
  final Core deploy. That Core deploy runs the production channel-sync gate:
  the stable channel must not trail `release/local-components.json`; when the
  versions match, every declared platform raw, gzip, and delta URL must answer
  successfully with complete manifest metadata.
- `pnpm run release:cli` without `--with-binary` is only a recovery/resume path
  when the same version is already live on the production channel. Its
  preflight fails closed when the declared version is ahead of the channel.
- `pnpm run deploy:core:local-components` is the scoped Core redeploy path for
  an already-published release. It enables the same channel-sync gate.

- `.github/workflows/cli-release.yml` is the GitHub Actions entrypoint for a
  trusted CLI publish and its production rollout. The npm package's trusted
  publisher must match repository `amplifthq/openmeld`, workflow
  `cli-release.yml`, and GitHub Environment `production`. The workflow uses
  GitHub OIDC with `id-token: write`; do not add an `NPM_TOKEN` fallback. npm
  provenance is explicitly disabled because the source repository is private;
  trusted publishing still uses short-lived OIDC authentication, while npm's
  public Sigstore provenance service only supports public source repositories.
  The binary-publishing job runs on macOS because Apple Developer ID signing
  and `notarytool` are required before R2 publication.
- The workflow defaults to a non-publishing verify mode. Explicit release mode
  publishes the npm package and signed/notarized binary channel,
  creates the tag, and deploys Core through the guarded release command. It
  does not touch D1, Auth, Remote Agent, Gateway, or Web. Coordinate any broader
  rollout through `.github/workflows/release-on-main.yml`.
- Keep the default `release_path` set to `normal` for every complete release.
  The legacy `resume-after-binary-upload` and `resume-after-npm-publish` inputs
  remain accepted, but all three inputs run the same resumable
  `pnpm run release:cli --with-binary` command. Pass the exact original
  `release_sha`; read-only completion probes skip an already published binary,
  npm version, matching release tag, or active Core projection without
  overwriting immutable artifacts.
- The default production setup script uses the binary distribution on supported
  macOS computers. Use `?dist=npm` to force the npm lane.
- The dev-local setup script also defaults to binary distribution. Use
  `?dist=npm` to force the npm lane during local testing.
- Windows setup commands remain on `?dist=npm` until Windows binary artifacts
  exist.
