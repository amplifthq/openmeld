# Native Computer and Plugins integration

## Agent Context

- Purpose: Record combined Computer, Plugins and harness acceptance for PR #1537.
- Read this when: Reviewing this batch or preparing its later deployment.
- Update this when: Source identity or acceptance evidence changes.
- Do not use this for: Production availability claims or deployment authorization.
- Source of truth: The bounded observations and contract audit below.

Status: Local acceptance complete; merge checks pending. Remove after deployment
assessment; PR #1537 and Git history retain the evidence.

## Outcome

PR #1537 integrates Computer, Plugins (#1536), and hosted harness recovery
(#1535). OpenConnector #21 is merged into the existing OpenMeld integration
branch at `2e8bad6c4b03f00c85a7bdd6df819bb4159e7ded`. No deployment is part of
this acceptance.

The native Computer owns programs, files, command receipts and concurrent
execution. Plugins owns account selection and provider credentials. A temporary
Computer-local Git URL joins these capabilities without exporting credentials,
changing global Git configuration, or transferring repository files through the
model. Provider metadata owns catalog availability and credential fields.

## Representative local acceptance

The isolated PostgreSQL development stack used a synthetic account and a
temporary, encrypted OpenConnector instance. Its GitHub connection was removed
through the public Gateway disconnect endpoint after testing.

- Center Agent used `computer_git_connection` and native `git clone --depth 1`
  to check out the private OpenMeld repository. It reported commit
  `1778a026c1c5d5aaf655f92fd420d562b91b44e9`, a clean working tree and 9,419
  tracked files. The Git pack stream transferred 20,295,433 bytes in 21.084
  seconds. This measures the stream, not total model/checkout latency.
- Remote Agent read the same directory and commit on the same user Computer.
  It obtained its own connection and completed native `git ls-remote` with exit
  code zero and the same HEAD. Local CLI independently read that workspace.
- Two fresh native commands ran concurrently. Stopping one produced exit 143;
  the other completed with exit zero and its expected file. Commands had
  separate receipts despite using the same caller-selected key.
- Earlier native acceptance covered shared file reads through Worker JavaScript,
  lightweight shell and Linux, environment/stdin, public Git clone, and retained
  command polling. This integration run did not repeat every SDK operation.
- Real Web navigation loaded 1,330 catalog providers, searched providers,
  switched Elasticsearch between API-key and account-credential forms, and
  preserved three input lines in Oracle's private-key Textarea. No Oracle or
  Elasticsearch credentials were submitted.
- Focused OpenConnector tests passed (102 cases), Core connection integration
  passed (56 cases), Gateway connector checks passed (26 cases), and Web catalog
  and conversation-connection tests passed (10 cases).

The first private clone attempt correctly stopped because the synthetic
connection had no Agent grant. After saving read access through the public
access endpoint, the same task completed. GitHub's unavailable guidance now
also names Agent access settings, rather than suggesting only reconnection.

The existing GPT-6 Astra High reviewer independently checked the native Git and
catalog changes. Four P2 findings were corrected: unavailable catalog entries,
private service-name discovery, multiline credentials, and alternate credential
methods. Its final review found no new P1/P2.

Harness-specific compaction, command recovery and latency evidence is recorded
in `2026-10-06-hosted-harness-recovery-validation.md` in this directory.

## Contract impact and future rollout

- Changed boundaries: additive cloud Computer operations/CLI entrypoint,
  optional provider-auth metadata, provider service-key validation, internal
  Core service discovery, and optional Git-grant connection scope. Existing
  setup, workstation Wake, Service execution, Space actions and diagnostics
  retain their current contracts. No minimum local-client version is required.
- Old local clients continue existing commands with new cloud receivers. New
  CLI native operations require their cloud receiver; old cloud rejects an
  unknown operation instead of executing a different action. Publish the new
  optional CLI/Skill capability only after cloud receivers are available.
- Apply migration 0020 before admitting new provider keys. Upgrade the pinned
  OpenConnector integration before enabling catalog-auth metadata/native Git.
  Core service discovery must precede its Remote Agent caller. Preserve the
  repository's receiver-first cloud rollout rules for Web/Gateway/Core, and
  complete Remote Agent before publishing the new CLI capability.
- Optional response metadata supports mixed-version readers. Existing
  connections and access revisions keep their owner and policy. The service-key
  constraint expands accepted values without rewriting existing rows.
- Rollback removes new callers first. Do not narrow the database constraint
  after new provider registrations exist. Keep the additive schema migration.
- Architecture check: no additional execution authority, credential owner,
  Computer owner, Wake state, or readiness projection was introduced. Current
  access is rechecked at the existing owner boundaries.

The retained snapshot checkout/publication path has different semantics:
bounded API publication with synthetic comparison history. Native clone is now
the documented default for ordinary repository work. Native Plugin Git remains
read-only; generic credential-login UI and a virtual desktop remain out of scope.
