# Control Plane image releases

Automatic image publication is retired. CI still builds and checks the image,
but no workflow publishes it to GHCR. The publication procedure below is kept
as a historical reference. Existing published images are unchanged.

The Control Plane image contains HTTP, durable jobs, migrations, and bootstrap
commands. Deployment wrappers consume this image; they must not copy application
code or SQL. The first published platform is `linux/amd64`.

## Publication contract

1. A pull request runs the existing build, lint, typecheck, test, PostgreSQL,
   release-package, relay-profile, and browser gates. The image job additionally
   builds the OCI image, audits its installed public runtime dependencies, and
   checks container bootstrap, jobs ordering, restart, and retired-schema refusal.
2. On a `main` push, CI saves that exact tested image as a short-lived artifact.
3. `Publish Control Plane image` runs only after the whole `main` push CI succeeds.
   It downloads the artifact from that exact run and checks its revision and
   non-root user. It never rebuilds the image and never publishes from a PR run.
4. The workflow uses its repository-scoped `GITHUB_TOKEN` with `packages: write`
   to publish to `ghcr.io/amplifthq/opentag-control-plane`. No personal registry
   token is required in repository secrets.
5. Tags include the full source SHA, publication run ID, and attempt. A rerun
   creates a new tag rather than replacing an earlier release. No `latest` tag
   is published. Consumers pin the returned `sha256` digest.

The `control-plane-image-receipt-<source-sha>` artifact contains
`control-plane-image.json`: schema version, image name, tag, digest, source SHA,
and platform. This is the input to the template repository's `pin-image` command.
Retain reviewed receipts with template changes; the CI image tar expires after
three days and the publication receipt artifact after 90 days.

On the first GHCR publication, verify package access in GitHub. The workflow
checks an anonymous pull after retaining the receipt. If GitHub initially makes
the package private, set the new package's visibility to public in its settings
and rerun publication. Do not distribute private registry credentials in a
deployment template. A failed anonymous pull is not a usable public release.

Source merge, CI success, image publication, public pull access, Railway
deployment, and real Slack/GitHub acceptance are separate results. A template
button is published only after fresh-environment validation.

## Platform container entry point

The normal `serve`, `jobs`, `migrate`, `bootstrap-admin`, and `bootstrap-slack`
commands remain unchanged for Compose. Environment-injecting platforms use:

```sh
node apps/control-plane/dist/index.js container serve
node apps/control-plane/dist/index.js container jobs
```

This entry point accepts only those two roles, not arbitrary shell commands.
`container serve` validates bootstrap inputs, waits for PostgreSQL, then invokes
the existing migration, administrator, and Slack bootstrap commands in order.
Only then does it start HTTP. Initialization failures stop startup; mutations
are not retried inside the startup sequence. A container restart reuses the
existing bootstrap replay rules. Bootstrap never resets an owner's password or
repairs a conflicting Slack binding automatically.

`container jobs` does not initialize state and does not need the bootstrap owner
password. It waits for `/readyz` and `/v1/relay/capabilities` on
`OPENTAG_CONTAINER_CONTROL_PLANE_URL`, requiring the same image release SHA,
before invoking the existing jobs process. Use the Control Plane's private
HTTP origin on port 3000. Observations have per-request timeouts and dependency
waiting has a five-minute deadline. Readiness requests do not grant authority
or prove that Slack credentials are accepted by the provider.

Keep one replica of each application role for this profile. Disable platform
sleep and allow time for SIGTERM draining. The profile does not claim HA or
zero-downtime schema upgrades.

## Secret injection

Set the existing non-secret runtime/bootstrap configuration from the Compose
runbook. `PORT` is used when `OPENTAG_PORT` is not set; the template sets both to
3000. The image embeds `OPENTAG_RELEASE_SHA`; do not override it with a template
repository SHA.

Platform secret inputs are:

| Input | File supplied to the existing runtime |
| --- | --- |
| `OPENTAG_CONTAINER_RELAY_CONTENT_KEK` | `/run/secrets/opentag_relay_content_kek` |
| `OPENTAG_CONTAINER_SLACK_SIGNING_SECRET` | `/run/secrets/opentag_slack_signing_secret` |
| `OPENTAG_CONTAINER_SLACK_BOT_TOKEN` | `/run/secrets/opentag_slack_bot_token` |

The KEK must be 64 hexadecimal characters encoding 32 bytes. Set the immutable
`OPENTAG_RELAY_CONTENT_KEY_VERSION` to `v1` for a new installation. Generate the
KEK and each other internal secret once through platform secret facilities,
then reference the same values from both roles. Never generate keys per boot.

The image prepares `/run/secrets` for UID/GID 10001 with mode 0700. The entry point
writes mode-0400 regular files, consumes its injected secret variables, and
passes only file references to the existing runtime. Existing files are reused
only if their content, type, ownership, and permissions match; symlinks and
conflicting files fail closed. Compose-mounted secrets are not overwritten.
Runtime code still forbids inline `OPENTAG_RELAY_CONTENT_KEK`.

The hosting platform and its administrators can access injected variables.
Removing values from the application environment does not erase the platform's
stored configuration. Store them only in the platform's protected variable
settings; never commit them, put them in image build arguments, or copy live
project secrets into a shared template.

Back up PostgreSQL together with the exact KEK and key version. Container files
are ephemeral; the platform's retained secret value is needed after redeploy.
The pre-reset database remains unsupported. Use a separate fresh database and
preserve the old recovery set as described in the main deployment runbook.

## Local verification

```sh
docker build --build-arg OPENTAG_RELEASE_SHA=<full-source-sha> \
  --file apps/control-plane/Dockerfile --tag opentag-control-plane:test .
node scripts/test/control-plane-image-smoke.mjs opentag-control-plane:test
docker run --rm --interactive --entrypoint node opentag-control-plane:test \
  --input-type=module < scripts/release/audit-control-plane-image.mjs
```

The smoke uses an isolated Docker network, temporary PostgreSQL data, and fake
provider credentials. It performs no real Slack/GitHub writes and removes its
own containers and files. The audit sends only installed public dependency
names and versions to npm's bulk advisory endpoint, and fails on registry
errors or high/critical findings. It does not constitute an operating-system
image vulnerability scan.
