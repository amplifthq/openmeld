# Organization Agent ownership

The managed Center Agent has one Organization owner, including in a Personal
Workspace. Auth stores `organization_id` and a null `owner_user_id`; its hosted
Binding uses `owner_kind = organization` and the same Organization ID. Ordinary
Agent Profiles retain personal ownership. Creation and designation actors are
nullable historical attribution, not access authority.

Native execution authenticates as the designated Agent Profile. It does not
borrow an administrator account or use a personal RuntimeCoordinator shard.
Member-scoped actions require the verified speaker carried by the admitted
turn. Controller-task discovery and watches use that member's current authority.
Organization management does not grant private Space or conversation access.

## Migration and lifecycle

Migrations 0162–0164 preserve Profile IDs, Binding IDs, settings, designation,
Space history, and dependent records. Profile reconstruction must preserve
dependent rows with foreign keys enabled; it must not create deletion outbox
records. Deleting the creation or designation account leaves the Center Agent
and its paused state intact. Deleting the Organization enters the existing
profile-deletion reconciliation flow with Organization ownership and cancels
native deliveries rather than contacting a former owner's local runtime.

The shared Space index clears Center Agent personal-owner snapshots during the
migration. Existing Space Durable Objects clear the same membership and creator
snapshots before admitting requests. A changed access snapshot closes restored
WebSockets so reconnect must pass current authorization. No Human membership or
personal pin preference is synthesized. Actual Human members retain normal pin
behavior; a saved preference alone never grants access.

The fixed hosted target uses the common idempotent Binding writer. Runtime
bootstrap must reject incompatible ownership instead of moving a Binding
between user accounts. Data migration is the only ownership rewrite.

## Contract impact and release constraints

- Auth Profile facts/views, organization directories, designation audit fields,
  profile-deletion events, and Remote Agent submission owner fields now permit
  Organization ownership without a personal user. New readers accept old
  personally owned records during preparation. New Center Agent tool callers
  use the Agent Profile principal; old Core receivers do not accept that caller.
- The CLI command contract is updated because an old strict directory decoder
  rejects a null personal owner. The eventual CLI release must mark the CLI
  component `required`. Its release package and manifest are stamped in the
  separate release lane, not this feature branch. Existing Service execution,
  Prepare, workstation Wake, dispatch-owned replies, trace, status, and recovery
  protocols are unchanged; no Service or skills epoch bump is needed.
- This is not a Web-only or live rolling database change. Pause new hosted
  admissions using the existing Center Agent Pause operation and cancel accepted
  native work before the ownership migration. This internal rollout accepts
  cancellation; it does not require a new graceful-drain mechanism.
  Keep admissions paused while updating the database, Auth, Core, Remote Agent,
  Gateway/Web readers, and the CLI release projection. Resume only after the
  complete fleet and published CLI support the new contract. Normal cloud order
  alone is insufficient: Core and Remote Agent have dependencies in both
  directions. The production release owner must arrange a coordinated window.
- Do not roll old Auth/Core code back over migrated ownership data. Retain the
  pre-migration backup and use a reviewed data rollback or a forward repair.
  Restoring personal-owner snapshots would restore the private-Space exposure.

No production migration or deployment is implied by local acceptance. The
workstation RuntimeCoordinator ownership rules remain unchanged; native hosted
Center Agent execution continues to use its existing separate execution owner.

## Internal rollout procedure

Use one approved batch release SHA and the guarded release lane documented in
[Production Release](../engineering/production-release.md). Do not execute these
production steps during local acceptance. Nighttime is not proof of zero work.

1. Before changing state, retain a read-only inventory joining
   `center_agent_designations` to `openmeld_profiles` on `agent_profile_id`,
   including Organization ID/name, Profile ID, `managed_role`, `owner_user_id`,
   `operating_state`, and pause attribution. Include Personal Workspaces.
   Compare all `managed_role = 'center_agent'` profiles and all
   `runtime_kind = 'hosted_center_agent'` bindings with that inventory; resolve
   orphaned or mismatched records before migrating. Record the initially active
   set separately from the initially paused set. Keep a pre-migration backup.
2. As a current owner/admin, select each Organization through the supported
   Web organization switcher and open Center Agent > menu > Center Agent
   settings > Pause, or run
   `openmeld center-agent status --json` and `openmeld center-agent pause --json`
   in that Organization's authenticated CLI context. Repeat Pause for initially
   paused objects too if they still have work; never overwrite the original
   state inventory. Prevent internal testers from creating Organizations,
   changing designations, or resuming agents during the short release window;
   recheck the inventory immediately before migration. There is no global lock.
3. Pause persists first, then requests cancellation. `affectedTaskCount` and
   `cancellation_requested` are acknowledgements, not completion. Inspect the
   native-delivery ledger for each inventoried Profile, retaining delivery,
   submission, idempotency, Space and runtime-conversation IDs. Include
   submitted/accepted/retry-observed rows even without a submission ID: reconcile
   unknown admission outcomes rather than treating them as absent. Resolve each
   submitted execution through Remote Agent `readExecutionState` using its exact
   identifiers; require a terminal completed/failed/cancelled state and its
   terminal Core projection or explicit diagnostic reconciliation. These are
   internal diagnostics, not user smoke. Recheck for late admissions after
   cancellation settles. Missing execution, identity mismatch, unavailable
   receiver, `center_agent.pause_incomplete`, unknown outcome, or a nonterminal
   execution stops the release while the agent remains paused. Retry the
   existing Pause/reconciliation path after fixing the cause; never edit ledger
   rows to manufacture an empty queue.
   Older Core callers may fail here because they rebind the Workers RPC
   `cancelExecution` method with `.bind(worker)`. This PR fixes both Pause and
   the post-admission fence by invoking the proxy directly. Do not migrate just
   to obtain that fix: before the migration, use the existing per-task Stop
   control where available (Space `openmeld space wake-stop <space-id>
   --client-message <id> --target-profile <profile-id>` invokes cancellation
   directly), with the task's authorized member. Reconfirm terminal state and
   retry Pause. If any source lacks a working supported cancellation path,
   keep the release stopped; the batch owner must arrange a compatible
   preparatory fix or wait for a verified terminal outcome.
4. Keep every inventoried agent paused throughout migration and deployment.
   Execute the guarded `db` scope first. Migrations are committed **one file at
   a time**, not as one transaction covering 0162–0164; an interrupted later
   file leaves earlier files applied. Keep old writers unused throughout the
   window, inspect the pending list, and resume the guarded migration instead
   of restoring personal owners. Verify Profile/Binding IDs, human pins,
   designation state, audit/context associations and conversation generations;
   no migration-created deletion outbox rows are acceptable.
5. From the same release SHA, deploy guarded `auth`, then `remote-agent` scopes;
   publish the required compatible CLI through its normal signed release lane.
   **CLI publication deploys Core itself** and verifies its R2/npm/Core
   projection, so do not schedule an earlier standalone Core deploy against the
   old CLI channel. Deploy `gateway` and `web` after that succeeds. Use explicit
   scoped guarded calls, rather than assuming `cloud`/`full` order fits this
   migration: local full runs D1, CLI/Core, then other Workers, and cloud's
   default order is Auth, Web, Gateway, Core, Remote Agent. The paused window
   permits the intermediate mixed versions; they are not a supported live
   configuration. The batch owner owns version/manifest stamping and exact-SHA
   validation. Keep automatic health and version/channel alignment checks.
6. Verify current designation identity and paused state still match the
   inventory. Only after every component and required CLI projection is ready,
   resume the originally active set using the same supported management entry.
   Leave originally paused objects paused. Cancellation is terminal: Resume
   permits new work and does not replay the cancelled task. This rollout's user
   instruction excludes production product smoke; report that omission
   separately from automatic health/version checks and local acceptance.

### Coverage of the existing pause fence

Core's shared `submitRemoteAgentWorkerAdmission` checks the designated Profile
before quota/worker submission and again after acknowledgement, cancelling an
admission that races Pause. Space/DM deliveries, Message Channel deliveries,
delegated tasks, Routines, recovery submissions and conversation rollover use
this admission boundary. Delegated target resolution also rejects paused
designations; Center Agent tool authority checks operating state. Recovery is
not permission to bypass Pause. The cancellation scan is scoped to Organization
and designated Profile, including its different conversation sources.

This is **not** a pause of personal Remote Agents, workstation agents, or all
Organization mutations. Personal Remote Agent ownership and owner-observer
access remain unchanged. If internal activity cannot be kept inside the stated
window, stop and reassess rather than claim this per-agent control is a global
maintenance mode.

For the normal signed CLI lane, the release owner can dispatch and wait for
each of these guarded workflows in sequence, always using the same approved
`RELEASE_SHA` (a full first-parent main SHA):

```sh
gh workflow run release-on-main.yml --ref main --field scope=database --field release_sha="$RELEASE_SHA"
# Wait for success, then repeat this scoped workflow for auth, then remote-agent.
gh workflow run cli-release.yml --ref main --field release_path=normal --field release_sha="$RELEASE_SHA"
# Wait for signed CLI, required floor, and Core projection success.
# Repeat release-on-main.yml for gateway, then web; wait for each result.
```

Do not launch the next stage on dispatch acknowledgement alone. A guarded
preflight failure or channel mismatch is a stop, not permission to use a raw
Wrangler deploy. The equivalent local scopes are supported only from a clean
dedicated release worktree with the required signing credentials.
