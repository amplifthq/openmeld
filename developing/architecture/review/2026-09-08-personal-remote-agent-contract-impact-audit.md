# Personal Remote Agent Contract Impact Audit

## Changed boundaries

Ordinary Agent creation accepts `hosted:remote-agent` through the existing
creation request. Its primary Binding uses `hosted_remote_agent`, stores the
per-Agent model, and has no local Service or provider conversation ID.
Core-to-Remote submissions use the existing V4 envelope with an explicit
`personal_agent` identity and trusted Space dispatch context. A private Core
RPC provides current-conversation messages, membership, and explicit Wake.
The model cannot choose an Organization, owner, or destination Space.

Local runtime leases, setup, Prepare, Service transport, dispatch-owned Space
actions, and local execution finalization do not change. Existing Local and
Center Binding values and V3/V4 Center submissions retain their meaning.
Migration 0159 replaces only runtime-kind and hosted-identity validation
triggers. It preserves rows, indexes, and canonical ownership triggers.

## Mixed-version behavior and rollout

Old local clients continue their existing setup, Local Wake, Space actions,
status, and trace paths with new cloud services. New local clients can use old
cloud services for those same paths. Personal hosted execution is never sent
to a local Service. An old client does not gain personal Remote creation or
understanding of the new hosted kind; this feature is delivered through Web.
No local execution epoch, Service contract, or Skills version changes are
required. Shared package artifact changes still require the repository's
base-aware local-component release readiness checks.

Core's new personal submissions require the new Remote receiver. The new
Remote's personal collaboration calls require the new Core RPC receiver.
Existing Center traffic uses neither new personal contract. Deploy the
compatible Remote receiver first, then the guarded full staging
deployment (Database, Auth, Core, Gateway, Web, Remote). The first Remote deploy
continues to use only existing Center calls until Core can send personal turns.
Web exposes personal creation only after the backend receivers are deployed. Production must use
the guarded component sequencing to establish the same receiver-before-caller
relationship; a default release order is not sufficient evidence.

During rollback, remove the Web creation caller first. Existing personal
Agents require the new backend contracts, so retain compatible Core and Remote
versions for those Agents. Do not roll back to a Center-only backend after
personal Bindings exist. Retain the additive database validation migration.

## Ownership and acceptance

Space remains the membership, message, and addressing owner. Core owns
authorization, Binding/readiness, native-delivery identity, and publication.
Flue owns the native conversation runtime. Agent Profile plus Organization
plus Space determines personal conversation identity; sharing an owner never
merges conversations or stop targets. No Center memory, Computer workspace,
Organization administration, Channels, or Routines are granted to personal
Agents. These rules conform to the scoped transport, data, and shared-contract
owners; the hosted-kind wording in the first two owners is expanded in this PR.

Acceptance requires real Web creation and DM, two same-owner Agents exchanging
explicit Space Wakes, independent stop behavior, and backend rejection after
membership or Binding revocation. UI proof alone does not establish privacy or
authorization. Advanced session binding, fork, runtime migration, and personal
Routines remain outside this batch.

## Existing Agent surfaces

| Surface | Personal Remote behavior |
| --- | --- |
| Directory, profile, rename, ordinary DM, Space membership and mentions | Keep existing Agent Profile ownership and authorization. Display Remote and the selected model. |
| Creation owner | Self only; hide the Remote choice for another owner and reject such requests in Core. |
| Model | Select on creation and show the stored Binding model. No new post-creation model settings surface in this batch. |
| Computer, working folder, Default Project, local session attachment and controller permissions | Hide local controls; reject local Binding commands and Default Project mutations for hosted Agents. |
| Stop | Keep existing viewer permissions; derive the native execution control from accepted native delivery evidence. |
| Center settings, organization administration, Channels, Routines, memory and Computer tools | Do not grant the managed Center role. The personal runtime exposes only current-conversation messages, members and explicit Wake tools. |

## Development evidence

Local Web acceptance covered creation of two Agents with different models,
DM replies, same-owner A-to-B-to-A Space handoff, cancellation with independent
completion by the other Agent, and a subsequent reply from the stopped Agent.
The local stopped outcome was confirmed after reload. A private DM marker
was not disclosed in the Space; separate backend tests cover binding and
membership revocation and rejection of an alternate Space field.

Focused schema, runtime, readiness, native stop, personal tool and migration
tests accompany the change. Local-component release readiness uses the
documented feature-branch deferred mode; the eventual release must stamp the
new Service artifact. No production deployment is claimed.

## Staging acceptance

On 2026-09-08, the guarded receiver-first deployment applied migration 0159
and deployed Auth, Core, Gateway, Web and Remote from `a369b1127`. The full run
stopped at Web's 3 GiB Node heap limit; the guarded Web-only retry succeeded
with a 4 GiB heap and an 8 GiB aggregate process cap. No local Docker was
started; the unchanged existing Computer container was retained explicitly.

Remote version: `fefa7f9c-7a05-4f74-912a-db1e9cfa0f48`; Core:
`77f5ed19-30a5-4897-97c1-6424a49b8c18`; Web:
`285c3555-0bdf-4ab8-a4fa-1ccb1a528e66`. Guarded resource and public-entry checks
passed. Real Web acceptance in the dedicated
[Personal Remote Acceptance 908 Space](https://staging.openmeld.ai/o/work-coordinator-v2-staging/spaces/405834ca44225bbf67e1f57082c0f0db2bf5a0d2e02ee62c7a1810831e85f736)
covered:

- Creating GLM and DeepSeek Agents under one owner, with the persisted model
  shown on each profile and both listed alongside existing Local Agents.
- Initial DM response and private-marker recall after reopening that DM.
- Actual A-to-B-to-A Wake handoff with the full review returned.
- Stop confirmation appearing without refreshing the page, an independent
  reply from the other Agent, and a subsequent reply from the stopped Agent.
- The private DM marker remaining unavailable in the shared Space.
- A separate Center Agent conversation returning the exact requested marker
  against the updated backend.

This does not claim a real Local Agent execution on the feature branch or
Computer-container behavior beyond preserving the existing deployment.
