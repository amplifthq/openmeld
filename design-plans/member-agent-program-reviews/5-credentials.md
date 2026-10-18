# Phase 5 · Credentials — decisions and external review

Packages: 5a0, 5a, 5b, 5c, 5d of [the MemberAgent program](../member-agent-program.md)
(§4.7, §6, §10 Phase 5, §13).
Branch: `claude/map-5-credentials-b6f373`, cut from
`claude/member-agent-program` @ `2612127c6`.

## 5a0 · Risk-window contract (decided before implementation)

### Question

When a §6 operation arrives with the CLI login credential, how does Core
know which computer sent it, and how does it read that computer's active
tasks with their chain roots?

### Evidence

- The CLI login credential is a Better Auth session token sent as
  `Authorization: Bearer` (`clients/openmeld-cli/src/config/token-store.ts`,
  `packages/auth/src/configs/auth.config.ts` `bearer()` and
  `deviceAuthorization()`). Auth resolves it to a user and a session
  (`services/auth/src/lib/rpc/entrypoint.ts` `resolveClaimsFromSession`);
  the claims carry no device or runtime identity.
- No CLI or Service request carries a device header
  (`packages/gateway-contract/src/headers.ts`). A header would be
  self-asserted: a task can omit it or name another computer.
- The Service's daemon connection identifies its runtime with a
  daemon-generated `daemonSessionId` and the runtime registry's `deviceId`
  (`services/core/src/runtime-registry/application/runtime-registration-service.ts`).
  Neither is bound to the Better Auth session that authenticated an HTTP
  call, so Core cannot map a CLI call to a registered runtime.
- One token can serve several computers: `openmeld setup --ott` gives the
  CLI the signed token of the browser session that generated the one-time
  token (`one-time-token/verify` returns the same session), and nothing
  stops a token from being copied.
- RuntimeCoordinator already has a cheap per-owner read. The owner shard
  (`resolveRuntimeTransportOwnerShard(env, ownerUserId)`) holds the active
  Profile index and, per Profile, the admission record with
  `activeHeadLifecycleIds`
  (`services/core/src/runtime-transport/application/agent-profile-execution-admission.ts`).
  Each head's `acceptedDispatchSnapshot` has `openMeldServiceRuntimeId` (the
  computer) and `executionContext.requestChain` (the frozen chain; Phase 3).
- The dispatch ledger column `request_chain_root_profile_id` (migration
  0044) is a projection; AGENTS.md says the ledger does not decide in-flight
  execution truth, and the ledger has no owner or organization index.

### Decision

1. **Per-device read is not available.** Core cannot identify the calling
   computer of a CLI-credential request without trusting the caller. The
   program's fallback applies: **the risk window is open when any active
   task of this owner, for a Profile in this organization, has a chain root
   that is not the owner.**
2. **Read path: RuntimeCoordinator, not the ledger.** A new owner-shard RPC
   (`rpcReadRiskWindowExecutions`) walks the active Profile index →
   admission records → active heads and returns, for each head in
   `accepted`, `waiting` or `execution_linked`, its target Profile, runtime
   and chain root. Core then resolves the root Profiles and target Profiles
   through Auth Profile facts (one batch, only when the shard returned
   anything) and keeps tasks whose target Profile is in the request's
   organization and whose root is not owned by the owner.
3. **Fail closed.** If the execution index is rebuilding or a head is
   unreadable, the window counts as open (`risk_window_unverifiable`); a
   head without a chain root also counts as non-owner-rooted.
4. **Cost.** The read runs only for a §6 operation made with the CLI
   credential and no task credential: one Durable Object RPC, plus one Auth
   batch when tasks are active. Ordinary CLI use, Web, App and task-credential
   calls never read it.
5. **A task credential rooted at the owner also sits in the window.** Any
   task of the owner's OS user can read another task's credential file, so
   while a task with another root runs, an owner-rooted credential asks the
   owner too. The credential names its Service runtime
   (`openMeldServiceRuntimeId`), but narrowing the window to that runtime is
   not safe: dev, canary and production Service lanes on one computer have
   different runtimes and the same OS user. A colleague-rooted or rootless
   task credential is rejected outright (5b).

### Residual risk (accepted, recorded)

- A non-owner-rooted task can start a detached process that outlives the
  task. Once the task ends, that process's CLI calls are outside the window.
  §4.7 item 5 already states that a full-access task can run any command as
  the OS user; the window narrows the risk to the task's lifetime.
- The window is per owner, not per computer: a colleague-rooted task on the
  owner's laptop also opens the window for the owner's desktop terminal.

## Implementation summary (5a–5d)

- **5a Task credential.** The task's RuntimeCoordinator execution token,
  already minted per execution and retired when the execution is terminal.
  No second credential store: the owner shard resolves it
  (`rpcResolveTaskCredential`) and takes the root from the Wake's accepted
  assignment, never from the caller. The CLI attaches it inside a Wake
  (`x-openmeld-task-credential`); the Gateway passes it only in the input of
  a sensitive operation, never in the request context. It is verified at the
  sensitive-operation boundary only, so ordinary task calls pay nothing.
- **5b Sources.** Auth claims carry `credentialKind`. The Better Auth plugin
  `openmeld-cli-credential` marks a session as soon as a CLI holds it
  (device login, one-time-token verification, any Bearer use) and, with the
  program enabled, keeps marked or Bearer sessions away from endpoints that
  could mint an interactive session (Electron transfer, passkey registration,
  social linking, email or password change). Before a sensitive operation an
  interactive session is re-read without the cookie cache.
- **Desktop "in-App" proof (§13 open item).** The Desktop app opens no local
  port (`clients/desktop/src/main` has no `listen`/`createServer`). Its main
  process reaches Core with its own Better Auth Electron session cookie
  (`pilot-auth.ts` `cloudRequest`, session created at `/electron/token`), the
  same authenticated path as Web. CLI commands the Desktop runs use the CLI
  credential and are classified as such. No local-port source exists to
  exclude.
- **5c CLI credential.** Inside the risk window a CLI-credential (or
  owner-rooted task-credential) sensitive operation creates an urgent
  `credential_confirmation` Inbox item bound to owner, Organization,
  operation and request digest, usable once within 10 minutes. Only the
  owner's interactive session answers it. The CLI waits and repeats the same
  request once; the Service never waits.
- **5d Audit.** `sensitive_operation_audit_events` for every decision
  (succeeded, failed, rejected, confirmation_required, declined), with source
  kind `task_credential`, `web_session`, `cli_credential` or `center_agent`;
  owner-only read on the MemberAgent detail
  (`/v1/organizations/current/member-agents/:id/sensitive-operation-audit`).
- **Gated operations.** Binding ensure, disable, model, permission mode,
  collaboration mode, OpenCode permission; creation defaults; default
  Project (both receivers); working folder (current, people-computer,
  bound); work recovery; execution mode write; agent interaction answer;
  delete Space; add the caller's own Agent to a Space; agent access decision
  and revoke; Direct Message Session archive and delete; Agent Profile
  deletion (Auth asks Core's gate through `ProfileLifecycleEntrypoint`);
  Center Agent runtime-settings write (root checked at the tool boundary,
  audited as `center_agent`).

## External review

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox
  read-only`), twice. The first run was stopped by the provider's content
  filter midway; its findings up to then are included. The second run used
  code-review wording and reviewed `2612127c6..7d02e0784`. Both ran isolated
  in-memory Better Auth probes.

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| R1 | The response that marks a session can still carry an unmarked cookie-cache cookie (cache lives one day), so a replay counts as an interactive session. | Yes (reproduced by Codex; Better Auth `getSession` reads `session_data` first) | Fixed. Ordinary requests keep the cached path; `buildCoreRpcCredential` re-checks an interactive session through Auth's `resolveRequestCredentialKind` (database, no cache) before every sensitive operation; Auth's deletion guard re-reads the marker. Fails closed. |
| R2 | Direct Message Session archive and delete skipped the gate. | Yes | Fixed (`session_archive`, `session_delete`). Rename and unarchive stay ungated. |
| R3 | Narrowing the window to the task credential's Service runtime missed another Service lane on the same computer. | Yes (found while Codex ran; Codex confirmed the fix) | Fixed: the window is owner-wide for every credential. |
| R4 | The interactive-only endpoint guard read the session through the cookie cache, so a marked session could still use Electron transfer and mint a new interactive session. | Yes (reproduced by Codex) | Fixed: the guard reads the stored session by token (`internalAdapter.findSession`). |
| R5 | Sessions that existed before the migration carry no marker; a `setup --ott` CLI token sent as a cookie passes until the CLI's next Bearer use. | Yes, scoped | Accepted. A colleague-rooted task only exists while the owner's Service runs, and the Service authenticates with that token as Bearer, which marks it. Marking runs even with the program off, so sessions are classified before enforcement starts. |
| R6 | A failed Profile lookup turned Auth's deletion guard off. | Yes | Fixed: a lookup error answers 503. |
| R7 | The plugin refused endpoints with `MEMBER_AGENTS_ENABLED` off. | Yes | Fixed: refusing waits for the flag; marking stays on (see R5). |
| R8 | A repeated command polled its own new handle while Core reused an older pending confirmation. | Yes | Fixed: the refusal message names the confirmation (`formatCredentialConfirmationRequiredMessage`), the CLI polls that id. |
| R9 | The CLI's Agent Profile deletion used a direct fetch without the task credential or the confirmation wait. | Yes | Fixed (`openmeld-profiles-api.ts`); sensitive-operation refusals are no longer reported as sign-in failures. |
| R10 | Center Agent runtime-settings changes wrote no audit row. | Yes | Fixed: audited with source `center_agent`, root = the represented member. |
| R11 | Auth's deletion audit had no root for Web and CLI sources. | Yes | Fixed: the caller's primary Human Profile. |
| R12 | Missing credential facts and a failed root lookup threw without an audit row. | Yes | Fixed: both write a `rejected` row (missing facts count as the CLI credential). |
| R13 | A failed success-audit write turned a completed change into an error; Auth swallowed its audit failure. | Yes | Fixed in Core: the operation's result stands and the failure is logged (`core.sensitive_operation.audit_failed`). Auth logs `auth.sensitive_operation.audit_failed`; a durable retry is a follow-up. |
| — | A task credential resolving to another root (redelivery, superseded runs, missing heads, another owner's shard). | — | None found. |
| — | A Gateway route calling a wrapped method without `requestCredential`; a Service-frame bypass. | — | None found. |
| — | Confirmation reuse across operation, caller or Organization. | — | None found. |
| — | Execution token in logs, the shared request context or server storage. | — | None found. |

Also checked by me: `/list-sessions` returns the user's raw session tokens
to a Bearer caller. A raw token works only as Bearer (a cookie needs the
server's signature) and that use marks the session, so it cannot become an
interactive session. Not changed.

## Checks

- Builds: `turbo run build` for schemas, gateway-contract, db, auth,
  api-client and Core/Gateway/CLI dependencies.
- Typecheck (`tsc --noEmit`): services/core, services/gateway,
  services/auth, packages/auth, clients/openmeld-cli, clients/web.
- Core (`LC_ALL=C node ../../tooling/postgresql/local.mjs run pnpm exec vitest run --config vitest.config.ts …`):
  sensitive-operation-credentials (12), runtime-transport-runtime-coordinator-contract (395),
  agent-access-consent, center-agent-request-chain-root, center-agent-product-operations,
  center-agent-rpc-surface, organization-rpc — 618 passed.
- Gateway (`vitest run tests`): 635 passed; 3 failures that also fail
  without this branch's Gateway changes (dispatch trace version, AccountSpaces fields).
- Auth: services/auth 199 passed, 2 failures that also fail without this
  branch's Auth changes (profile lineage error, db-facts env); packages/auth
  cli-credential 6 passed.
- CLI: sensitive-operation-credentials and profiles API tests pass; the full
  suite's 22 failures are unrelated (18 spot-checked identical without this
  branch's CLI changes).
- Web: inbox, member-agents and agent-access component tests pass except one
  pre-existing source-target route expectation.
- Note: local tests need `LC_ALL=C` for the ephemeral PostgreSQL on macOS.

## Program corrections (for the designer)

1. §4.7 item 1 says the task credential "carries" the request chain. It is
   bound to it instead: the credential is the execution token and Core reads
   the chain from the execution's accepted assignment. A copy inside the
   token would be a second authority path.
2. §10 / brief "Core verifies it on every task-originated call": verified at
   the sensitive-operation boundary only. Other calls ignore it (zero cost;
   nothing else consults it).
3. §6 should list: Direct Message Session archive/delete, Agent Profile
   deletion through Auth, add own Agent to a Space, and the Center Agent
   runtime-settings write as audited (`center_agent` source).
4. §4.7 item 3 should say the window also covers an owner-rooted task
   credential (another task of the same OS user can read it), and that it
   is owner-wide, not per computer (decision 5a0).
5. §13 Desktop "in-App" item can close: no local port; the Desktop uses its
   own interactive session like Web.
6. MemberAgent archive has no write path yet; gate it when it lands.
