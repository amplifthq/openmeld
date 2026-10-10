# Production Release

## Agent Context

- Purpose: Define component-specific planning, ordering, commands, gates, and
  recovery for OpenMeld production releases without turning every change into
  a fleet rollout.
- Read this when: You are planning or executing a local or GitHub production
  deploy, a relational migration, a CLI publish, or Desktop release assessment.
- Update this when: Release scopes, workflow inputs, production ordering,
  database gates, CLI publication, Desktop coverage, health checks, or release
  evidence changes.
- Do not use this for: Feature-specific smoke steps, local development lanes,
  database ownership, or CLI binary implementation details.
- Source of truth: This file owns production release scopes, implementation
  entrypoints, component ordering, and component evidence. The end-to-end
  candidate, merge, release, health, smoke, and recovery lifecycle is owned by
  `agent-native-delivery.md`.

Follow `developing/engineering/agent-native-delivery.md` first. This document
supplies the scoped release mechanics inside that lifecycle and must not be
used to invent a second merge or evidence contract.

## The Default Rule

Release only what changed.

Production uses PostgreSQL. Use the guarded local lane for Database, Auth and
Core, and the GitHub CLI workflow for npm Trusted Publishing. Other hosted
scopes remain available. The parent workflow rejects unsupported PostgreSQL
scopes before artifact builds or database jobs. This is a lane restriction, not
a request to repeat the initial D1 cutover. The database receipt proves the applied schema, journal,
target and grants. Auth and Core receipts prove their active deployments and
PostgreSQL bindings. A database migration alone does not require redeploying
both services. CLI admission checks these facts before publication and Core
activation.

For local release, pass `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN` from `openmeld-release/prd`. In that
scoped child environment, also map the same release token to
`CLOUDFLARE_API_TOKEN` for Wrangler and Website domain admission; retain the
scoped variable for Hyperdrive inspection. Do not write either token to disk.

The CLI workflow records Core activation through the existing component receipt
owner. If a prior attempt applied this exact source but failed its remaining
health checks, database admission checks that recorded identity against the live
deployment and the workflow resumes the original receipt before publication.
Unknown deployments and different source attempts remain blocked.
First-cutover capture, import and Cron controls belong to the
[cutover runbook](postgresql-cutover.md). Routine releases use the normal commands
below.

- A Web fix releases Web.
- A public website fix releases Website, without rebuilding or deploying Web.
- A Gateway fix releases Gateway.
- A database migration plus Core change releases Database, then Core.
- A CLI patch publishes CLI and updates its required Core projection. When the
  base-aware classifier proves no Service-owned input changed, the release may
  retain the exact prior published Service; otherwise CLI and Service remain
  coupled.
- Any change to a file that feeds the packaged CLI or OpenMeld Service bundle,
  including the CLI's `src/model-catalog/offline-catalog.json` snapshot, is a
  local-component release even when no runtime behavior changes: stamp from a
  clean `main` worktree and publish through the CLI lane. A Core-only deploy
  fails closed on the stale bundle hash.
- Changes to the live `release/vendor-models.json` catalog select Core. The CLI
  reads that catalog online and no longer embeds it; data edits within the
  existing schema do not require a CLI release.
- `cloud` and `full` are explicit coordinated rollouts, not defaults.

The reviewed Windows x64 internal preview is a narrow exception to the
CLI-before-Web npm setup dependency. Its Web bootstrap selects a separate
binary distribution, while the existing npm setup behavior is unchanged.
Production admission recognizes only the reviewed before/after Git blobs for
the three shared setup/artifact files and the preview-specific paths. Any later
edit to those shared files restores the normal dependency. This exception does
not publish the stable npm CLI or relax artifact, source, or stage admission.

Do not redeploy unrelated services for ceremony. Broader validation may be
appropriate for a cross-service contract change, but broader validation does
not require a broader production rollout.

Project workflow and Task receiver changes can share a release when their
actual dependency edges remain acyclic. The guarded planner composes Core before
Gateway and the local Service, Core before the Project issue action owner in
Remote Agent, and Remote Agent before the Web issue settings. When shared-folder
controls change with local capability v4, CLI publication also precedes Web.
The first Core deployment retains the immutable published CLI projection; CLI
publication activates its matching Core projection. Opposing receiver contracts
still require separate stages. Do not narrow the release base to hide a conflict.

### Desktop release coverage

The scoped planner and `release:status` cover Database, cloud services, and
CLI; neither `cloud` nor `full` publishes Desktop. For the same exact merged
range, assess Desktop separately against its last promoted source on each
supported platform. A direct Desktop Main or packaging change must be present
in the promoted release on each affected platform; publish it if missing. A
Web, shared-package, lockfile, or Desktop-build-script change enters Desktop
impact review because those paths feed its renderer/build identity; publish
only when the built Desktop or its installed behavior actually changes. Record
a concrete exclusion reason when it does not.
Compare the candidate's source with the product merge by ancestry; a later
release-only version commit can include an earlier product merge.

The authoritative release state is each platform's promoted R2 pointer:
`desktop/promoted.json` for macOS and
`desktop/promoted-windows-{x64,arm64}.json` for Windows. Each points to an
immutable candidate with source, version, and artifact hash. Read all three
without changing them:

```sh
pnpm --filter @openmeld/schemas build
doppler --silent run --project openmeld-release --config prd \
  --only-secrets CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN \
  --no-fallback -- node scripts/release/desktop-preview.mjs status
```

After the local schema build, the status command prints one JSON line per
platform and exits nonzero if a pointer or candidate cannot be read or
validated. A confirmed absent pointer is
`unpublished`; a read failure is `unknown`. Public download and updater pages
are separate user-facing checks. Keep candidate upload, promotion, and
[installed update acceptance](../clients/desktop.md#installed-a-to-b-release-acceptance)
as separate facts; use the [Desktop release workflow](development-workflow.md#desktop-preview-release-workflow)
for their publication steps.

## Choose The Release Lane

| Current situation                                                                                                                           | Use                                                                                 | Why                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A dedicated release worktree is clean at the exact approved `main` commit, and local production credentials are ready                       | Local scoped release                                                                | It is the shortest path and deploys directly from the approved immutable commit without occupying the human workspace. |
| Other agents have dirty work, work is arriving from multiple machines, or the local workspace cannot become clean without interrupting work | GitHub scoped release                                                               | GitHub checks out one immutable commit and does not consume the shared local workspace.                               |
| Publishing a normal CLI release with Apple signing and notarization                                                                         | GitHub CLI release by default                                                       | The macOS runner and production Environment own the complete signing, notarization, R2, npm OIDC, tag, and Core path. |
| Recovering a partially completed CLI release                                                                                                | GitHub CLI release with the exact original `release_sha` and matching recovery path | Every resumed stage stays anchored to the commit that created the immutable artifact.                                 |

Do not use the primary `main` checkout as an agent release lane. Do not use a
local production release from a dirty worktree, or stash or delete another
agent's work to manufacture a clean release window. Prepare a dedicated release
worktree at the approved `main` commit, or commit and push the intended release
commit and use GitHub instead.

## Read Remote Release Status

Use this when choosing scopes, inspecting a backlog, or reconciling uncertain
evidence. For a known scope, go directly to its guarded preflight instead of
running this separate history scan first; the preflight performs the same
read and checks the selected scope's dependencies.

Compare an immutable remote ref with
the latest successful component jobs recorded by GitHub Actions:

```sh
git fetch origin main --tags
pnpm run release:status -- --ref origin/main
```

This command is read-only. It reads Git history, GitHub workflow/job results,
and the durable exact-SHA refs published by successful guarded local releases.
It reports the production components whose deployed commits are behind the
selected ref and fails closed while push checks for that ref are red or still
running. It does not dispatch a workflow, deploy a component, or edit a release
file. Its `Deployment state` describes deployment history, not permission to
release. `Source validation` reports exact-SHA push evidence when present and
otherwise tells the operator to confirm exact Final Candidate evidence. Use
`--json` for automation. Desktop is outside this status result; complete its
[platform assessment](#desktop-release-coverage) before closing the release task.
For one read-only planning pass, add `--plan-stage <scope>` to print the
selected stage's prerequisite decision from the same status snapshot. This
avoids an immediate second history collection while planning. It is not the
final admission: the guarded release entrypoint still refreshes status and
acquires its lease before any Production mutation.

Read-only GitHub history requests retry a failed page at most twice for HTTP
500, 502, 503, or 504, retaining pages already read. Exhausted retries,
permissions failures and malformed collections remain incomplete evidence and
fail closed; no mutation receives this retry policy.

The reader merges validated local receipts before inspecting hosted jobs, using
the same completion-time source selector for both lanes. A successful,
non-conflicting receipt can bound job history only when every component has a
known successful baseline. Completed runs strictly older than that bound need
no job or checkout-log query. Active runs, missing update times and updates at
or after the bound remain inspected. A failed, started or applied local record
can use its most recent verified first-parent receipt only as the history bound;
the same evidence reader validates its metadata, scope, exact source tree,
provenance and chronological order. The latest record remains the current
deployment state and does not become verified. A missing verified baseline,
conflict or legacy unverified record cannot bound history, and an invalid chain
blocks admission.
Workflow-listing failures still block admission, including when local receipts
are available; this bound does not turn an unreadable newer history into success.

In GitHub Actions, the status reader uses the step's `GH_TOKEN` with the
workflow repository and server identity to read private Git receipt refs.
The existing trusted HTTPS helper supplies credentials only to those Git
children; checkout credentials stay unpersisted. Missing credentials or a
repository mismatch remain admission failures. Local reads retain the
workstation's existing Git authentication.

The resolved source SHA is the cutoff for that release. Commits that reach
`main` after the cutoff belong to the next release; do not restart or widen an
already-running release merely to chase a newer `main`.

Guarded local releases advance the existing append-only refs under
`refs/heads/openmeld-production-release-evidence/<scope>` while retaining the
selected component leases. Each component first records `started`, then
`applied` with its observed identity after the deploy command, and `verified`
only after its existing health and source checks. A later failure records
`failed`, distinguishing unknown application from an observed applied version.
Previously verified components remain visible even when another component fails;
this never creates an overall successful-release record for a partial run.

Version 3 binds each attempt to an operation key (source, component, actual
command and deployment target, including the Core projection). Worker identity
comes from a fresh command-scoped Wrangler output file. Before that command, the
executor retains the target Worker's deployment IDs; afterward exactly one new
deployment must be the active deployment and contain the command's exact version
at 100% traffic. Zero or multiple new deployments stop as unresolved instead of
guessing an ID. The correlated deployment ID is checked again after health
checks. An arbitrary current version, stale
output, another Worker/environment, changed projection, or missing output cannot
be promoted to verified. The guarded Core deploy wrappers forward the already
admitted version after activation, including atomic migrations; they do not alter
startup admission, profiling or build policy. The CLI publisher returns its
existing exact-source/tag/channel verification for no-op projection recovery;
`cli-projection` evidence explicitly does not claim a new Worker upload.

Before effects, the executor reads retained receipts under the existing leases.
A matching correlated applied Worker can resume its remaining read-only checks
and append a completion for the same attempt, without rerunning deployment. A
failed health check can likewise be recovered only with unchanged identity.
CLI/Core recovery additionally uses the CLI owner's read-only immutable-channel
checks, never another publisher invocation. A verified identical operation is
idempotent. For an intentional new same-source deployment, pass `--redeploy` to
the guarded `deploy` command only after the prior attempt is resolved; that flag
cannot override an unresolved attempt. A different-source release or rollback
still follows ordinary source, channel and lease guards.

Core can retry a failed upload under the same source, operation and attempt when
the previous verified deployment ID and version still serve 100% of traffic.
The executor verifies that identity under the Core lease before effects and
requires fresh command-correlated activation evidence afterward. PostgreSQL
admission checks that active baseline's bindings; it does not mark the failed
attempt successful. An intervening deployment, including a rollback to the same
version, blocks this retry.

Other unknown application, missing output, unreadable receipts, mismatched targets and
unresolved legacy records block before a new attempt or deployment. They require
separate evidence-backed reconciliation, not a new UUID or a status override.
Recovery always runs current-main guarded control against the retained source
and current contract. An applied exact identity resumes its remaining read-only
checks through the same guarded command. If the retained source cannot satisfy
the current contract, use an evidence-backed forward fix or a documented
component-specific recovery; never run older guards, replace the receipt, or
bypass admission to force a rollback.

Ordinary local PostgreSQL deployment admission can inspect an applied or failed
Auth/Core health-resume candidate only when that component is selected and its
source matches the release. It still verifies the retained active deployment,
PostgreSQL binding, Hyperdrive target and normal Cron configuration. Before any
component effects, the receipt executor must match the operation key, target and
live identity; admission does not promote the failed receipt. Cron restoration
requires verified receipts and cannot use this health-resume path.

For local recovery after a control-only fix, keep the approved product checkout
clean and invoke the current-main `scripts/release/production-release.mjs` by
absolute path with the product checkout as the working directory. The executor
honors each step's declared control interpreter, Node flags and arguments, and
sets its verification root to the product source. Worker target resolution loads
the pinned Wrangler parser from that source's installed dependencies; the
minimal trusted-control checkout does not own product tool dependencies.

The current environment verifier requires Core Account avatar storage only when
that product source includes the Core account-deletion owner. Historical sources
without that feature keep their existing binding contract; sources with the
feature must declare the exact avatar bucket. Auth and Gateway requirements do
not change, and this does not waive any deployment or receipt identity check.

Core receiver deployment uses the current trusted control's two-step receipt
executor. After Cloudflare confirms the newly admitted version at 100% traffic,
it persists `applied` before checking stable channel alignment. An alignment
failure retains `failed/applied`; the same source, operation, projection and
active deployment may resume alignment without another upload or deployment.
Alignment reads the published CLI's required-update floor from that version's
immutable tagged package metadata; the CLI version itself is not the floor.

Historical stable alignment verifies the registry version/source and downloaded
tarball integrity, immutable tag and tagged local-components manifest, R2 binary
identity, and active Core projection. It reports historical non-portable npm
dependencies without treating them as a new candidate packaging failure. Missing
or unreadable registry evidence still fails. New CLI publication retains every
strict portability, clean consumer, native SQLite, retained-tarball hash and
published-byte verification gate, entirely in the official GitHub OIDC lane.

The exact Stage A incident from run `35752925516`, attempt 1, has one reviewed
reconciliation-only entrypoint:

```sh
node /path/to/current-main-control/scripts/release/core-receiver-reconciliation.mjs \
  --release-source /path/to/clean-product-checkout
```

The product checkout must remain at
`567c820e470de965b4ba5e3ab303fd02340e5ca8`. Add `--verify-only` to inspect the
evidence before merging the control change; that mode writes no release evidence.
The writing mode requires clean current-main control and the existing Core lease.
It independently verifies the original failed run/job, admitted startup artifact
and its pinned digest, immutable `v0.3.217` tag/manifest, and exact active Core
deployment `297033ac-2c4f-4e28-807d-70e4145fc965` with version
`b7a853b8-b272-436c-bce9-084645846f3b` at 100% traffic and the old projection.
Any replacement or intervening deployment refuses reconciliation.

The earlier local failed/unknown Core receipt is also retained. Its exact source
was subsequently completed by official CLI Release run `35528171693`; that run
must independently verify before the old receipt can be superseded. The new
canonical receipt uses `proof=reconciled-hosted` and links an immutable schema 5
provenance commit as its second Git parent. Its first parent preserves the prior
receipt. The reconciliation attempt starts when reconciliation runs, not when
Stage A ran. It records the original run, control, artifact, deployment time and
superseded receipt explicitly; it never claims the old runner wrote a receipt.
Alignment failure retains applied/failed evidence; retry reuses that same
reconciliation attempt. This command cannot upload or deploy a Cloudflare Worker.
After completion, rerun release status and CLI stage admission before publication.

For the specific Remote Agent Worker-first/container-image failure, current-main
tooling provides `release:recover:remote-agent-partial`. It requires the clean
original release source, the retained failed attempt and its start event, the
original operation key, and exact Cloudflare Worker/container selectors. Under
the existing Remote Agent lease, it checks that one Worker deployment appeared
inside the failed command window while the old container image remained active.
That observation does not prove the first Worker's source. The command runs the
normal Remote Agent deploy from the original source. It resolves the new image
tag through Cloudflare's registry manifest to an immutable digest and requires
the container application to report that digest, a newer version, no active
rollout, healthy aggregate counts and complete instance pagination without an
active old version. It rechecks the new command-correlated Worker afterward.
Only then does it append a version 3 verified receipt for the original attempt.
The receipt's first parent retains the original failed event; its second parent
is a version 4 recovery proof with the baseline and completion observations.
Old release tooling continues to read the version 3 receipt. On failure, the
canonical receipt remains `failed/unknown`; a linked diagnostic proof records
the observed Worker and container state when Cloudflare can be read. Further
recovery remains blocked for manual reconciliation. Aggregate health and an
idle instance list do not prove that every dormant instance ran the new image;
authenticated product Smoke remains a separate acceptance step.
Version 1 successes and version 2 observations remain readable at their original
evidence strength; they are not upgraded into correlated identities. Older
writers cannot downgrade a retained record. All events remain append-only with
atomic compare-and-swap, and new completion writes retain the original source,
operation key, attempt and exact applied identity. Database receipts retain
`release-source` evidence; uncertain DB application is never replayed blindly.
Use current-main release tooling; old control checkouts are not certified to
interpret version 3.

`release:status` pages relevant workflows and job attempts rather than
filtering an all-workflow 250-run window. It reads newer runs first and stops
opening older jobs once every scope has a successful receipt newer than those
runs' last update. Active runs and runs without a valid update time are always read. It compares
actual job completion times, never workflow creation order. A missing source,
invalid completion time, ambiguous tie, API failure, or safety-bound truncation
in the inspected range remains explicit uncertainty; it cannot silently make
the affected component current. The report does not claim to audit jobs older
than every scope's selected deployment. Each component's source impact is
computed independently of whole-train ordering. Unreadable source impact remains
an explicit per-component `unknown`; a genuine current-change planning
conflict still blocks. JSON and human output retain both scoped and global
blockers. This is a projection of available recorded deployments, not an
independent live-production acceptance check.

Verified component receipts remain valid when historical Worker contracts no
longer compose into one deployment plan. Status retains each receipt and its
source impact, compatibility dependencies, and receiver witnesses; it does not
grant deployment permission. Plan and stage admission still enforce safe order,
including a verified compatible Core receiver before Remote. The database stage
still checks live pending migrations and the committed schema before applying
anything. Missing, conflicting, or unverified receipts remain unknown.

Receiver witnesses cover named contracts, not a whole receiver/producer pair.
The dependency owner retains every triggered contract before projecting the
deployment graph. A pending receiver needs matching, source-bound evidence for
each contract, including contracts without an available witness. AI usage can
reuse a verified Core deployment only when its complete receiver owners,
entrypoint registration, production binding and dependency resolutions remain
unchanged. Its Core, DB and schemas TypeScript configurations must retain the
existing shared parent, without further inheritance, and their complete
configuration contents must match. This conservative proof rejects unrelated
schema or entrypoint edits too; it does not certify a combined feature rollout
or remove receiver-first dependencies. Missing contract metadata cannot admit
a pending receiver.

The baseline is component-specific. Each scope starts from its latest verified
deployment receipt or legacy hosted deployment evidence, so Database, CLI,
Workers, and Web may legitimately be at different release sources such as R,
R2, and R3. The latest CLI tag is only CLI publication evidence; it is never a
fleet production baseline. Status reports each component's source, platform
version when recorded, artifact or deployment identity when recorded, and
result. Unavailable legacy fields remain explicit instead of being inferred
from another component. Current Worker receipts retain deployment and version
IDs. Current CLI receipts retain the published version, tag, npm package, and
verified binary manifest artifact hash. A GitHub workflow URL and the guarded
receipt commit are reported separately; neither is labeled as the deployed
artifact. Desktop remains owned by its promoted channel pointer, whose manifest
already records the release source, app version, candidate hash, and signed
artifact metadata.

When the merge commit has no push workflow check, status resolves the one
merged main pull request and requires its exact head, base, and tree to match a
successful `OpenMeld Final Candidate` status. A missing, ambiguous, conflicted,
or tree-changing merge is a source-validation blocker; an operator note cannot
substitute for that correlation.

`--deployed` remains a one-run diagnostic override for historical releases that
predate these refs. It is not the normal completion path:

```sh
pnpm run release:status -- --ref origin/main \
  --deployed web=<exact-deployed-commit>
```

Repeat `--deployed` for multiple historical scopes. The command accepts an
override only when that commit is an ancestor of the selected ref and never
persists the override.

When closing one exact merged change, also pass its exact merge parent:

```sh
pnpm run release:status -- \
  --ref <exact-merge-sha> \
  --change-base <exact-merge-parent-sha>
```

The result keeps two facts separate:

- `Current-change scopes` are the scopes selected by that exact diff.
- `Global pending scopes` are older or unrelated deployment backlog visible in
  GitHub history.

The workflow mapping uses the current-change scopes when `--change-base` is
present. Without it, the mapping is explicitly global-backlog information.
Neither form authorizes a release or expands the responsible agent's business
scope; it prevents an unrelated historical backlog from looking like work this
merge must deploy. Missing deployment history blocks the current delivery only
when it belongs to a current-change scope; the same missing fact remains visible
under the global backlog without changing the scoped command's exit result.

## Public Docs releases

Docs-only releases use `--scope docs`, an independent artifact receipt and
snapshot, and the `openmeld-docs-prod` Worker at `docs.openmeld.ai`. The hosted
job restores only its immutable same-run Docs snapshot. Root and `/docs` HTML
must match the admitted source and build identity. First publication is pending
only when the last successful Web source predates `clients/docs`; unexplained
missing history after that boundary blocks release. Docs needs no App session,
database migration, or local-component publication. Its custom domain is
attached by the guarded Worker deployment. See [Public Documentation](../clients/docs.md)
for content and renderer ownership.

## Website/App origin migration

Normal Website-only releases use `--scope website`, an independent artifact
receipt and snapshot, the `openmeld-website-prod` Worker, and public-page SSR
health. Web health checks `app.openmeld.ai`, including anonymous root entry.
The hosted Website job restores only its immutable same-run Website snapshot;
it never restores Web bytes into the Website directory. First publication is
pending only when the last successful Web source predates `clients/website`.
Missing Website history after that boundary remains unknown and blocks release.

The initial root-domain transfer is an explicit local guarded sequence, not a
`cloud` or `full` rollout. Use a clean, reviewed main source and the ordinary
local production credentials. Keep one evidence file for that source/account:

```sh
pnpm release:deploy:local -- --scope auth,web,website --domain-phase prepare --domain-evidence /absolute/path/domain-evidence.json
pnpm release:deploy:local -- --scope auth --domain-evidence /absolute/path/domain-evidence.json
# Complete the real browser checks below and record their exact version IDs.
pnpm release:deploy:local -- --scope website --domain-evidence /absolute/path/domain-evidence.json
# Only after root cutover succeeds: publish the reviewed Web/Core/Gateway scopes.
```

Preparation records the root owner, zone, Cloudflare environment and current
Web/Auth/Website deployment IDs before mutation. It attaches `app.openmeld.ai`
to the currently deployed Web Worker without replacing that version, and creates
only a missing route-free Website placeholder through the existing bootstrap
owner. A rerun reads current state and never overwrites an existing Worker.
Auth then admits both exact origins while preserving parent cookie and Passkey
RP identities. No sibling-origin wildcard is permitted.

Before Website may take the root, the **currently deployed** Web and Auth versions
must pass real HTTPS App login, existing-session reuse, Space read/write, and
sign-out. Resolve unsent drafts and old tabs. Record their version IDs, the true
check results and the evidence location in `appSmoke` using
`websiteDomainMigrationSchema`. An alias or HTTP 200 is not browser acceptance.
If the existing Web version fails at the new host, stop and ship a separately
reviewed compatible receiver; never redirect the root first. Provider dashboard
registrations, actual consent, existing Passkeys and installed native clients
have their own acceptance rows and must not be inferred from localhost smoke.

The guarded domain phase and evidence-bearing stages acquire the existing
Auth/Web/Website cross-machine leases. Unexpected owners stop. Normal first Web,
Core or Gateway publication is rejected while Web still owns the root. Website
cutover reads bindings and endpoint responses back; it retains the actual
observed deployment even after a later health failure. Component release
receipts remain the deployment authority. Domain evidence describes ownership
and rollback context, not a parallel component publication ledger.

For rollback, keep the same source and evidence file:

```sh
pnpm release:deploy:local -- --scope auth,web,website --domain-phase rollback --domain-evidence /absolute/path/domain-evidence.json
```

The guard refuses an intervening unrecorded Web version, restores the recorded
previous Web version first, then restores root ownership while retaining the
App alias. Both exact Auth origins stay admitted until App traffic is retired;
Auth contraction is a later explicit change. Rollback checks source/environment
contracts but does not require rebuilding a broken candidate renderer. It
verifies ownership and endpoint responses after restoration.

Cloudflare Domains PUT can attach an unbound host but returns 409 for an existing
Worker owner. Takeover uses Wrangler's public deploy/`triggers deploy` behavior,
not copied private Cloudflare endpoints. The triggers command changes routing
without uploading Worker code. Isolated HTTPS transfer and reverse-transfer
checks prove the observed states, not an atomic zero-interruption guarantee.
Keep `307`/`no-store` redirects and the bounded legacy browser forwarding window
from [Website](../clients/website.md) until acceptance completes.

Before preparation, record a direct `200 application/json` read of
`https://openmeld.ai/.well-known/posthog-client.json` and its unchanged client ID
and Connector redirect. The recorded previous Web version still contains this
public file. The new Web source removes it only after Website has taken the root;
the guard above forbids publishing that new Web while Web still owns the root.
Rollback restores the exact recorded previous Web version before transferring
the root back. Cutover and rollback endpoint checks reject a redirect, HTML, or
changed PostHog client identity/callback. Never restore the new App-only Web
version at the root or assume a successful homepage proves this OAuth dependency.

Before replacing old Web assets, save unsent text and attachment drafts, finish
or restart in-flight authorization, and close old tabs. Verify the old installed
standalone app shows the migration entry; install the new App from its browser
origin. Check browser notifications again there. Host-only protected-Space cookies
may require entering the Space password again. Neither cache forwarding nor a
parent Auth cookie migrates browser storage, PWA identity, or notification grants.

## Release Scopes

The local release tool accepts these direct scopes:

```text
db
web
website
docs
gateway
auth
core
remote-agent
cli
```

It also accepts comma-separated scopes, `cloud`, and `full`.

- `cloud` means Auth, Web, Gateway, Core, Remote Agent, Website, then Docs.
- `full` means Database followed by `cloud`.
- `full` never publishes CLI. CLI is immutable publication and must always be
  selected explicitly.
- Selecting `cli` owns its required Core projection; adding `core` does not
  deploy Core twice.

`auto` is the default local plan. It follows changed runtime-capable workspace
dependencies and local-component release paths, so it intentionally prefers a
safe superset for shared package changes. Development-only dependencies do not
expand production release scope. Review the plan. An operator may narrow it
with an explicit scope only when the changed contract and mixed-version behavior
prove that narrower rollout is safe.

Inbox notification observations add Core -> Gateway -> Web compatibility
dependencies when the shared Inbox schema and Web observation caller change
together. A Core observation storage edit does not establish a changed caller
contract. The existing dependency scheduler composes these edges with other
contracts, including Remote Agent -> Core, and rejects cycles. Automatic scope
selection includes all three components; a separate caller stage requires a
verified receiver receipt. This additive observation API has the opposite
direction from the older Core-written Inbox source-target contract below; do
not infer one from the shared schema path alone. Desktop promotion retains its
existing cloud-first gate.

The planner selects the `remote-agent-receiver-first` deploy-order profile when
the diff contains one of these explicit Core-to-Remote-Agent receiver owners:

- `services/remote-agent/.flue/cloudflare.ts`
- `services/remote-agent/flue-adapter/cloudflare-entrypoint.ts`
- `services/remote-agent/flue-adapter/execution-reconciliation.ts`

It selects the same profile when a diff expands a strict Remote Agent request
shape—either with a new request version or an additive field—and changes its
explicit shared-schema request owner, Core producer/admission owner, and Remote
Agent Center Agent receiver together. A change to the request-only
`remote-agent-turn-envelope.ts` and Core's `application/turn-envelope.ts` also
establishes this direction. The existing Center Agent imports and parses that
shared strict schema, so its own source file need not change to expand its
receiver contract.

Execution input has requests and responses in one shared file. When
`remote-agent-execution-input.ts`, Core's Space producer, and Remote's
`flue-adapter/execution-input.ts` change together, the planner compares the
actual request/query, shared identity, and receipt/response declarations against
the component receipt baseline. A request-only change requires Remote before
Core. A response-only change requires Core before Remote. An unrelated import
does not establish either direction. Missing history or a change to both sides
requires separate receiver stages; the shared file path alone is insufficient.

Gateway's `lib/openmeld-context.ts` produces Core's strict request context.
A changed `openMeldRequestContextSchema` declaration in `profile-identity.ts`
therefore requires Core before Gateway. Other declarations in that file do not
establish this dependency. The planner requires readable schema history for
this owner pair. Optional Web/CLI time headers remain independent: the old
Gateway can ignore them without rejecting a request.

Within the selected scopes it deploys Database, Remote Agent, Auth, Core,
Gateway, Web, then CLI. This installs strict Remote Agent RPC receivers before
Core callers and keeps a selected CLI unpublished until every cloud receiver is
ready. The dependency graph also contains Remote Agent -> CLI for a strict
request rollout. CLI publication deploys its candidate Core release projection,
which activates the new Core request producer. Stage admission must block that
CLI stage while Remote is pending, even if an earlier Core receipt exists. The
early Core stage preserves the current published CLI projection. This edge
comes from the Core deployment in CLI publication, not from optional headers.
Other shared schemas and Core's native-delivery service are not directional
path signals because they carry contracts in both directions.

This profile also preserves that projection when CLI is excluded from the
cloud stage. Preflight and verification leave published-channel checks to the
same current-projection owner, instead of requiring the candidate CLI to exist
first. With PostgreSQL, use the guarded local cloud stage, then the official
GitHub CLI workflow after its receiver receipts are verified. Keep the same
release source, pre-feature base and complete train declaration across stages.

Personal cloud Computer has the opposite capability direction: its Remote
Agent requires Core's account Computer identity response. The planner selects
`personal-cloud-computer-receivers-first` only after comparing the actual
component receipt baseline with the candidate. Existing native request schemas,
Core request producers and strict Remote receivers must be unchanged; the two
changed Remote entry owners may contain only the reviewed additive Computer RPC
and hosted Computer initialization changes. Missing history or any other owner
change blocks this classification. This proof removes only the misleading
Remote-first path signal; it is not a release override.

The guarded stages are Database/Auth, Core, Remote Agent/Gateway/Web, then CLI.
Database must precede Core's new table reads. Remote's stage requires a verified
Core receiver, and Gateway's new public route waits for Remote's Computer RPC.
The early Core stage keeps the currently published CLI projection. CLI
publication waits for Database, Auth, Core, Remote and Gateway receipts; hosted
CLI also checks the exact PostgreSQL schema/journal contract in Database, Auth
and Core receipts. Web may share the third stage and does not create a new
Computer protocol dependency. Declare the same complete train at every stage;
do not use a different base or a raw deploy to evade a pending receiver.

Remote AI usage adds the opposite dependency: Core's `recordRemoteAiUsage`
receiver precedes its Remote producer when the shared AI usage schema or Remote
producer changes. A Core receiver-only edit does not establish that a new Remote
producer contract exists. Likewise, Center Agent context-manifest ordering uses
the explicit Core context projection owner, not a filename substring matching its
private persistence repository. `compatibilityPathSignals` explains these two
classifications, including matched paths and relevant non-trigger paths. These
source signals do not certify a deployed receiver or authorize a breaking
receiver-only change.

Center Agent working-folder writes have their own `center-agent-safe-workspace`
Core-to-Remote obligation. Direct RPC registration, implementation or caller
owner edits inspect the explicit product source's Remote tools for the required
`centerAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace` receiver.
An unreadable or unspecified product source conservatively retains the
obligation; a known legacy caller without that receiver does not trigger it.
This bounded name check only registers an obligation. It supplies no receiver
witness, and an AI usage witness cannot satisfy it. Core must have a verified
current receipt before the new Remote caller deploys. The release-control
checkout's caller source is never used as product evidence. The legacy Core
receiver rejects folder writes before any settings mutation during this
transition; model-only calls continue to use the legacy receiver.

Agent Profile setup and folder recovery retain separate obligations:
`agent-profile-default-project-revision` requires Database before Auth's new
revision-column reads and writes; an older verified PostgreSQL binding does not
prove that column exists. `agent-profile-default-project-initializer` requires
Auth's named initializer before Core calls it. `agent-profile-binding-precondition`
requires Core's named bound-write receivers before Gateway and Gateway's strict
`expectedBindingTarget` input before Web. A missing method or unsupported input
must not be downgraded to an unguarded setter.

`profile-workspace-initialize` requires Core before a Service publishes the
strict `initializeProfileWorkspace` registration or heartbeat key. It applies
to a caller-only change as well as the original combined schema/receiver change.
It is separate from `local-service-runtime`, `profile-workspace-read` and the
Auth-to-Core `agent-profile-default-project-initializer`; one witness cannot
substitute for another contract on the same service pair. Core checks Service
support before sending `onlyIfUnconfigured`, so an older Service gets an
update-required refusal before that input is sent. This adds no reverse edge.

`profile-workspace-read` requires Core before a Service publishes the
`readProfileWorkspace` capability in registration or heartbeat, Core's named
`getCurrentAgentProfileWorkspace` and `getPeopleComputerAgentProfileWorkspace`
receivers before Gateway, then Gateway's GET routes before Web calls them.
The optional capability is inside a strict object: older Core receivers reject
the new key. An unchanged folder-write or runtime witness cannot prove this
read contract. Names in the explicit target source only register obligations;
unreadable source retains them and supplies no compatibility witness.
The earlier `initializeProfileWorkspace` capability remains a separate strict
input. Read evidence cannot replace its runtime obligation, or vice versa.

Core negotiates this read against the connected Service capability before
sending `daemon.local_agent_control.read_profile_workspace`. An older Service
therefore returns the update-required refusal without receiving the new frame;
it does not require a Service-before-Core edge. Publish the new Service before
the new Web settings flow when practical so its update action has an available
artifact. Older installed Services still need their normal account-checked
upgrade. This ordering does not establish their upgrade or native acceptance.

`cloud-command-receipt-opt-in` requires Core and Remote Agent before Gateway
accepts command references or detailed lists, then Gateway before the CLI caller.
Core relays these fields only after a Gateway request; it does not introduce
them itself. Ordinary lists retain the legacy shape and single-command replies
remain extensible. This permits a Core receiver stage while the old Gateway
still rejects new opt-in inputs. Recheck the actual caller chain on the final
source: these source and parser facts are not mixed-version Worker smoke.

Each obligation is registered from its bounded changed owners and the explicit
product source, including caller-only changes. Known historical sources without
the feature stay independent; an unreadable source retains the obligation. The
name checks supply no compatibility witness. Pending or unresolved receivers
cannot be satisfied by an older contract's witness on the same service pair.

The planner composes the metering edge with the
request dependencies and rejects an unresolved cycle, including a single-stage
guard that tries to skip a pending receiver. It must not report a safe train by
choosing only one side of that cycle.
Selecting Core and Remote together does not satisfy this prerequisite: Remote's
stage requires a verified Core deployment receipt whose source satisfies the
receiver contract. Failed/applied, unknown, or merely planned Core is not ready.
Complete the guarded Core stage first and rerun stage admission before Remote.

The P0 bridge from the actually published `e4454cf165b96c7f918e420f28205c2b2ed3c575`
receiver is a bounded exception to the request-receiver-first edge. Core probes
optional task attribution before freezing new requests; existing summary
capability gates and frozen-request replay remain unchanged. The planner checks
that exact baseline and the reviewed source digest of all listed request owners
in `scripts/release/remote-agent-request-compatibility.mjs`. Unknown baselines,
unreadable source, or any changed owner preserve the dependency and block a
cycle. This witness does not waive the separate imported turn-envelope or
execution-input producer dependencies, or Core's Gateway request-context
receiver dependency. Never update the digest merely to pass a gate: repeat the
published-schema and mixed-version audit. `compatibilityBridges` in plan/status
records the exact source witness; Core metering and Web/Gateway result-reader
edges remain intact.

For this bridge, retain the completed compatible Web readers and additive DB
migrations, deploy Core and verify its readers/usage receiver, record that exact
Core deployment as the forward-fix anchor, install the pinned Connector overlay,
then deploy Remote. Confirm Wake, Stop, final Space publication, and usage outbox
delivery before continuing the remaining release components. Reverse order is
unsupported: a missing metering receiver fails before any new model call, with
the method name and `core.rpc.unavailable` diagnostic. Existing audit receipts
and real settlements remain available for idempotent backfill. New admissions
cannot bypass allowance checks, including after a downgrade or for a new owner.
No production smoke is implied by local bridge tests.

Before Remote upgrades, Core can return to the previous release only if no
summary recovery intent has been persisted and no other new durable contract
requires its reader. Once Remote accepts frozen task-attributed requests, retain
its compatible receiver while those requests can replay; use a forward fix for
an incompatible runtime failure. Once `summaryRecoveryIntent` exists, never
return to the old Core or erase/rewrite the intent. Preserve the compatible Core
anchor and forward-fix. Pending usage settlements and deferred audits survive
either component's forward repair; never rerun inference to reconstruct them.

When a diff changes the worker schema, native-delivery service, and Center
Agent receiver together without a recognized directional request owner, the
planner rejects a combined Core/CLI and Remote Agent release. Review the actual
contract direction and use explicitly ordered single-side stages. This prevents
request-only recovery fields from being mistaken for response-only changes;
adding the bidirectional service to a request allowlist would reverse the bug
for response changes.

The reviewed addition of only `remote_agent.provider.connection_missing` to
the worker-response reason codes is a narrow exception to that ambiguity. It
does not change a request envelope or Core request producer. When this is the
exact schema diff, the planner retains the response-reader dependency and
deploys Core before Remote Agent. A second schema edit or a changed request
producer remains blocked for separate direction review. The Center Agent's
Organization Skills catalog RPC in the same release also has a Core receiver,
so it follows that Core-first order.

The strict version-4 Center Agent conversation contract is such a request-side
change. Apply its PostgreSQL generation-pointer migration first, deploy Remote Agent so
it accepts version 4, and deploy Core last so it begins producing version 4.
This request-receiver-first requirement takes precedence if the same diff also
changes the strict worker response union; otherwise Core could deploy first and
send an envelope that the active Remote Agent rejects before execution.

The planner selects the `core-worker-response-reader-first` profile when the
strict Remote Agent worker-response schema and its Remote Agent producer change
in the same diff. Within the selected scopes it deploys Database, Auth, Core,
Gateway, Web, Remote Agent, then CLI. Gateway and Web activity readers also
precede the runtime so a coordinated release can add activity outcomes without
emitting them to older readers. Core must accept the expanded strict
response union before Remote Agent can emit it; otherwise an old Core treats a
valid new rejection as a protocol error. The schema path alone remains
non-directional, so request-only changes do not accidentally select this
profile. This response-reader requirement takes precedence when the same diff
also contains Center Agent Task or Context Manifest paths.

Space search and evidence receivers compose with this Core-first profile.
An exact entrypoint-only replacement of the Cloudflare `WorkspaceProxy`
re-export with the local proxy does not change native request admission and
does not impose Remote-before-Core ordering. Any other entrypoint edit retains
the ordinary request dependency. Independent Website and Docs source-impact
checks do not apply historical App protocol constraints to their publications.

The hosted public-progress bridge is a narrow reviewed exception: if the
versioned worker schema differs only by its output-limit reason constant and
the additive progress callback kind, and the target Remote Agent contains the
old-Core rejection fallback, the planner does not invent a strict worker
*response* change from that shared file path. It keeps the real Remote Agent
request receiver-first dependency. Any other schema edit, missing historical
content, or missing fallback retains the conservative response dependency.
For this bridge, deploy Remote Agent before Core; an older Core can reject a
public progress update while the agent still streams text and publishes its
final reply. The new Core reader then enables the progress update.

The planner selects the `center-agent-cli-receiver-first` profile when the diff
contains a Center Agent Task or Context Manifest contract path. Within the
selected scopes it deploys Database, Remote Agent, Auth, Core, Gateway, Web, and
finally CLI. Remote Agent comes before Core because an old strict Remote Agent
rejects the Context Scope Plan fields emitted by new Core. Every old caller
continues working while each additive receiver comes online, and only the final
CLI publication can expose the new command.

The planner selects `connect-computer-cli-receiver-first` when one diff changes
the shared Better Auth Device Authorization contract, the CLI command receiver,
and the Web setup-command producer. It automatically includes both CLI and Web
and rejects an explicit release that omits either side. Within selected scopes,
Database and Auth may run first, then the guarded CLI stage publishes the CLI
and deploys its Core current-channel projection before Web can emit
`--device-code`. Gateway and Remote Agent follow only when the same release
actually includes them. When Core is selected, the CLI-owned projection deploy
also carries the exact Core source, so the planner does not deploy Core a second
time or run the CLI-last profile's temporary current-version projection stage.
This order protects users who copy a newly generated command from receiving
syntax that the production CLI cannot parse.

Receiver-first constraints compose across one diff; the planner must never pick
the first matching profile and silently discard the rest. A Remote Agent request
receiver deploys before the Connect Computer CLI/Core receiver, while a Core
worker-response reader is satisfied by that same CLI-owned Core projection
before its Remote Agent producer. Constraints that require the same component
on opposite sides of another deployment fail closed and require separate
releases. This includes Connect Computer combined with Inbox source-target,
Local Service runtime, or Center Agent CLI receiver-first contracts.

Space image geometry uses capability projection at both strict public
boundaries. Core preserves canonical stored geometry, but omits it unless the
Gateway caller declares image-geometry support. Gateway declares support to
Core and omits geometry unless the Web or CLI caller independently declares the
HTTP capability. New callers against old receivers therefore continue to get
the legacy shape, and new receivers keep old callers on that shape. The image
capability is independent of the Space Files origin capability. Remote Agent
RPC responses continue to omit unused display geometry, and native submit-turn
attachments omit it before request persistence.

These public-boundary projections remove the geometry-only reader-first
dependency. They do not certify rolling Core back below the projection bridge
after richer canonical records exist. Image geometry does not select a
deploy-order profile, but its changed-path detector still selects Web, Gateway,
CLI, and Core for an automatic plan so the complete feature is not accidentally
omitted from the release.

The one- and two-character Space message-search contract is directional. The
shared query schema, Core short-query implementation, Gateway receiver, and Web
caller together select `space-message-search-receivers-first`: Core deploys
before Gateway, and Gateway before Web. Old Web does not send short queries, so
the new receivers are dormant until the new caller deploys. An explicit plan
that selects the Web caller without both receivers fails closed.

The evidence schema family, Core private entrypoint, and Remote Agent tool caller
together select `center-agent-evidence-receivers-first`: Core must precede Remote
Agent. Combined with Space message search this becomes
`space-message-search-and-evidence-receivers-first`: Database and independent
Auth work first when selected, then the signed CLI release with its matching
Core projection, Gateway, Web, and Remote Agent. The capability bridge makes the
new CLI safe against the old Gateway and makes the new Core safe against the old
Gateway, so the normal guarded CLI stage preserves the existing local-component
and execution-epoch floors without adding a geometry-only hard cut. A cloud-only
stage that intentionally excludes CLI deploys Core directly before Gateway and
Web.

Schema-only edits do not establish either directional contract. Explicit plans
missing required receivers fail closed; incompatible existing
profiles fail instead of overriding a direction. Generic hosted `cloud`/`full`
still has a different static order and is rejected before mutation for this
profile. Use the guarded ordered plan anchored to one SHA, verify each stage,
and keep the original pre-feature base throughout. A single-side plan does not
certify that an earlier receiver stage has already deployed.

The planner selects `wake-progress-opt-in-receivers-first` only when one diff
changes the shared Wake Progress schema, its Core producer, and the CLI caller
that explicitly opts into the additive wait-reason field. It automatically
includes Gateway and Core, and an explicit scope that would publish Core or CLI
without both scopes fails closed. Within the selected scopes, Gateway deploys
before Core, and Core deploys before CLI. Web may deploy first because the new
query flag is optional and an older Gateway safely ignores it.

This detector is intentionally specific to the proven opt-in contract. A path
match cannot infer whether an arbitrary future Space HTTP change adds a strict
request caller or a response producer, and those directions require opposite
receiver-first orders. Future contract families need their own explicit
producer, receiver, and compatibility evidence instead of inheriting this
profile. This constraint composes with compatible Remote Agent request or
worker-response receiver-first orders. If the same diff requires one component
on both sides of another, including any Remote Agent receiver-first family
combined with a worker-response producer, the planner fails closed and requires
separate releases.

The shared Space history query has its own receiver-first profile. When its
schema changes, the automatic plan includes Gateway, Core, and CLI, deploys both
cloud receivers before the CLI caller, and rejects a CLI-only release. A staged
Gateway/Core release remains valid before the CLI publication. Compatible
profiles may choose a different order between Gateway and Core, but both must
still precede CLI.

The `space-task-receivers-first` profile recognizes the Space Task schema,
Core RPC and Space receiver, and a Task caller together. Core deploys with the
immutable current published CLI projection first, followed by Gateway, Web,
Remote Agent, and CLI when selected. CLI and Web call Gateway's Task HTTP
routes; Remote Agent calls Core directly and does not require Gateway.
Every selected consumer requires Core in the plan, and CLI/Web also require
Gateway. Core-only and Core/Gateway receiver stages remain supported without
requiring the future Service fingerprint to match the published channel;
the existing receiver executor verifies the real channel and immutable tag.
Opposing receiver constraints fail closed rather than overriding their order.

Keep the same pre-feature base (for example the previously published CLI tag)
through every stage, including after a version-only PR. A narrow version-PR
diff cannot establish the Task dependency. Use the guarded ordered local
Core/Gateway/Web/CLI plan for the first publication; CLI-only with that base is
rejected. The static hosted fleet admission also rejects a selected order it
cannot execute. No direct receiver script invocation or hash-check bypass is
part of this rollout. The final normal CLI stage publishes artifacts and
updates Core to the new CLI projection after the receivers are healthy.

When any receiver-first profile includes both Core and CLI, the first Core
deploy reads the stable production CLI version, loads that version's
`release/local-components.json` from its immutable `v<version>` Git tag, and
compiles that already-published projection into the new Core receiver. It fails
closed if the channel, tag, or versions disagree. After all receivers are
healthy, the ordinary guarded CLI release publishes the new R2/npm artifacts
and redeploys Core with the checked-in projection. This two-phase Core deploy
prevents both unsafe states: publishing a new CLI before its receivers and
announcing a CLI version before its artifact exists. The temporary projection
is a build-time override, not a second runtime variable or mutable release
ledger. The Connect Computer profile is the explicit opposite direction: Web is
the producer and CLI is the receiver, so its CLI-owned Core projection completes
before Web deploys.

The worker-response reader-first profile also uses the current stable CLI
projection when Core is released alone. This permits a verified Core receiver
stage before Remote Agent and later CLI publication, including the local
PostgreSQL release lane.

Local Service receiver changes keep that same current stable CLI projection
when another compatible contract orders Remote Agent first. Release Remote
Agent, then use the guarded local Core/Gateway/Web stage, and finish with the
GitHub CLI workflow. The aggregate deployment-order profile must not replace
the Service receiver's projection policy.

The planner selects `local-service-runtime-receiver-first` when one diff changes
the strict Runtime Transport schema, a Core Runtime Transport receiver, and a
local OpenMeld Service producer together. Within the selected scopes it deploys
Database, Auth, Web, Gateway, Core, Remote Agent, and finally CLI. When Core and
CLI are both selected, Core first deploys with the current published CLI
projection; only after that receiver is healthy may the signed CLI/Service
release advertise or emit the new strict capability. An explicit scope that
publishes CLI without Core fails closed. This profile is structural and
provider-neutral: it protects any strict Service-to-Core protocol addition
without coupling release order to one Agent Controller or business workflow.

This profile also supports a cloud-only receiver stage before the signed GitHub
CLI release. Selecting Core without CLI uses the same immutable published CLI
projection, with its existing channel and tag checks, instead of requiring the
future CLI bundle to be published first. Keep the pre-feature base in both stage
plans; publish CLI only after the Core receiver is healthy.

The coordinated device-wait schema, Space receiver, and Gateway route select
`device-wait-receivers-first`: Database, Auth, Core, Gateway, Web, Remote Agent,
then CLI. Core must expose `postDeviceWaitingSignal` before Gateway calls it,
and Gateway must accept the opt-in before Web offers Send and wait. This
composes with the Service-to-Core receiver order. Conflicting receiver profiles
fail closed. A staged Core deployment also preserves the already-published CLI
projection until artifact publication completes.

The ordinary `cloud` order installs Auth receivers before Web, then continues
through Gateway, Core, and Remote Agent. A Web-only release still skips Auth;
the dependency only orders coordinated releases. Contracts that require a
different consumer-first direction must keep using their explicit staged scope
or receiver-first profile instead of weakening this default dependency.
The planner reports this ordinary order as `default-auth-receiver-first`, which
names its mixed-version invariant instead of implying that every boundary in
the cloud graph is consumer-first.

The `space-caller-context-receivers-first` profile handles the unified Space
access contract: Database, Auth, Remote Agent, CLI (including Core), Gateway,
then Web. The signed Service must be downloadable before Core raises its
required Service floor and emits caller context. Do not deploy an intermediate
Core with the old CLI projection. Existing clients use the legacy response
projection until the new Gateway and Web are installed. For the hosted lane,
run these explicit scopes in order, using one immutable release SHA; CLI uses
the separate CLI Release workflow. A generic cloud/full dispatch cannot replace
this sequence.

The hosted `cloud` and `full` dispatcher implements one static scope order.
Before any Production mutation it reads each component's actual deployment
baseline and verifies that the hosted order satisfies the trusted planner's
remaining compatibility dependencies. A preferred scheduling order alone does
not block an otherwise compatible train. If the hosted graph would violate a
required receiver/producer dependency, the run fails with that dependency and
the supported order. Use the guarded staged path until that dependency has
reviewed hosted orchestration support. The stable CLI tag is not a fleet
deployment baseline.

### Inbox source-target receiver-first order

Personal Remote Agent shared tools require Core's execution authorization and
Skill preparation receiver before the new Remote tool callers. The
`personal-remote-tools-receivers-first` profile recognizes that schema, Core
authorization owner, and Remote tool owner together. Its order is Auth, Web,
Gateway, Core, Remote Agent (Database first and CLI last when selected). This
also installs Inbox source-target readers before Core's producer. The Remote
entrypoint's browser facet export does not change the incoming request contract.
An actual opposing Remote request receiver change fails closed for a split
rollout; selecting Remote without Core is rejected.

This cloud stage retains the immutable current published CLI projection, using
the same guarded Core receiver deployment as other staged contract rollouts.
The new shared schema also changes the packaged Service fingerprint, so prepare
the base-aware available CLI/Service release separately and publish it through
the signed GitHub CLI lane after the cloud receivers. This preserves current
local clients without advertising an unpublished bundle or bypassing stamping.

Task Inbox retirement reverses the writer/reader dependency. The planner proves
this specific removal from Git: the Task Inbox producer must be deleted, and
the Inbox schema must differ only by removing the Task item kind, source kind,
and target object. Explicit source-SHA plans inspect that immutable tree; local
plans inspect the working candidate against its merge base. A pathname alone
does not establish retirement. Mixed expansion/removal, partial removal, or a
remaining producer fails closed and requires a separate compatibility rollout.

For this retirement, Core must stop returning Task rows before Gateway or Web
stops accepting them. `inbox-task-retirement-producer-first` places Core before
Auth, Gateway, and Web. If the same release requires a Remote request receiver,
`remote-agent-and-inbox-task-retirement-first` orders Database, Remote Agent,
Core, Auth, Gateway, Web, then CLI. Core also precedes the new Auth join-request
caller that requests response version 2. Required Inbox scopes and the combined
Remote scope remain enforced; conflicting receiver orders still require a
split. This rule does not authorize dropping the retained Task tables.

Both retirement profiles deploy Core with the current published CLI projection
even when CLI is excluded from the deployment scope for a later GitHub release.
Verification and preflight do not compare that stage against the checked-in
future CLI projection; the current-projection deployment retains its own
published-channel compatibility checks. The later CLI release publishes the new
artifacts and updates Core's release projection through the normal guarded path.

The planner selects `inbox-source-target-receiver-first` when a diff changes the
strict Inbox source-target schema together with a Core writer for those targets.
The path signal remains conservative. The existing classifier omits this
obligation only when the explicit baseline and candidate sources prove the
same complete target union, direct schema dependencies, actual writers and
storage delegate, its directly called legacy repairs, the actual row mapper
and timestamp helper, target-bearing RPC/HTTP projections, Web interpreter, and
their import/export, production binding and resolver configuration. It supports
only the reviewed pure membership-kind projections, source-guard forwarding,
four retained request-time edits, the unique unread-target query construction,
exact source-read delegation with exclusively bound imports, and the early
code-handoff rejection that forwards the original message to the unchanged
failure and terminal target-effect delegates. The API still compares as a
complete module after the explicit query change; Native delivery still compares
as a complete module after these listed changes. The rejection predicate is
not a receiver compatibility witness, and its parsed output cannot construct
a target. Every other target owner change, unreadable
source, ambiguous declaration or unknown structure retains the original gate.
The item-returning service methods and their factory bindings remain equal;
unrelated membership SQL is outside this target proof. Gateway registrations
must keep their exact route bindings and contain no extra local statements.
This proof does not emit a compatibility witness. In particular, the separate
`inbox-membership-opt-in` Core-before-Gateway obligation still requires its own
receiver admission; another witness for that service pair cannot satisfy it.
The independent `visible-source-read` obligation deploys Core before Gateway,
then Gateway before Web. New callers can send `read_sources` and request
`includeSourceKeys`; the old strict receivers reject these requests. The
classifier reads the explicit product caller from the selected source SHA,
including caller-only increments. A known older caller has no new obligation;
missing or unreadable source retains it. Naming these requests registers the
obligation only. It creates no receiver witness, does not prove the durable
source-target contract, and cannot replace membership opt-in evidence on the
same service pair.

The source-target cloud stage, including the combined Remote receiver profile, deploys Core
through the existing current-published-CLI projection owner. That owner verifies
the immutable published npm/R2 identity and required floor before activation,
then verifies Core alignment before completing its receipt. The candidate's
unpublished CLI manifest is not exposed to installed clients. CLI publication
can follow as a separate guarded stage; source, artifact, lease, and receipt
admission still apply to each stage.
The writer inventory includes Message Channel terminal-delivery projection and
RuntimeCoordinator Agent Interaction projection. It automatically includes Web,
Gateway, and Core, and rejects a manually narrowed scope that omits any of those
components. Within the selected scopes, Web deploys and passes health first,
Gateway deploys and passes health next, and Core deploys last. When the Message
Channel repair migration is selected, Database migration `0128_massive_blur`
applies before those receivers. Its nullable last-attempt field does not start
new writes under old Core. If the shared schema also selects a local-component
release, the existing receiver-first CLI mechanism keeps immutable CLI
publication last and uses the current production CLI projection for the first
Core deploy.

If the same release also changes a strict Remote Agent request receiver, the
planner composes both constraints as
`remote-agent-and-inbox-receivers-first`: Remote Agent, Web, and Gateway all
deploy and pass health before Core, and an explicit scope that omits Remote
Agent fails closed. If it instead changes a strict Remote Agent response
producer, the Inbox profile already places Web and Gateway before Core and Core
before Remote Agent. A compound release never silently discards one
receiver-first dependency in favor of another profile name.

The strict persisted-row readers are Core's PostgreSQL-to-Inbox mapper and RPC response,
Gateway's response boundary, and the Web API client. Core is also the only
writer. The receiver-first window is therefore safe in both directions: the new
Web and Gateway continue accepting old Core responses, then the new Core writes
rows that every deployed reader accepts. Source-target version `4` receives the
current thread-aware Agent Interaction target. Version `3` receives the same
target without its thread locator, and missing or older headers receive the
legacy target projection. Gateway applies those projections after validating
Core's complete response for list, direct-item, and read-mutation operations, so
items, counts, and cursors stay aligned. SQL-only Inbox filters and urgent-email
delivery do not deserialize `source_target_json`; Remote Agent and CLI do not
read these rows and are not additional runtime receiver stages. CLI remains a
release scope when the shared schema changes because that package feeds the
immutable OpenMeld Service bundle. After Core is active, Message Channel repair
upgrades pre-release Slack targets in place while preserving item id, read time,
action resolution, and dismissal. RuntimeCoordinator repair records preserve an
absent legacy thread locator rather than manufacturing main-timeline identity.

Rollback is forward-only at the reader boundary. First stop new writes with a
Core change that retains the new schema. Keep the compatible Core, Gateway, and
Web readers deployed because already-written rows remain durable. Do not deploy
an old reader, manually rewrite PostgreSQL, or delete Inbox rows as a rollback shortcut.
A full reader rollback is permitted only after an explicit migration or
retention process verifies that no persisted `message_channel` target remains.
The additive nullable migration remains applied during rollback.

### Organization Skills first-launch order

The first Organization Skills release is a consumer-first exception to the
ordinary `cloud` component order. The new Core producer includes the optional
Organization Skill release selection in strict Remote Agent turn envelopes; an
old Remote Agent rejects that envelope instead of ignoring the field. The new
Remote Agent can also emit Organization Skill work-activity keys that an old
Web stream reader does not accept.

From the same approved immutable SHA:

1. deploy `web` alone so it accepts the new work-activity keys;
2. deploy `remote-agent` alone and verify its active production version;
3. run the normal `full` release so PostgreSQL migrations apply before Web, Gateway,
   Auth, Core, and the idempotent final Remote Agent deploy;
4. publish `cli` only after the new Core Organization Skills API is active; and
5. run the authenticated Web, Center Agent, runtime activation, and published
   CLI smoke from `developing/product/organization-skills.md`.

Do not allow Core to emit Organization Skill selections before step 2 completes.
Rollback reverses the strict contract boundary: restore the previous Core
producer first so it stops emitting the field, then restore the previous Remote
Agent, and only then restore the previous Web. The additive PostgreSQL tables and
immutable R2 release objects remain in place while Web and CLI compatibility is
assessed; do not delete them as a rollback shortcut.

### CLI compressed and delta transport first-launch order

The first compressed CLI release is a consumer-first Web rollout. The existing
production manifest route validates and reserializes R2 metadata, so an older
Web deployment removes archive fields it does not know. From the same approved
immutable SHA:

1. deploy `web` first; with the old manifest it continues serving and
   downloading the verified raw executable;
2. publish `cli` with the binary channel so R2 receives the raw executable,
   gzip archive, and any exact-base delta before the manifest advertises them;
   and
3. verify the public manifest exposes the complete archive and delta records,
   then run the published setup and upgrade smokes.

After this first rollout, ordinary CLI-only releases may use the normal CLI
lane. Old CLI clients ignore the additive archive fields and keep using the raw
URL. Rolling Web back temporarily removes the archive projection and returns
all clients to the verified raw fallback; it does not make setup or upgrades
unsafe. Old clients also ignore additive delta and signing-identity fields.

### Space invitation receivers before new clients

The first Space invitation release requires Database, Core, then Auth before
the new CLI command or Web invitation entry points become available. Auth calls
the new Core RPC; publishing CLI first would expose a command whose Auth
endpoint does not yet exist.

Invitation approval rollout has a first-release precondition: before new Core
is active against old Auth, there must be no existing join requests or their
Inbox projections. The only public producers call `organizationJoinRequest`
from the new Auth `/organization/join-requests` and `/organization/join-link/request`
routes; old Auth has neither producer. Core does not create requests on startup
or migrate existing invitations into requests. Core reuses existing Auth identity
and directory RPCs; native invitation delivery remains Auth-owned.

After the additive migrations, the release owner must verify both counts are
zero through the authorized read-only production PostgreSQL diagnostic path:

```sql
SELECT count(*) AS join_requests FROM organization_join_requests;
SELECT count(*) AS review_items FROM inbox_items
WHERE json_extract(source_target_json, '$.kind') = 'organization_join_request';
```

Old Auth strictly rejects the new review-email `purpose` and `invitationRequestId`
fields with a non-retryable validation error. Therefore the first-release order
is not a safe Auth-only rollback after requests exist. Keep compatible Auth in
place during recovery; do not rely on mail retries or restore bearer enrollment.

Legacy organization link get/create responses keep their original strict shape.
Space-scoped management requests explicitly select Space scope. Link preview
exposes Space context only with `responseVersion=2`, which new Web sends after
Auth is updated. Old clients can still read links, but legacy nonmember accept
intentionally fails closed; update Web promptly so recipients can request approval.

When the shared invitation schema, Core owner, and Auth route change together,
`space-invitation-receivers-first` orders Database, Core, Auth, Gateway, Web,
Remote Agent, then CLI. It rejects Auth or CLI selection without both receivers,
and composes with `local-service-runtime-receiver-first`: Core accepts the new
Service capability before CLI publication, while Core and Gateway also precede
new Web callers. The independent Skill bridge additionally requires its public
Web content before CLI publication. Other directional profiles still fail
closed; in particular a Core writer requiring new Inbox readers cannot use this
Core-first order. Ordinary Core-only deployments retain their channel
compatibility guard.

For the signed GitHub CLI lane, use the same approved main SHA for both stages:
first run guarded local `release:deploy:local -- --scope db,core,auth --base
<previous-production-sha>`. This profile deploys Core with the immutable current
stable CLI projection, verified by the existing receiver deployment helper;
it does not advertise the future CLI version. Then run the normal GitHub CLI
release, which publishes the new artifact and its Core projection. Deploy the
remaining affected scopes afterward. When the same release includes the
independent Skill bridge, include Gateway and Web in the first guarded local
stage so its public content and report receivers are ready before the GitHub
CLI publication. The normal static hosted `full` order is
not valid for this first rollout. This staged receiver path is not startup
recovery and never bypasses tag, channel, source, lease, or deployment health
checks.

## Local Scoped Release

The `people-computers-receivers-first` profile recognizes the shared computer
schema, Core projection, and Gateway endpoint together, or the shared Service
connection evidence schema with its Core and Gateway receivers. It deploys selected
Auth, Core, Gateway, Web, Remote Agent, then CLI scopes (Database remains first
when selected). Core and Gateway must precede new computer callers. A staged
Core receiver deploy uses the immutable current stable CLI projection even when
CLI publication is reserved for the later signed GitHub lane. Pass the same
pre-feature base to each staged plan so the directional contract remains visible.
Unreviewed combinations with opposing receiver profiles fail closed.

Use this lane only from a dedicated clean release worktree at the exact approved
`main` commit being released. The primary `main` checkout remains the human
workspace and is not an agent release lane.

```sh
git status --short
git fetch origin main --tags
node scripts/release/prepare-release-worktree.mjs
pnpm run release:plan
pnpm run release:deploy:local -- --scope web
```

`git status --short` must print nothing. The deploy command records the source
SHA, refreshes current `origin/main`, rejects any source outside its first-parent
chain, runs the cheap deployment preflight, checks that the worktree and SHA
stay unchanged, acquires each selected shared production scope lease in stable
order, deploys in safe order, and runs the selected component health check
before moving on. After every selected scope succeeds, it atomically publishes
the exact guarded-local completion refs while the same leases are still held,
then releases held scopes in reverse order. Deployment or evidence publication
failure remains red and still releases the leases. It does not repeat package
checks, unit tests, or integration tests that already established confidence in
the commit.

The prepare script only prepares this worktree's package dependencies. It
exits without changing them when the required release runtime is already
available. When a frozen install reports success without creating the required
links, it retries once with a forced frozen relink and verifies the dependency
again. It does not read or mutate OpenMeld user state and does not contact
production.

The shared lease is a Git compare-and-swap ref under
`refs/heads/openmeld-production-leases/<scope>`. Its canonical metadata records
owner, exact release source, scope, start, and expiry. Local and GitHub releases
use the same ref, so two workstations and a workstation plus hosted release
cannot overlap in one scope. Inspect without mutation:

```sh
pnpm release:lease inspect -- --scope web
```

An active lease fails closed. Expiry does not delete it automatically. After
proving the reported owner stopped, recover only its exact lease SHA and record
why, then rerun the guarded release:

```sh
pnpm release:lease recover -- \
  --scope web \
  --lease-sha <expired-lease-sha> \
  --reason "Verified the owning release stopped before deployment completed."
```

Recovery and release use `force-with-lease`; a stale process cannot delete a
newer owner's lease. Recovery atomically writes a durable record under
`refs/heads/openmeld-production-lease-recoveries/<scope>/<lease-sha>` before the
active ref disappears. Inspect that cross-machine record later with:

```sh
pnpm release:lease inspect-recovery -- \
  --scope web \
  --lease-sha <recovered-lease-sha>
```

The record preserves the previous owner, source, start, expiry, recovery
reason, recovery actor, recovery time, and exact recovery commit. A malformed
lease or recovery record fails closed for explicit inspection.

Use the verify-only command when you need a complete scoped go/no-go result or
handoff before deployment. The later deploy intentionally does not repeat it:

```sh
pnpm run release:verify:local -- --scope gateway
```

Use the preflight-only command to inspect the exact deployment invariants
without deploying:

```sh
OPENMELD_PRODUCTION_TRAIN_SCOPES=core pnpm run release:preflight:local -- --scope core
```

Every preflight checks the cheap repository release contracts. Core additionally
fails closed unless the production CLI channel can satisfy the local-component
version it will project. The CLI publisher still owns the mandatory final
release-readiness gate before irreversible publication. Native database migration, runtime grants, target and journal verification
remain owned by the guarded `db` scope described in
[Production Database Release](#production-database-release).

Whole-train preflight reads every component baseline and proves that all
pending scopes satisfy their actual receiver/producer compatibility dependencies
before any Production mutation. Those dependencies decide admission; the
documented job order is not a default dependency graph. Each scoped local or
hosted preflight repeats receipt-based stage admission. A later stage is blocked
while one of its real pending prerequisites lacks a verified receipt. This check
never substitutes the latest CLI tag for Web, Database, or Worker deployment
evidence. For the explicit Remote Agent and working-folder cancellation receiver contracts, a verified deployed
source may already contain the required receiver while unrelated changes remain
pending. Admission compares the named receiver files and shared schema inputs
at that deployed source against the target source. Only matching content, an
unchanged evidence identity, and existing target files discharge that dependency.
Missing witnesses or uncertain deployment state remain blocked; absence of a
dependency in another historical diff is not compatibility proof.

The complete release train is explicit. A single hosted entry requires its own
component as the declared independent scope. A staged release passes the same
comma-separated `OPENMELD_PRODUCTION_TRAIN_SCOPES` value to every Database, CLI,
Web, and Worker invocation; for example, separate `db`, `cli`, and `web` runs
for one release all declare `db,cli,web`. Every entry rejects a selected scope
that is absent from that train. Trusted current-main control verifies a client
artifact before the stage that publishes it. An independent `db` stage does not
build Web even when Web is declared for a later stage in the same train.

Artifact admission checks only the CLI, Web, Website, Docs, and Desktop artifacts selected for
the current stage. Declaring these components elsewhere in the train does not
build them before an unrelated Worker or Database deployment. CLI admission
uses the existing immutable npm probe: an already published package must pass
artifact and isolated-consumer verification; a new package must pass strict
release readiness, packing, and the same isolated-consumer check before CLI
publication. The resumable publisher
uses the retained checked tarball. Reuse requires a clean exact source, matching
build inputs and tool runtime, and the same inspected tarball integrity.
Changed inputs or bytes invalidate that local proof. Published-artifact recovery
never rebuilds a historical package or overwrites its published version.

Web and Desktop admission checks only the selected client scopes. When both are
selected, it checks Desktop first and Web second so the retained output and
receipt still identify the Web artifact used by the Web deploy. Scoped Web
preflight repeats the Web artifact admission. The deploy command may reuse only
a matching source, build-input, and output-hash receipt. When the other client
has replaced the live output, admission restores and rehashes the matching
snapshot. Changed inputs or a missing or invalid snapshot require a new build
and check. Local Workerd
receives a newly generated, disposable cookie-signing key only so anonymous SSR
can initialize; the receipt records that runtime mode and never records the key.
Production secret readiness remains a separate guard. Formal Web post-deploy
health binds the live root SSR source and build ID to that exact clean artifact
receipt.

The hosted `cloud`/`full` parent job checks the client artifacts selected in
that coordinated run once before its component jobs start. A single-component
run checks only that component's artifact; it cannot fail on an unrelated Web
or Desktop build. Desktop has no deployment job in the hosted scope. It may be
selected explicitly for artifact admission, while its production packaging entrypoint
verifies its renderer and prerender separately. Web and Desktop artifact
snapshots remain component-specific recovery evidence: restoring one component
selects that component's exact source and matching receipt without changing the
other component's baseline.

Hosted renderer builds use the runner's bounded Node heap and run immediately;
the worktree resource queue applies only to builds on a shared local machine.

Within one coordinated `release-on-main.yml` run, `validate_release_source`
performs the selected stage's artifact admission once before any Production mutation.
Only that job issues `production-train-admission` evidence through its protected
job output. Consumers require the exact source, declared train and artifact
scopes, repository, main workflow identity, trusted control SHA, run ID and
attempt, clean Git tree, lockfile hash, and Node/platform/architecture.
Coordinated consumers install the parent's exact Node version before dependency
setup; independently resolving Node 24 on each runner can select different
versions. Standalone callers retain the existing toolchain selection.
The evidence retains the inspected CLI tarball integrity and each renderer's
build-input, output and receipt hashes, including its Workerd SSR runtime.
This is artifact admission evidence, not a deployment or reconciliation receipt.

Component workflows and their nested preflight calls verify that output without
repeating selected artifact builds or npm consumer installation. The Database
action invokes the existing Database entrypoint from trusted control against the
release-source checkout so historical source cannot select an older admission
implementation. Its database steps and guards are unchanged.
The Web job additionally downloads the parent's immutable same-run artifact ID,
verifies the receipt, actual build inputs and snapshot bytes, and restores the
admitted Web output before its existing preflight, deploy and health gates.
For a parent handoff, the child uses the same renderer heap budget that the
parent used to build the snapshot; otherwise build-input identity must reject
the artifact even when its downloaded bytes are intact.
Website and Docs follow the same independent snapshot handoff for their own
renderer directories and public-page health routes. Docs does not require the
App's runtime session or secrets. Other components do not download Web bytes. Desktop publication and CLI
publication remain separate paths with their existing checks.

Missing, malformed or mismatched parent evidence, or a missing/corrupt Web
snapshot, fails closed; it cannot silently fall back to rebuilding. A child
cannot deploy a client artifact absent from its parent admission. Independent
component callers without parent evidence check their selected artifacts.
There is no cross-run cache or reuse: a partial rerun whose attempt differs from
the parent proof must rerun that stage's admission. Existing local snapshot
reuse still requires matching source, build inputs and output hash.

While waiting for Actions, use bounded waits or backoff and read compact job
status first. Read detailed logs only when a job changes state or a failure
needs diagnosis; do not repeatedly fetch unchanged full logs. Finish the current
stage before preparing the next one. In particular, defer Desktop, signing and
environment preparation until that stage is actually selected and ready.

Working-folder recovery introduces a Core cancellation receiver that must be
healthy before the new CLI/Service can emit that outcome. Use the guarded
`core-current-cli-projection` stage first: it installs the receiver while
retaining the currently published CLI floor. The new npm-backed Web installer
must follow the verified CLI publication. Thus a train containing these changes
has the dependency chain Core -> CLI -> Web; independent components remain
independent. The planner composes this chain with existing receiver contracts
and refuses contradictory directions rather than guessing. A previously
deployed matching Core receiver can satisfy the dependency even when unrelated
Core changes remain pending. The hosted `cloud`/`full` DAG cannot publish CLI;
use the explicit guarded stages for this train instead of its default job order.

Health-only resume is safe only when current-main guarded control matches the
retained receipt's selected source, operation key, lease, target, and live
deployment identity. A stage-admission recovery candidate records that a resume
may be possible; it never authorizes a second deploy or makes an unknown result
verified. Identity drift keeps the component blocked for evidence-backed
reconciliation or a legal forward fix.

A native PostgreSQL stage can lose its connection after its transaction commits.
For the exact retained source and operation, guarded recovery runs only the
registered target's read-only journal and runtime-grant verification. It retains
the original attempt and runs under the database lease. Verification failure
keeps the failed receipt; success completes it without repeating migration or
grant commands. This recovery does not apply to legacy D1 operations.

Useful examples:

```sh
# Inspect inferred scopes before declaring the complete intended train.
pnpm run release:plan

# Release a known Web-only fix after the commit is already on origin/main.
OPENMELD_PRODUCTION_TRAIN_SCOPES=web pnpm run release:deploy:local -- --scope web

# Apply a Core-owned migration and then release only Core.
OPENMELD_PRODUCTION_TRAIN_SCOPES=db,core pnpm run release:deploy:local -- --scope db,core

# Run the coordinated Auth-first cloud scope through the same guarded planner.
OPENMELD_PRODUCTION_TRAIN_SCOPES=cloud pnpm run deploy:cloud
```

`pnpm deploy` is a short alias for the automatic local scoped release. Prefer
the longer command in deployment reports because it makes the lane explicit.
`pnpm run deploy:cloud` is the guarded alias for `--scope cloud`; it must not
expand into raw per-component deploy scripts. The former `deploy:cloud:*` raw
aliases are retired because they bypassed source validation, preflight, ordered
health checks, and the planner's mixed-version contract.

## Core Worker Startup Admission

Cloudflare requires a Worker to parse and run its global scope within one
second. A Worker that crosses that fixed limit is rejected with error `10021`
before it can receive traffic. Raising `limits.cpu_ms` does not change this
startup limit; that setting applies to request CPU after startup.

Every supported Core release path must therefore use the guarded Core deploy
entrypoint. This includes the GitHub Core workflow, a local scoped Core release,
the temporary current-CLI projection used by receiver-first releases, and the
final Core projection in a CLI release. The guard performs these steps in
order:

Core's Wrangler build emits request-only dependencies as generated additional
ES modules. The memory adapter imports the Zep module only when it first needs
Zep, and the Routine scheduler imports the calendar module only when it
evaluates a schedule. The GitHub Skill importer imports the YAML parser only
after it has downloaded a `SKILL.md` file that needs frontmatter parsing. Slack
publication imports its Markdown converter only when it prepares a message.
Those dependencies are not parsed or evaluated in Core's startup path. All
Wrangler evidence, version-upload, development, and deployment commands run
this build step from the shared configuration; the generated modules are never
checked in or reused as stale release input.

1. Build Core's workspace dependencies from the exact checked-out release SHA.
2. Build the final Wrangler upload bundle and fail closed unless every relative
   ES module import resolves to a file inside that uploaded module graph. An
   attached additional module is not valid release evidence when the bundled
   entrypoint imports it through a different path.
3. Upload the production Core source and compile-time definitions as a new
   Cloudflare Worker Version with zero production traffic. If Cloudflare
   explicitly rejects that upload with `10211`, a pending Durable Object class
   lifecycle change requires atomic deployment. The same guard validates the
   configuration and runs `wrangler deploy` once with the same source, tag and
   compile-time definitions. No other upload failure enters this path.
4. Read Cloudflare's actual `Worker Startup Time` and the structured
   `version-upload` result, or the `deploy` result for an atomic migration.
   Missing or malformed evidence fails closed. Atomic deployment has already
   applied 100 percent traffic; evidence must record that fact, never zero.
5. Compare the measurement with OpenMeld's `500 ms` performance target. A
   higher value produces durable warning evidence but does not reject a version
   that Cloudflare accepted within its platform limit.
6. For a normal version upload, deploy that exact accepted Version to 100 percent
   production traffic without rebuilding it. Atomic migration deployment already
   performed platform startup validation and activation together; do not deploy
   it a second time. A failure after atomic activation requires inspecting live
   deployment evidence before recovery, not assuming that production is unchanged.
7. Synchronize routes, domains, and Cron Triggers through `wrangler triggers
   deploy` after the Version is active. Atomic deployment already applies them.

The uploaded Version owns the code, bindings, compatibility
settings, and compile-time definitions that Cloudflare accepted. Core's release
guard rejects `logpush` or `tail_consumers` in the Wrangler configuration
because Cloudflare does not apply those non-versioned settings through a Version
deployment. Do not add either setting until the release path has a separately
reviewed way to apply and verify it. Trigger synchronization remains explicit
because routes, domains, and schedules are also outside the Version payload.

Durable Object class lifecycle changes require the atomic path described above;
they cannot be applied by `versions upload`. Cloudflare validates Worker startup
before accepting that deployment. Prefer keeping lifecycle changes separate from
unrelated product changes, and do not roll back across a class lifecycle change.
See [Cloudflare's lifecycle deployment contract](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/#durable-object-class-lifecycle-changes).

CLI recovery invokes the Core guard from trusted current-main release control
against the original immutable product checkout. It retains channel verification,
source identity, leases and startup admission; a deployment-control repair does
not require republishing the same CLI version from a different source.

`pnpm run evidence:startup:core` captures a local CPU profile and summarizes
active, garbage-collection, and idle time. Use it to locate expensive global
initialization and compare two revisions on the same machine. It is diagnostic
evidence only: Cloudflare hardware differs, and a local profiler failure must
not block the guarded release or substitute for the zero-traffic Cloudflare
admission result. The release workflow preserves the raw profile before parsing
it so malformed alpha-profiler output remains diagnosable.

The workflow preserves these files for diagnosis:

```text
dev-tmp/core-bundle-evidence.json
dev-tmp/core-startup-evidence.json
dev-tmp/core-startup-admission.json
dev-tmp/core-startup.cpuprofile
```

If Cloudflare rejects the zero-traffic version with `10021`, keep the current
production version active and compare bundle and startup profiles with the last
accepted source on the same machine. Fix a measured initialization regression
before another upload. If that comparison shows no regression, one diagnosed
retry may distinguish a transient admission failure; repeated rejection requires
startup optimization. Local timings do not prove Cloudflare admission. A version
above OpenMeld's `500 ms` performance target may continue
through the guarded release when Cloudflare accepts it, but the warning remains
actionable optimization evidence. Raising request CPU limits does not change
the startup limit. Cloudflare's current startup and version upload contracts
are documented in [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
and [Gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/).

## GitHub Scoped Release

Use `.github/workflows/release-on-main.yml` (`Scoped Production Release`)
for Worker and database releases from an immutable `main` commit. GitHub is
the normal cross-machine lane because it owns centralized credentials,
observable logs, immutable checkout, and per-component production locks.
Actions-unavailable fallback and the lifecycle around this command are owned by
`agent-native-delivery.md`.

Available scopes are:

```text
database
database-auth
database-core
web
gateway
auth
core
core-current-cli-projection
remote-agent
website
docs
cloud
full
```

- The default is `web`, not `full`.
- `core-current-cli-projection` is the hosted receiver-first Core stage. It
  deploys the approved Core source while compiling the immutable currently
  published CLI projection, so a future CLI/Service release is not advertised
  before its receivers are healthy.
- `database-auth` and `database-core` are the normal migration bundles. They
  keep the database and its owning Worker in one ordered workflow without
  redeploying the fleet.
- `cloud` deploys Auth, Web, Gateway, Core, Remote Agent, Website, and Docs.
- `full` runs Database, then the selected cloud components in that order.
- CLI publishing is not available in this workflow.

The separate CLI Release workflow also deploys the Core projection required by
the published CLI channel. For PostgreSQL it verifies the deployed native
database contract and immutable import evidence before publication. Core
startup admission checks the registered target and native migration journal
before uploading a version or entering its atomic Durable Object migration path. This covers standard, receiver-first, current
stable CLI projection, and CLI projection deployment in both release lanes.
The check is at the Core mutation boundary, not whole-train preflight: an
ordered `database-core` or `full` release completes Database before checking
and deploying Core. If migrations remain, release the exact SHA with the
`database` scope first, then resume the guarded Core/CLI release. Non-Core
scopes and migrations outside that release source are not gated by this check.
This prevents a new Core writer from reaching an older database constraint or schema.

For a Center Agent bridge release that includes Context Scope Plan, first run
the `remote-agent` scope from the approved commit and verify it succeeds. Then
run the remaining required database/cloud scopes, and publish CLI only after
those receivers are healthy. The ordinary `cloud` and `full` DAGs retain
their default order because other contracts require Core receivers before
Remote Agent callers; the early standalone Remote Agent release is the explicit
receiver-first stage for this mixed-direction contract.

The hosted workflow is deploy-only. Inspect the complete plan locally before
dispatch:

```sh
git fetch origin main --tags
pnpm run release:plan -- --base origin/main --scope web
```

Every dispatch requires the exact 40-character `main` commit approved for the
release. The workflow validates `release_sha` against the first-parent history
of current `main` and uses it for every selected component. A merged pull
request's side-branch head is an ancestor of `main`, but it is not an approved
`main` release source and is rejected. Later commits merged into `main`
belong to a later release. `--ref main` selects the trusted workflow
definition; `release_sha` selects the code being released.

The workflow keeps those two sources separate. `release-control` is checked out
from the trusted workflow/current-main SHA and owns mainline validation, setup,
the shared scope lease, and other release controls. `release-source` is checked
out at the exact approved `release_sha` and owns only the product build and
deployment. Both checkouts disable persisted Git credentials. This separation
keeps same-SHA recovery working when the release source predates a newer lease
action or control schema, without running release controls from historical
product code or silently changing the product SHA.

Trusted current-main controls receive step-scoped GitHub tokens and explicit
repository roots. They inject HTTPS authentication only into the exact fetch,
lease compare-and-swap, or immutable tag network process; disable source Git
hooks and unsafe protocol helpers; remove inherited Git trace and curl-debug
settings; force Git credential redaction; and never persist credentials in Git
configuration. Product build, signing, deploy, health, and smoke commands do
not receive those Git credentials. This also makes private-repository main/tag
refresh and the shared lease independent of persisted checkout credentials or
the workflow's workspace-root working directory.

Hosted Worker preflight follows the same control/source split. The current-main
`release-control` checkout runs `hosted-production-preflight.mjs` and passes the
exact historical `release-source` root and SHA as data. Current control scripts
inspect that product root and run their commands there; they never load a
preflight entry from the historical package manifest. Product build and deploy
still run only from the exact `release-source` checkout. Cloudflare environment
verification uses its explicit `production` profile in this lane, so a staging
contract introduced after the approved cutoff cannot retroactively invalidate
that immutable production source. Normal repository verification keeps using
the full environment profile and continues to enforce staging requirements.

```sh
release_sha="$(git rev-parse origin/main)"
gh workflow run release-on-main.yml \
  --ref main \
  --field scope=web \
  --field production_train_scopes=web \
  --field release_sha="$release_sha"
```

When `release:status` reports that the captured commit is ready, confirm the
exact Final Candidate evidence and dispatch only the selected release scope.
One small source-validation job verifies the SHA shape and first-parent
membership before any selected production job can enter its Environment. A
non-`main` dispatch runs one rejection job and never enters production jobs or
the Environment.

Each component workflow checks out the captured release SHA, installs through
the cached pnpm setup, runs only the cheap deployment preflight, deploys once,
and performs a lightweight health check. It does not rerun candidate checks,
unit tests, or integration tests.

Every component workflow owns a stable production concurrency group with
`queue: max` and `cancel-in-progress: false`, and acquires the same Git-backed
scope lease used by the local lane. `queue: max` retains up to GitHub's supported
maximum of 100 waiting runs instead of replacing an earlier pending release.
GitHub concurrency serializes the hosted queue; the shared lease extends that
invariant to local-to-local and local-to-hosted races. Two releases of the same
component serialize and a running deploy is never canceled. Unrelated component
groups remain able to run in parallel. Do not add workflow-wide concurrency
that serializes the whole fleet.

The system does not automatically coalesce queued same-scope releases because
it cannot infer whether an intermediate migration, receiver-first stage, or
immutable publication is required. A not-yet-started run may be canceled only
when recorded evidence proves that a later queued SHA safely supersedes it.
Never cancel a running production job.

## Production Database Release

Apply committed PostgreSQL migrations through the scoped release owner:

```sh
pnpm run release:deploy:local -- --scope db
```

The executor applies pending migrations, grants runtime access, verifies the
native journal and target, and records completion under the database lease.
Select `db,core` or `db,auth` when a service change requires the new schema.
Unchanged services retain their existing deployments. Migration credentials
come from the [PostgreSQL owner](postgresql.md); normal Workers use the runtime
role through Hyperdrive.

Applied migrations are immutable. A migration failure stops the release before
dependent services. Inspect the native journal and recover through the same
owner. D1 is the frozen pre-cutover source; it is not a rollback target after
PostgreSQL writes. The old `db:release:prod` and `db:sync:prod` commands are D1
commands and reject the PostgreSQL production manifest.

## CLI Release

CLI publication is a separate immutable release, not another Worker scope.
Read `developing/engineering/cli-binary-release.md` for artifact and Apple
credential details.

Before publication, set `OPENMELD_PRODUCTION_TRAIN_SCOPES` to the complete
intended train (`cli` for an independent CLI publication), then inspect the
base-aware local-component plan:

```sh
pnpm release:local-components plan --next
```

The plan prints both channel versions, the current CLI and Service floors, the
selected patch, the exact components changed since the last published tag, and
any missing policy decisions. For every changed component, the release agent
must explicitly choose `available` or `required` and provide a component-specific
reason. The stamp command fails before building or writing when either fact is
missing; it never silently chooses `available`.

For example, after the Contract Impact Audit has established that both changed
components remain backward-compatible:

```sh
pnpm release:local-components stamp --next \
  --cli available \
  --cli-reason "Existing CLI commands remain compatible with both cloud versions." \
  --service available \
  --service-reason "Existing Services can safely continue current and new Wake work."
```

Channel drift is a warning and still selects the higher patch plus one.
If either channel cannot be read, `--next` fails without changing or guessing a
version. Use `--version X.Y.Z` instead only when an operator has already
approved that exact version; `--version` and `--next` are mutually exclusive.

- Choose `available` only when old cloud to new local and new cloud to old local
  remain safe for the affected behavior.
- Choose `required` when an old local component cannot safely accept new Wake
  work, including a critical Wake, setup, reconnect, auto-update, permission,
  structured-reply, runtime-transport, or other main-path fix that users must
  receive before continuing.
- A required release blocks new unsafe Wake work below the monotonic CLI or
  Service floor. It must still preserve update and self-rescue commands and must
  not cancel an already accepted dispatch. A later `available` release carries
  both floors forward and cannot reopen an installation below them.
- Required is sometimes the least harmful user choice, but it is not the
  default and must not be applied to every release.

Before stamping a Service hash that reuses Windows helper bytes, prepare them
in the clean release worktree with the same source check used by publication:

```sh
node scripts/release/reuse-windows-process-artifact.mjs <trusted-main-run-id>
```

This checks the run's repository, `main` branch, official CLI workflow and
successful Windows job before downloading anything; it then verifies ancestry,
native source, and artifact bytes before importing the helper. A PR Windows
compatibility artifact is not a release source even if its source fingerprint
matches. Pin this exact run ID for publication. If no matching trusted run
exists, dispatch `.github/workflows/cli-release.yml` on `main` with
`helper_only=true` and `production_train_scopes=cli`, then use that successful
Windows helper run. This preparation publishes neither CLI nor Core.

The stamp command writes the version and required-update floor before building
the packaged CLI, then records its Service hash and verifies the result. It
rejects source drift and restores its metadata changes on failure. Never hand-edit the hash, reuse
an existing `dist`, or pass `--current` to prepare a release manifest. Rerun the
stamp after any merge, rebase, or later local-component change. Land the stamp
through a PR from a clean worktree; never push `main` directly. The package and
manifest may land with the source and compatibility floor they describe when
that candidate is stable. Otherwise stamp in a separate release PR after the
feature merges. A later source change requires a restamp. Final Candidate
selects strict artifact verification from the actual manifest diff,
independent of the branch name.

At publication time, `pnpm run release:deploy:local -- --scope cli` rechecks the
committed package and manifest through the guarded local production lane. It
requires the exact clean source to remain on current `main`, acquires both the
shared CLI and Core leases, and never edits the release worktree. The resumable
internal publisher reads its target from the committed package, so recovery uses
the same guarded command without a second public publisher entry.

For GitHub, use `.github/workflows/cli-release.yml`:

1. for a normal CLI publication, run `release_path=normal` directly;
2. the workflow runs the `release_ready` gate before publication;
3. use `Scoped Production Release` separately when the release card also
   requires database or cloud fleet changes.

Windows Native AOT helper bytes can differ across builds of identical source.
Set `windows_artifact_run_id` to the run used above when publishing the stamped
manifest. The publisher rechecks its provenance and bytes and skips a second
Windows build. A different run with the same source is not interchangeable.

Use `release:verify:local -- --scope cli` only when an earlier full go/no-go
decision or handoff is needed; it is not a default extra gate.

The workflow publishes the signed and notarized binary, R2 manifest, npm
package, tag, and Core projection. It does not migrate the database or redeploy
Auth, Remote Agent, Gateway, or Web.

For an approved local release with the required Keychain, npm, and Cloudflare
credentials:

```sh
pnpm run release:deploy:local -- --scope cli
```

Both lanes fail closed before artifact upload when signing, signature
verification, or Apple notarization fails. Never publish an unsigned or
unnotarized production macOS binary.

Recovery inputs remain available for workflow compatibility, but they all run
the same resumable release command at the exact original `release_sha`:

- `normal`, `resume-after-binary-upload`, and `resume-after-npm-publish` all
  invoke the same internal resumable publisher from trusted current-main
  release control.
- The executor probes each immutable stage and skips completed work instead of
  relying on a human-authored exclusion list.
- Always provide the original `release_sha`; a release tag or Core projection
  from another commit is a hard failure, not a recovery target.

### npm submission and availability

The CLI release owner packs with pnpm so catalog/workspace references become
portable dependency versions. A packing-only hook preserves the exact source
`gitHead` without editing the checkout. Before any binary upload or npm attempted
receipt, the owner checks the actual tarball and installs it with ordinary npm
outside the workspace, using disposable HOME, OpenMeld state, npm configuration
and cache. The installed CLI must report its version and its native SQLite
reader must execute a query. Publication then submits that same verified tarball
with npm; publishing the source directory directly is refused.

The completion probe verifies downloadable tarball integrity, source, version,
required floor, entrypoint and portable runtime dependencies. Within the same
attempt its bytes must match the prepublication consumer proof. A resumed or
read-only alignment check repeats consumer installation in disposable local
state; it never publishes or changes real Service state. A visible but invalid
immutable package fails closed and requires a corrected new release, not a
republish or a user reset. This check is distinct from native Windows signed-in
setup/Wake acceptance after release.

The R2 binary body probe allows 180 seconds because a valid 26.7 MB compressed
artifact exceeded the previous 60-second download budget. Artifact HEAD probes
retain 60 seconds and command metadata probes retain 30 seconds; artifact size
and hash checks still fail closed.

`npm publish` can succeed while npm is still processing the package and exact
version queries return 404. Submission is not availability. Both release lanes
publish to and query `https://registry.npmjs.org/`, preferring an online query.
After submission, verification waits with backoff for up to 20 minutes of
scheduled waits (plus bounded probe time). A missing version after that budget
leaves channel verification pending and exits nonzero, never successful.

The resumable publisher records source-bound immutable refs on the release
remote at `refs/heads/openmeld-npm-publication/<version>/attempted` before
calling npm and `/accepted` after npm returns success. Both point to the exact
release source SHA. They do not claim that the package is downloadable and do
not replace the registry probe or the CLI/Core scope leases. Hosted receipt
operations use trusted Git authentication without exposing credentials to
candidate code or hooks. Never move a receipt to a different source.

A new runner reads these receipts before starting release stages. Existing
receipts prevent automatic resubmission on a 404. The original version tag,
which older releases pushed after npm succeeded, also preserves that evidence
for releases predating receipts. A pending-only recovery checks npm first and
does not rebuild artifacts or redeploy Core. A network/authentication probe
failure remains an error, not evidence that the version is absent.

For pending availability, rerun the normal guarded command or GitHub workflow
at the original release SHA; it resumes verification. If only `attempted`
exists, the command was interrupted or failed and acceptance is unknown. Read
the original npm publish output and check npm status before taking further
action. Do not delete receipts or increment the version merely because a query
returns 404. If the publish log conclusively proves rejection before acceptance
(for example, a credential rejection), first correct that cause. An operator
may then remove only that version's `attempted` ref using an exact-SHA lease,
after confirming no publisher is active and no `accepted` ref exists, and rerun
the guarded command. Ambiguous submission outcomes remain verification-only
until resolved; they must not silently become another publish attempt.

When R2, npm, and the immutable release tag are already complete but the Core
projection alone failed Cloudflare startup validation, do not rerun the CLI
publisher. Merge the reviewed Core startup fix first, then dispatch
`.github/workflows/recover-core-cli-projection.yml` from `main` with that exact
new main commit:

```sh
gh workflow run recover-core-cli-projection.yml \
  --ref main \
  --field release_sha="<exact-reviewed-main-commit>"
```

This Core-only recovery reads `channels.stable.version`, loads that version's
`release/local-components.json` and commit identity from its immutable Git tag,
derives the expected Core Worker tag from those exact bytes, and injects both
the tagged manifest and Worker tag into the new Core build. It then verifies
deployment visibility and performs the read-only R2/npm/Core alignment probe.
It never moves the release tag, republishes npm or R2, or deploys Auth, Web,
Gateway, or Remote Agent. The GitHub CLI release and this recovery share the
Core deployment lock so those GitHub lanes cannot change the stable channel
while recovery is building or deploying its projection.

Its preflight verifies the Cloudflare environment contract,
retired identifiers, and production Core Queue resources, but intentionally
does not compare the newer checked-in local-component manifest with the older
stable channel. That mismatch is the recovery condition. The recovery script
instead validates the live stable version, its immutable Git tag, and its
tagged manifest before compiling that exact projection. Ordinary Core releases
continue to require the checked-in manifest and stable channel to match.

## Resumable Execution

The guarded local executor is safe to rerun after interruption. Completion
probes are read-only. A completed stage prints `SKIP (already done)` with its
criterion; an incomplete stage prints `RUN` and executes the existing command
and gates unchanged. If a completion probe cannot run because of network,
credentials, or malformed output, the executor prints the probe failure and
runs the stage only when that stage is safely repeatable. The immutable CLI
binary stage is the exception: an inconclusive probe fails closed. When the
production manifest has a semantically lower version, the new target may safely
resume because artifacts publish before the manifest; this decision is made
before requesting any artifact owned by the older manifest. A manifest version
ahead of the target fails without mutation so the stable channel cannot move
backward. Prerelease, build-metadata, non-canonical, or other suffix variants do
not count as the target even when their numeric core matches; they fail closed.
Only exact canonical `x.y.z` string equality permits target artifact probes.
Once the manifest names that exact target version, any missing, incomplete,
size-mismatched, hash-mismatched, or unreconstructable artifact fails without
rebuilding or overwriting that version.

The built-in production order is:

```text
selected database migrations -> CLI/Service channel -> scoped Worker verify/deploy -> R2/npm/Core alignment
```

The CLI release creates its required Core projection before other selected
Workers. After every selected Worker deploy and health check, the production
executor reruns the same resumable CLI command as the terminal three-way
alignment check; when the release is complete, that rerun is read-only and all
stages skip. Before each Worker deploy, the executor prints the current
production version ID for comparison. Repeated Worker deploys remain allowed
because they are safe, even though they create another Worker version.

| Stage | `SKIP` criterion | Criterion level |
| --- | --- | --- |
| Production PostgreSQL migration application | Native journal matches the committed migration prefix; scoped target and runtime grants verify | Native database acceptance under the database lease |
| CLI binary, signing, notarization, and R2 | The production manifest has the target version and the exact target `minRequiredCliVersion`; the platform record is complete; the raw and gzip artifacts are downloadable with their recorded sizes; the gzip sha256 matches and reconstructs the recorded raw binary | Immutable published-record evidence; any inconclusive or inconsistent target-version record fails closed |
| npm | The exact version and floor exist; the downloaded tarball matches integrity and source, has portable dependencies and the CLI entrypoint, and has an isolated npm consumer proof | Verified immutable artifact and consumer installation, not version existence alone |
| Release tag | The target tag resolves to the current release commit both locally and on `origin` | Local and remote Git object identity |
| Core projection | The active 100% production Worker version carries the stable tag derived from the release commit and `release/local-components.json` | Active Worker version identity |
| Final channel alignment | R2 and npm expose the exact target version and `minRequiredCliVersion`, and the active Core projection satisfies its target criterion | Three-way published state |

A release tag that exists at another commit locally or on `origin` fails
immediately and is never moved. The resumable executor owns both local tag
creation and exact-ref publication to `origin`; callers must not add a second
tag-push path. R2 and npm package versions are immutable too: if either already
publishes the target version with a different CLI floor, the release fails
before any mutation and requires a new version instead of overwriting artifacts.
A final channel-alignment failure includes the exact next release command. The
normal recovery command is therefore the original command, not a manually
shortened sequence:

```sh
pnpm run release:deploy:local -- --scope cli
```

## OpenConnector Release

OpenConnector is an external source checkout with an OpenMeld-owned production
configuration. Its tracked deployment source is
`config/openconnector/wrangler.production.jsonc`; do not deploy production from
an ignored `wrangler.local.jsonc`.

OpenMeld maintains the public downstream fork
`https://github.com/amplifthq/open-connector`, whose `main` must remain a clean
mirror of `https://github.com/oomol-lab/open-connector` `main`. Put each general
fix on its own fork branch and submit it upstream. Keep a downstream-only patch
outside fork `main`, on an explicit OpenMeld release branch, only when
production needs it before upstream merges or when the behavior is genuinely
OpenMeld-specific.

For a newly prepared local checkout, use `origin` for the Amplift fork and
`upstream` for the official repository. Existing concurrent checkouts may use
different remote names; identify remotes by URL before fetching or pushing, and
do not rename remotes or rewrite branches merely to normalize an active
worktree. Fork creation, remote changes, branch pushes, and fork synchronization
do not change the running Worker. Only the explicit deployment command below
changes production.

Deploy only a clean checkout at an explicitly reviewed full commit SHA:

```sh
pnpm deploy:openconnector:production -- \
  --source /absolute/path/to/open-connector \
  --source-sha <full-commit-sha>
```

The reviewed source SHA must exist in the Amplift fork so another operator can
reproduce, roll back, or redeploy it without relying on one workstation. After
an upstream patch merges, synchronize fork `main`, remove the superseded
downstream patch from the next OpenMeld release branch, and validate that exact
remote SHA before deployment. Synchronizing the fork alone never requires a
production redeploy.

After deploying the runtime-catalog cache correction, verify that runtime
catalog responses use `Cache-Control: no-store`, have no CDN cache header,
and reflect the current OAuth configuration. Earlier versions cached
`/v1/providers` and `/v1/actions` for a year. If stale CDN entries still survive
the deployment, purge them on that environment's OpenConnector hostname and
repeat the checks. Keep staging purges confined to
`connectors.staging.openmeld.ai`; never purge the shared zone for a staging test.

The reviewed runtime supports managed authorization requests and event subscription
maintenance. Keep the once-per-minute `triggers.crons` in both tracked deployment
configs. The guarded command applies pending migrations before deploying the
scheduled handler. After deployment, verify scheduled invocations and maintenance
progress separately from HTTP health. Do not configure a managed-cloud project or
expand OAuth grants as part of an ordinary source upgrade.

The command regenerates the provider catalog, builds and copies the Web assets,
applies pending remote D1 migrations, and deploys the Worker with the tracked
policy while preserving Cloudflare secrets. When every canonical secret is
available in the release environment, the command sends the complete set to
Wrangler over stdin. Otherwise it fails closed unless the existing production
Worker already exposes every required secret name, then deploys without
replacing those secret values. Never rotate the credential-encryption key or a
provider credential merely to perform an ordinary source release. After
deployment, prove the admin and runtime token surfaces independently and prove
that each token receives `401` from the other surface. These internal checks
are deployment evidence; one user-visible Center Agent result is still required
as the real-user smoke.

## Health Checks And Product Smoke

Release automation performs only cheap component health checks:

| Component    | Automated post-deploy evidence                                                    |
| ------------ | --------------------------------------------------------------------------------- |
| Web          | Root SSR returns HTML whose source and build metadata match the exact SHA and preflight artifact receipt |
| Website      | Public-page SSR source and build metadata match its independent artifact receipt |
| Docs         | Root and `/docs` SSR source and build metadata match its independent artifact receipt |
| Gateway      | `https://gateway.openmeld.ai/health` responds successfully                        |
| Auth         | `https://auth.openmeld.ai/health` responds successfully                           |
| Core         | Cloudflare reports the production deployment                                      |
| Remote Agent | Cloudflare reports the production deployment                                      |
| CLI          | Signing/notarization, channel artifact, npm, tag, and Core channel gates complete |

These checks answer "is the component deployed and reachable?" They do not
prove a user workflow.

Do not build a generic browser or Wake smoke suite into CI. After deployment,
the release agent runs the smallest real-user smoke that covers the actual
change and its handover checklist. Examples:

- a Web navigation fix: open the affected production page in the real browser;
- a Space Wake change: run one published-CLI or Web Wake and capture the Space
  outcome plus `service trace` when needed;
- a CLI command fix: run that command through the published `openmeld` lane;
- an unrelated Worker refactor: confirm its page or public entrypoint and no
  5xx response.

After that exact changed path succeeds once and the visible result plus any
required trace is recorded, stop. Repeat only after another deployment or
relevant state change, when the task names another case, or when the smoke
fails. Repeating an unchanged successful Wake or browser path consumes product,
machine, and agent capacity without creating new release evidence.

Smoke failure is a release failure. Keep the deployed SHA and diagnostic
evidence, stop the remaining rollout, and choose a forward fix or explicit
rollback. Do not hide it by rerunning unrelated stages.

## Release Report

Every production handoff must include:

- release lane: local or GitHub;
- exact commit SHA;
- selected scope and why broader scopes were not needed;
- verification result;
- database result, including whether migrations were selected and whether any
  migration was pending;
- deployment start/end time and per-component result;
- automated health-check result;
- real-user smoke steps and conclusions;
- CLI version, update policy, notarization result, npm/R2/tag/Core alignment
  when CLI was published;
- failures, recoveries, skipped checks, and remaining work.

Never report a preview, control-plane deployment listing, direct database query, or
internal RPC call as completed real-user smoke.
