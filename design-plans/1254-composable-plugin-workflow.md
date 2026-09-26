# #1254 — Composable Plugin setup and execution

Status: Draft review corrections in progress, 2026-09-26. F1/F2/F3/F4/F5/F6 have source/projection and continuation corrections; focused validation is recorded in the PR. F7/F8 and independent acceptance remain open.
Discussion: https://github.com/amplifthq/openmeld/pull/1254

## Agent context

- Purpose: Keep the remaining #1254 work and its acceptance in one implementation
  PR, as the owner requested, without duplicating work already owned elsewhere.
- Read this when: Continuing or reviewing this branch.
- Update this when: An implementation slice or its exact validation changes.
- Source of truth: This is a temporary delivery checklist, not another product,
  permission model, task registry, or release authorization. The existing product
  and architecture owners remain authoritative. Distill accepted behavior into
  those owners before retiring this plan.

## Product outcome

A member asks an Agent to do useful work. When an authorized capability needs
setup, the member can open the existing Plugin connection form from that
conversation, authorize with the provider, and return to the same work. The
Agent remains responsible for strategy and task decomposition. The harness must
preserve account selection, permitted audience, committed effects, evidence,
and final delivery. A connection, permission grant, completed operation, and
completed user request are different facts.

The owner now wants one implementation PR for this work. This supersedes the
previous review's recommendation to create several follow-up PRs; it does not
turn already merged work into a new backlog or authorize a production rollout.
The frozen general hosted-workstation boundary remains in force.

## Reuse and boundaries

| Responsibility | Existing owner / implementation |
| --- | --- |
| Which Plugin can be offered | Shared supported-service contract and the Web Plugin catalog |
| Which connection form to render | `PluginConnectionSurface`; existing GitHub and App adapters |
| OAuth, installation, credential form, expiry, cancellation, reconciliation | Existing connection cards, authorization browser and connector APIs |
| Member versus shared setup permission | Current member identity and Core's existing connector authorization |
| Which Agents may use the connection | Existing Plugin access policy and its editor; never an implicit setup grant |
| Message action | Existing typed navigation action and final-reply publication |
| Work admission, idempotency, cancellation and completion | Existing execution, operation and native-delivery owners |
| Files and immutable revisions | Existing Space Files and the in-flight #1318 Files implementation |

Do not add a second OAuth state machine, task scheduler, permission store, or
unrestricted executor. A provider authorization window is still required for
OAuth or GitHub installation. "Stay in the conversation" means the OpenMeld
page remains in place, not that the Agent bypasses provider consent.

## Setup behavior

- An explicit member or shared identity is preserved. Setup must not silently
  fall back to another account after an error or a status refresh.
- For unspecified setup, reuse a relevant existing connection view. With no
  connection, an ordinary member gets personal setup; an owner/admin in a
  collaborative Organization can choose personal or shared setup. A Personal
  Workspace does not need the collaborative choice.
- Clicking an action or choosing its scope does not authorize anything. The
  existing Connect/Install action starts the provider flow after a user gesture.
- The person opening a shared message uses their own current identity, not the
  author's or the person who previously installed a Plugin. Cross-Organization
  or unavailable-context entries fall back to the trusted navigation link.
- Provider-side role and repository access remain separate from OpenMeld roles.
  A missing repository grant must not be described as an absent connection.
- Credentials use the existing private form or external authorization window;
  no secret, authorization URL, or credential is stored in the message action.
- Agent access is an explicit, lazily opened existing editor. Connecting never
  enables all Agents or changes read/write permissions automatically.

## Implemented first slice

- Shared Plugin connection surface reused by the Plugins detail page, Onboarding
  and a lazy conversation dialog. GitHub's installation/user flows remain in
  their existing adapter; OAuth and advanced credential forms remain in theirs.
- `plugin_connection` navigation target with an exact supported service and
  explicit `member`, `shared`, or `choose` setup intent.
- Conversation identity and role checks, existing-connection reuse, private
  credential handling, provider flow cancellation/expiry, and lazy Agent access.
- Center Agent action creation and missing-GitHub-connection recovery use that
  target. Personal Hosted Agent navigation exposes only Plugin setup, not the
  Center Agent's other navigation/identity-link capabilities.

### Resumed implementation checkpoint

- Old-reader publication now uses ordinary Markdown links. The typed setup
  target remains private to the Hosted context; current clients enhance the
  verified link instead of requiring old message readers to accept a new union.
- The original human can explicitly continue a delivered Hosted Space request
  through the existing idempotent Message/Wake operation, preserving the original
  Thread and Agent. Core rechecks identity, membership and Plugin access,
  includes bounded operation receipts and blocks pending/unknown outcomes.
- Computer identities are audience-scoped, with current Core authorization
  before workspace access and before releasing read/browser output. Legacy
  shared content is not automatically migrated to new audiences.
- Large results have immutable, expiring, atomically bounded snapshots and a
  shared read/search tool, including Code Mode inner calls. Source connection
  metadata is host-owned and reauthorized, not accepted from provider JSON.
- Generic App selection failures now offer the same setup entry, without
  claiming that every unavailable selection means a disconnected account.
- Two recovered local commits implement the designated-Center Wake requester
  check and independent per-file audit identity. They do not complete all of
  #1293 or supersede its remaining work.

- Controlled GitHub snapshot checkout and publication now compose with the
  existing Computer and Draft PR tools. Real native Git tests verify binary
  data, modes, symlinks, complete-tree identity and retry without resetting edits.
  Publication tests verify selected-account use, fixed branches, concurrent
  retries, cancellation, changed parents and reconciliation after lost replies.
- Imported repository provenance is retained with the Computer and rechecked
  for ordinary access, including after Git-operation expiry.
- A narrow connector ingress delegates to reviewed upstream authentication;
  general HTTP/MCP proxies remain blocked. No production grant was changed.

Real provider authorization, installed Desktop, process/cancellation/export
isolation and full end-to-end continuation acceptance remain outstanding. This
is a code/test checkpoint for independent review, not a claim of live delivery.

## Independent acceptance in this same implementation PR

### A. Complete and accept conversational setup

- Prove the final callback-to-message path, the real Web/packaged Desktop dialog,
  narrow windows, failure/retry and authorization return without changing the
  user's active conversation. Use disposable test accounts; no silent changes
  to existing production connections.
- Cover provider-specific denied/revoked/missing-repository access without
  recommending unnecessary reconnection. General App failures can use the same
  typed action once their exact remedy is known; do not classify arbitrary
  provider errors by message keywords.
- Integrate other eligible Agent carriers through their existing output and
  identity contracts. Do not claim Local Agent or external-channel coverage
  merely because a Hosted tool exists.
- Accept the implemented explicit return-to-work action through the existing Message/Wake owner.
  Bind it to the current authorized member, exact conversation/thread, original
  task and intended Agent. Reconcile the existing operation receipts before
  resuming; never replay completed writes or manufacture a successful task from
  an OAuth callback. Cancellation, a changed audience, a stale request, and
  duplicate clicks must be handled. Do not add a generic workflow engine.

### B. Reader compatibility before producer rollout

The new target is a new member of a strict union, not a harmless optional
field. Older `normalizeMessageEnvelope` readers throw on an unknown target.
Therefore this branch must not enable a producer against those readers merely
because the URL has a fallback or the CLI version constant is unchanged.

The implementation now avoids the incompatible wire variant: the Hosted callback
contains ordinary reply text plus a canonical link. Web enhances only a validated
same-origin/current-Organization final link, and old readers continue to parse
ordinary text. Contract and message regression tests cover this seam. Complete
installed mixed-version Desktop and rollback acceptance before Ready; never
publish a raw new navigation variant simply because it has a fallback URL.

### C. Audience-isolated Hosted execution (#1321)

The implemented audience includes Organization, Agent, Binding, conversation,
Space and admitted principal and selects a separate durable Computer. Core
rechecks the current delivery and original authority owners. Finish real
container/process, cached-result, cancellation and authorized-export acceptance;
unit tests of identity derivation do not prove every external runtime boundary.

Do not copy the legacy shared Computer's files indiscriminately into new
scopes. Record retention/removal and intentional transfer behavior, and test
revoked access and cross-DM/Space reads. #1321 is a tracked decision, not a
proven production credential leak. No raw Git credentials or executable Skill
scripts enter the shared shell before the required boundary is proven.

### D. Authorized result continuation

Keep the current 128 KiB presentation limit and truthful operation receipts.
Prefer upstream paging; where received data can be retained economically,
reuse existing result/read or file infrastructure with exact scope, lifetime
and immutable identity. Do not automatically publish private logs to Team
Files or invent another operation ledger.

A model and Code Mode script now receive a bounded result with a continuation
when the full received JSON was retained. The read/search path is execution-
scoped and source-reauthorized. Tests cover a unique middle error, Unicode,
expiry, denied readers, concurrent quota and successful writes that execute
only once. Complete live provider acceptance. Provider-side truncation remains
distinct from OpenMeld presentation truncation; JSON above 8 MiB is not retained.

### E. Controlled private-repository access

Reuse the chosen Plugin connection and its current grants. Select an exact
repository/ref and authorized output audience. Keep authentication in a trusted
operation rather than exposing a raw reusable credential to model-controlled
commands. Repository access alone does not enforce a task-branch policy;
check the actual write path. Cancellation/revocation is not just waiting for
natural token expiry.

Prove checkout, multi-file editing, focused tests, commit, branch-restricted
push and PR update with exact source/tree evidence. Dependency scripts are
untrusted. Reject an unauthorized branch, revoked grant or foreign audience;
never force-push or expand repository access implicitly. The Agent may still
choose an API edit or an eligible Local Agent instead. Do not impose a fixed
coding workflow or silently unfreeze a general hosted-workstation platform.

The implemented working copy is a verified snapshot with synthetic local base
history. It does not promise full clone/history, LFS downloads or submodule
checkout. Confirm that this is sufficient for the actual repository's build
scripts; unsupported requirements must be reported rather than hidden behind
a green tiny-repository fixture. Read the concrete size/batch bounds in the
runtime owner. The token's GitHub proxy grant and the reviewed connector overlay
must be present in the isolated test lane before live private-Git smoke.

## Existing work: integrate, do not duplicate

| Item | Disposition |
| --- | --- |
| #1247 Space ownership | Merged; keep its represented-member and retry semantics. |
| #1266 creation, executable GitHub catalog, truthful bounded output | Merged; do not reopen that accepted scope. Full large-result continuation was deliberately not promised. |
| #1315 toolchain and private preview | Merged; no new Computer/toolchain platform is needed for this slice. |
| #1293 delegation/file audit/failure attribution | This branch corrects the designated Center requester check and uses independent file-read audit IDs in their existing owners. The broader #1293 work retains its owner; do not absorb its unrelated image-policy work. |
| #1318 Files/Skills | Existing Draft implementation; consume its accepted file interfaces. Its latest reported Team read/save smoke is not missing, but binary/on-demand/private-scope work remains partial. |
| #1304, #1311, #1312, #1316, #1317 | Existing delivery, progress and reliability work; preserve specific boundaries rather than replacing their owners. |
| #1303 | Closed unmerged research, not a completed implementation. |
| No-diff Draft PR | Explain the provider limitation; no new product machinery. |
| Atomic multi-file API fallback | Consider only a supported integrated-provider action; not a replacement for testable repository access. |

## Acceptance and evidence

| Scenario | Required result |
| --- | --- |
| Member, owner/admin, personal workspace | Only permitted setup choices; explicit scope always wins. |
| Existing connection, pending authorization, denial, cancellation, expiry | Accurate current state; no duplicate authorization or identity fallback. |
| GitHub, ordinary OAuth, credential-backed Plugin | Same owning operations as Plugins/Onboarding; credentials absent from chat. |
| Agent access | No implicit grant; current server policy governs every execution. |
| Old and new readers | Message, mention, thread and safe action presentation survive mixed versions. |
| Authorization then continuation | Resume the exact eligible task, never repeat committed effects. |
| Private DM versus shared Space | No cross-audience filesystem, process, credential or result access. |
| Large result | Relevant middle content available only when actually retained and authorized. |
| Private Git | Exact ref/tree, targeted verification, restricted destination and attributable receipt. |

At the initial checkpoint, shared navigation tests passed 14/14 and the six
focused Web files passed 110/110, including the Agent-access lazy-read/no-grant
regression. The schemas package build, formatting, strict documentation checks
and Changelog validation passed. The broad dependency build timed out while
waiting on local resource admission under warning OS memory pressure; it did
not execute the build. Web typecheck reported missing workspace outputs and
one test import path, which was corrected. Remote Agent's three focused test
files failed during collection because workspace packages such as
`@openmeld/agent-runtime` had no built entry; no Remote Agent tests ran. These
are outstanding gates, not passing tests. Record subsequent exact results in
the PR rather than turning this checkpoint into final-head certification.
The resumed implementation passed 399 focused Remote Agent tests, 114 focused
Web tests, and 28 Core boundary tests. The private-Git slice adds native Git,
provider/proxy, publication/reconciliation, data-provenance and public-wire
guards; its exact final counts and build results belong to the PR checkpoint.
Web, Remote Agent, Core and Gateway typechecks have passed during this work.
These results supersede the initial missing-workspace-output blockers for those
checks; they are not authenticated provider, installed Desktop, or production
evidence. End-to-end acceptance remains open.
Keep the PR Draft until its accepted scope and compatibility gates are complete.
