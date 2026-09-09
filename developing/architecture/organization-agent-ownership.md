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
  admissions and drain accepted native work before the ownership migration.
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
