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
