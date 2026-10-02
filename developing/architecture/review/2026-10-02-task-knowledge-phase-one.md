# Task Knowledge Phase One: Delivery Evidence

## Agent Context

- Purpose: Record the implementation boundary, reproducible evidence, and remaining acceptance gaps for the phase-one memory and task knowledge change.
- Read this when: Reviewing PR #1429 or continuing its isolated runtime acceptance.
- Update this when: A listed acceptance gap is verified or a review changes the implementation.
- Do not use this for: Production readiness, provider quality guarantees, or authorization to publish organization knowledge.
- Source of truth: The linked source owners, executable tests, and exact observations below.
- Removal condition: Remove this review record after independent acceptance; retain stable contracts in the product owner documents and final evidence in the PR.

Status: Draft implementation; independent-review corrections implemented, human-source Remote regression and Center blank-session automatic recall verified. Local setup recovered; delegated model and Local Wake acceptance still lack an authorized dev admission context.

## Scope And Ownership

Base: `7864a7641beb30377a28578c8163400361450fd3`. Worktree:
`/Users/felix/Desktop/work/openmeld-worktrees/knowledge-phase-one`, branch
`codex/knowledge-phase-one`, draft [PR #1429](https://github.com/amplifthq/openmeld/pull/1429).

Memory remains a hint. Approved documents and immutable Skill releases retain
their existing Core owners and authorization. The task directory is a bounded
read projection, not a stored knowledge object or a new permission service.
Personal Remote continues to exclude the Center-only protected prompt and
Computer projection. Its ordinary approved document read uses the existing
ordinary read RPC with its admitted receiving Agent identity. Local dispatch reads as its owned active Agent Profile and
never changes an ordinary task's working directory or global Skill installation.

Automatic capture now exits for organization-shared and externally-shared
environments before provisioning or writing either scope. Private callbacks and
explicit authorized team saves retain their existing writers. No old records are
deleted, settings migrated, graphs rebuilt, or additional extraction model added.

The directory uses a 6,000-character starting display budget. Omitted counts cover
only visible metadata. Full list/read tools remain available. Full frozen Skill
selections and Flue mounts are preserved; description clipping is display-only.
Instructions and resources keep their exact release/digest. A revoked future read
is denied; this does not claim to remove material already read by a model.

## Contract Impact Audit

- Changed boundaries: additive Local dispatch read tools and an optional
  `organizationSkillReleases` field in the existing dispatch action context;
  owned-Agent read authorization on existing document/Skill APIs; Remote prompt
  composition and an exact-selection catalog search tool.
- Review correction: the existing document-read RPC now accepts an omitted
  `speakerMember` only for Core-verified personal Remote deliveries. Center
  callers retain the required verified-speaker behavior. Deploy Core before
  Remote: an older Core rejects the new omitted-speaker request; it does not
  silently grant access. Existing callers with a speaker remain schema-valid.
  Responses and document writes are unchanged. The matching CLI/Service bundle
  owns the full MCP catalog, including both knowledge readers; delivery-only
  remains exactly reply, silence, and receipt. Arbitrary tools are still rejected.
- Setup follow-up: the existing device-auth client resolver now derives its
  default from the active lane (`dev-local` uses `openmeld-cli-dev`). CLI and
  environment overrides retain precedence. This fixes packaged Setup redemption
  against the already-existing Web/Auth contract; no wire field, accepted client
  ID, authority, compatibility floor, or epoch is added.
- Unchanged boundaries: Wake transport, final Space action envelopes,
  RuntimeCoordinator ownership, service status, trace, diagnostics, and rescue
  commands. No new RPC method, database migration, or contract enum. The optional
  read-request field described above is a real shared-schema change.
- Old cloud with new local: unsupported approved-document Agent reads return a
  visible unavailable directory; ordinary tasks still run. Existing exact Skill
  release reads retain the old API shape. No fallback to a human/Center identity.
- New cloud with old local: old tools and callbacks retain their payloads. Old
  local components do not gain the new directory but remain capable of existing
  setup/Wake/reply work. Optional dispatch context data is local to the matching
  preparation/tool-server pair; old contexts parse as no automatic selections.
- Rollout: Core read behavior before Remote caller deployment. The CLI and
  Service are stamped `available`; neither compatibility floor nor epoch changes.
  This PR does not deploy, merge, or publish a binary.
- Architecture check: no scoped architecture owner is displaced and no second
  source of execution, identity, readiness, publication, or authorization truth
  is introduced. Existing member authority remains the owner of knowledge reads.
  The prior audit missed stale text in shared-contracts: it incorrectly allowed
  shared automatic organization capture. This PR corrects that owner text to
  match private-only automatic capture and separate explicit team saves.

## Independent Behavioral Expectations

The following expectations come from the accepted product contract, not generated
answers. Passing a deterministic boundary test does not certify model behavior.

| Scenario | Evidence / current limit |
| --- | --- |
| Six personal candidates still leave room for eligible team facts | Final envelope tests, including long text; baseline failed before the fix |
| An old process self-report does not justify suppressing all team context | Final-envelope noisy personal candidate control; no semantic extractor claim |
| A short recurring private preference can persist | Private callback tests; real Center turn observed; subsequent search recorded separately below |
| Long casual conversation may produce no useful new facts | Not established by this PR's live sample; no forced minimum extraction count |
| Plans and unadopted suggestions are not completion/decisions | Center and personal Remote correctly classified planned migrations; unadopted-suggestion holdout remains pending |
| Current approved document B outranks remembered A; historical A remains historical | Center and personal Remote read and applied updated B; separate historical-A question remains pending |
| Shared Space/Channel chat writes neither scope | Memory service tests across trusted environment/source variants |
| Explicit team save works when enabled and does not enable itself when disabled | Existing writer tests retained and passed |
| Mid-query deletion or opt-out prevents injection | Real Workerd/D1 integration tests; persisted rows remain unchanged by recall |
| A deleted subject is not revived by reading | Real Workerd/D1 integration and service tests |
| Unknown validity is unknown; record time is not approval time | SDK adapter metadata tests; no historical record deletion |
| Missing answers and uncertain same-name projects are not guessed | Guidance; model holdouts pending |
| Document refresh failure never uses cached protected content | Concurrent caller, denied refresh, malformed/wrong-org tests |
| Ordinary Agent can read approved body, not draft or management capability | Core document integration tests; personal Remote's Center-only context remains disabled |
| Directory omission does not uninstall an admitted Skill | Bounded display test, exact catalog search test, existing Flue activation test |
| Publishing a new Skill does not replace a frozen release; disablement denies reads | Core persisted-release integration, catalog read tests, and live personal Remote observations below; live Center/Local pending |
| Explicit authorized saves need no repeated approval; unadopted proposals do not take effect | Existing tools retained, shared guidance; full natural-language holdout pending |
| Private data and handoff references do not grant unrelated action authority | Existing identity/audience boundaries retained; full three-runtime privacy/action holdout pending |

## Commands And Observations

All commands run from the owned worktree. Local logs are in `dev-tmp/` and contain
no production evaluation data. They are not runtime dependencies.

```sh
pnpm dev:doctor
pnpm dev:worktree
pnpm dev:account
pnpm dev:seed
pnpm dev:web:worktree
npm exec --yes --package bun@1.3.14 -- pnpm cli:binary:serve:worktree
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm check:affected -- --concurrency=2
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm verify:release-ready
pnpm changelog:check
pnpm verify:docs -- --strict
```

Doctor: 13/13 required dev secrets available. Affected checks: 33 tasks passed.
Release-ready: packaged CLI build, 65 release contract tests, and manifest
verification passed. The official Windows helper artifact was verified against
the current source fingerprint. Changelog validation passed. A misplaced owner
document introduction was caught by strict docs validation and moved below its
required Agent Context block; the rerun passed.

Focused checks include memory service (31), SDK adapter (6), native completion
(127), Core documents (39), Core Skills (37), D1 memory (3), Remote document
refresh (5), Remote Skills (6), personal Remote tools (3), shared directory (2),
Local paged reads (9), and memory setting UI (2). Counts identify observed runs,
not an acceptance quota. New files are also typechecked.

### Live Provider Holdout

```sh
OPENMELD_LIVE_MEMORY_EVAL=dev-synthetic doppler run --project openmeld-core --config dev -- pnpm --filter @openmeld/core exec vitest run --config vitest.boundary.config.ts tests-node/knowledge-memory.live.test.ts --maxWorkers=1
```

At `2026-10-01T16:40:07.915Z`, a fresh UUID-isolated fictional Cedar Kite member
subject received a preference for two-column weekly reports. The provider accepted
the write in 1,119 ms. The third bounded search found the preference with its
original conversation/message source after 13,550 ms. The runner deleted only the
subject it created. This proves live adapter write/extraction/search, not product
callback, injection, or correct subsequent model use. One sample is not p95;
provider billing is not exposed by this adapter, so cost is unmeasured.

### Product Entry Smoke

Lane `wt-e7ed328ad1a0`, Web `http://wt-e7ed328ad1a0.localhost:30240`, isolated
state under this worktree's `.wrangler-dev-state/isolated/` and `.turbo/dev/isolated/`.
Normal seeded-account sign-in and onboarding were completed. No production
private conversations, memory, or organization knowledge were used.

At approximately `2026-10-01T16:35Z`, the synthetic Northstar Product Studio Center
chat accepted a Maple Lantern three-bullet update preference and replied. At
`16:57:59.938Z`, a new normal Web turn produced a successful tool result with three
matching member-memory items, all attributed to original message
`c8276a26-d8ff-43b6-a8cf-1b5628785be6` at `16:35:18.139Z`, capture method
`automatic_turn`. Submission: `53919d9c-b039-4294-b0d0-e97debf19178`.
Read-only inspection of the isolated Flue tool-outcome record corroborated the
visible reply; no reasoning records were used. One returned item was an
"Assistant confirmed" process summary. This is observed extraction noise, not
fixed or hidden by the budget correction.

At `17:00:27.054Z`, an explicitly authorized normal chat turn successfully saved
the new approved document `org_document_3c71981e-5d53-477b-ac4e-852a8cc65d7e`, then
read its exact body at `17:00:30.169Z`. The approved `updatedAt` was
`2026-10-01T17:00:27.016Z`. Submission:
`226b4b9e-247c-4451-826a-8fb8203ee96a`. There was no second approval request.
These are synthetic dev objects, not changes to official organization knowledge.

The same normal Center chat authored and installed `maple-status-check` at
`17:03:42.478Z`: release `org_skill_release_129c4c63eaf948dd05c303ee49b07a1b`, digest
`973c7d6e1e4d4721a2da57b47eca08b1a27d71ef5bd997c4c7a07e7f85f58d96`.
Center holdout submission `74fb0ff3-746c-4b05-b987-0e24a6b5c752` activated it, read
`references/example.md`, read the approved document, and correctly reported the
completed accessibility review, unrun Friday migration, and unknown vendor date.
The tool outcomes occurred at `17:05:15.794Z` through `17:05:15.869Z`; the visible
answer used the new facts rather than the resource's sample facts.

A personal Remote Agent was created through **Team > Agents > Create Agent >
Remote Agent** in the same synthetic organization. Its first Web DM submission
`da2b9a3b-1e52-4631-b12e-dff4ff1196ef` activated the same release, read the same
resource (`17:09:20.727Z`), and used ordinary document list/get
(`17:09:24.274Z`). It correctly classified a different held-out case: completed
backup rehearsal, unrun Monday migration, and unconfirmed vendor delivery. Its
reply cited the exact same document revision and Skill release/digest. A local
screenshot is `dev-tmp/personal-remote-skill-smoke.png`; the tool outcomes, not
the screenshot alone, establish the reads.

Observed Flue stream durations were 12.414 seconds for the Center holdout and
14.584 seconds for the personal Remote holdout, excluding admission and final
publication. Summed per-response token telemetry was respectively 91,386 and
32,273 tokens including cache reads/writes across model steps; these are not
unique context sizes or billable-token estimates. Runtime cost fields reported
zero, which is not verified billing. Monetary cost remains unmeasured.

Center then saved 32 explicitly requested synthetic directory-padding documents
through the existing save tool. With 33 documents, the shared display renderer
omits Maple Lantern from the bounded directory while the full member list still
contains it. This controlled display check supplements the subsequent normal
list/get smoke; it does not by itself prove a model discovered the omitted entry.

The document was updated through normal Center chat to B at
`2026-10-01T17:12:21.131Z`: a two-column State/Detail table replaces the older
three-bullet preference. Personal Remote submission
`a6377668-ffab-4277-9311-0156ae04c7f5` searched the full 33-document list at
`17:14:25.807Z`, read B at `17:14:28.308Z`, and returned a table separating a
completed security review from an unrun Tuesday migration and unspecified risk.
Center submission `3e9e43c5-271e-44c8-8be8-f844603a67e2` also found the omitted
document through the full list and read B at `17:15:27.440Z`. These tool outcomes
confirm current body retrieval; the personal Remote visible answer confirms the
new format was applied. The Remote chat entry is
`/o/northstar-product-studio-n6akyf/chats/0f184e44dcef51b979b56bd62e6984b78bdd2bb823b8785ef30be160c7317551`.

Chrome Plugin and in-app browser were unavailable, so the prescribed Agent Browser
fallback was used. Rebuilding dependencies while Web was running triggered repeated
HMR restarts; the Web process exited with a 4 GiB JavaScript heap exhaustion.
Only this worktree's dev stack was stopped and restarted after builds completed.
Other worktrees and production `~/.openmeld` were not modified.

The initial Local runtime acceptance was blocked at the normal Web-generated dev-lane Setup
entry. Two commands, the second obtained with **Get a new setup command**, both
reported `computer authorization failed: Client ID mismatch`. Web reported
`prepare.authorization_failed`. Effective home was the isolated worktree home
above, not `~/.openmeld`. No credential copying, private token edit, or
authorization workaround was attempted. Reproduce from the dev lane's
`/o/northstar-product-studio-n6akyf/connect` page with the current binary server;
use a fresh generated command and never reuse the expired credentials from logs.
The follow-up below resolves this specific Setup failure.

## Follow-up: Setup Recovery And Live Release Boundaries

All times below are UTC on **2026-10-01**, independently of this file's date.
The starting reviewed head was `db46a400f83107f2780f5e23a87b598b6c5a6dd8`.
The additional product correction is commit `e3a247c69`.

### Setup Root Cause And Normal Entry

Web already issued `openmeld-cli-dev` device grants in the development lane
(`clients/web/src/query/auth-query.ts`). The shared CLI device-token client
defaulted to `openmeld-cli` even when the packaged binary ran with the correct
`dev-local` preset, isolated home and development endpoints. The source
`openmeld-dev` wrapper supplied the client environment variable; packaged Setup
did not. A new grant therefore repeated the same mismatch.

`clients/openmeld-cli/src/commands/auth-device-session-client.ts` now uses the
existing preset resolver for its default. The existing independent-session
handoff test was extended with production, development, canary and explicit
client cases. Before the correction, exactly the development case failed with
the observed wrong token-request body; afterward all 37 tests in the two handoff
test files passed. CLI typecheck passed.

After a base-aware stamp and current binary-server build, a **fresh Web-generated
Setup command** completed normally. Service installation was recorded at
17:35:22.453, its runtime started at 17:35:33.257, and local Codex registration
completed at 17:35:43.447. The Web page showed “Computer connected”; terminal Setup
exited 0. No credentials were copied, no database binding was inserted, and no
production login or home was changed.

- Computer: `e32de781-9280-4a40-96d2-9352e651ffb6`, connected in the synthetic account.
- Local Profile: `agt_1fe138e9-4557-4f28-8863-92b364c86515`, Codex / gpt-6-astra / high.
- Project: `project_fd27b595-e214-4a68-a979-43330ed0fc01`.
- Test Space: `ce723534e003094c2040c7b19e27d9ac8609485808f66d855ae420178d19dc84`.
- Local Project Connection: this worktree, available and default, generation
  `01f06401-647f-4f40-b4da-87e51a8d1f68`.

The packaged `projects bind` command exited 0 without output or a connection on
repeated attempts. The repository-supported `pnpm openmeld:dev projects bind ...`
entry established the connection at 17:40:23.066; observer installation separately
reported `ZodError` / `needs_attention`. These are follow-up observations, not a
diagnosed authentication failure or proof of successful Wake. No additional
observer repair or unrelated refactor was attempted.

The subsequent normal `space send --wake ... --new-task --task-access read_only
--task-workspace current` was **rejected before sending** by the enclosing dispatch:
“openmeld space send is blocked inside a dispatch-owned runtime ... Public space
writes must be returned through OpenMeld Space structured actions.” The dispatch
Action is scoped to the actual implementation Space, not the synthetic test
Space. No environment stripping, alternate Web send, or authentication bypass
was used to evade that rejection. There is therefore **no Local Wake/dispatch
selector or Local document/Skill result** for this attempt. The missing condition
is an authorized execution surface able to send that synthetic Space Wake.

Logs: `dev-tmp/knowledge-setup-fixed.log`, `knowledge-project-bind.log`,
`knowledge-local-wake-send.jsonl`, `knowledge-service-status.jsonl`.

### Remote Frozen Release And Revocation

Normal Web private-chat entry:
`/o/northstar-product-studio-n6akyf/chats/69061b6a224b76dbae4eb1b5421055798de4921fb0b174e711b40cb7521375d4`.
Agent: `agt_119359a4-3a94-4a08-b1ce-0d5274fa1583` (Cedar Blank Memory Remote).
All documents and the Skill remained synthetic development fixtures.

1. Submission `2a4c1841-55f0-41e7-b1b2-f086014fef3a` activated the original Skill
   at 17:47:33.721, then read eight directory fixtures sequentially. Normal Web
   **Save** published release `a98db3c2-0ec6-4e25-9d0a-da85b1146720`, digest
   `8a2e3d01c3628cd77600372f28573ea4ac51aaf54c9ff9b37555bb20b086c137`,
   at 17:48:06.521. The same task's resource call at **17:48:13.927** still returned
   the original 84-byte text; its catalog call at 17:48:20.195 returned original
   release `org_skill_release_129c4c63eaf948dd05c303ee49b07a1b` and original digest.
   The published result `364de750-5001-4f72-9671-4c9c593361b9` correctly used the
   current document's table: localization completed, Thursday migration not run,
   rollback capacity unknown. It did not copy the example's facts.
2. New submission `1c885b88-87b0-4d07-a028-35a4f1f80b8a` activated version two at
   17:49:36.611. Normal Web **Disable skill** completed at 17:49:57.827. After its
   intervening document reads, the actual resource call at **17:50:08.129** failed
   with HTTP 403 / `organization_skill.release_unavailable`. Published result
   `f1cf0f2a-79d0-4b32-b767-d8f2f39d06b2` reported the denied new read and did not
   present cached text as a successful retrieval. The fixture is left disabled.

These are actual model/tool/publication observations, corroborated by read-only
isolated Flue tool-outcome records, not mocked E2E. They prove this personal
Remote path; Center and Local live revocation remain separate unverified seams.
Logs: `dev-tmp/knowledge-frozen-live-evidence.jsonl`, `knowledge-followup-selectors.json`,
`knowledge-skill-v2.json`, `knowledge-skill-disabled.json`. The inspected screenshot
`knowledge-revocation-live.png` proves visible reporting only; the tool outcome
proves the 403.

### Blank Personal Remote And Private Memory Boundary

Center private turn `30fc6813-3491-42a9-8dba-b0166e3f95f3`, source
`a3fbdd9b-916b-45da-a39f-2f5768264ff3`, received a new synthetic Cedar Lantern
personal preference at 17:42:18.819. A newly created Remote Profile had **No
messages yet** before its first question; submission
`f804b93b-9ff9-48d7-aab2-e1a3db16c0c0` began at 17:44:44.833 and accurately
answered that the preference was unavailable, without tools or invented details.

This is a negative same-owner sharing check, **not** a successful private-memory
recall test. `native-delivery-service.ts` deliberately skips Center memory
attachment for `personalAgent`; no new scope was enabled to make the test pass.
The established Center capture/search evidence remains valid, but a genuinely
blank authorized Center task using automatic injection remains unverified.

The owned development Service and stack were stopped after the checks. The
isolated data, installed development binary and worktree remain for continuation;
production state and other worktrees were not changed.

### Follow-up Validation

```sh
pnpm --filter openmeld exec vitest run tests/auth-computer-handoff.test.ts tests/computer-auth-handoff.test.ts
pnpm --filter openmeld typecheck
pnpm release:local-components stamp --next --base 7864a7641beb30377a28578c8163400361450fd3 --cli available --cli-reason 'Task knowledge reads and lane-correct setup authorization' --service available --service-reason 'Task-scoped knowledge dispatch readers'
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm verify:release-ready
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm check:affected -- --concurrency=2
pnpm verify:docs -- --strict
pnpm changelog:check
git diff --check
```

Results: 37 focused handoff tests passed; CLI typecheck passed; base-aware stamp
rebuilt and verified 0.3.234 without raising a floor; release-ready rebuilt the
packaged CLI, passed all 65 release contract tests and verified the manifest;
affected checks passed 33/33 tasks (29 cached). Strict docs, changelog and diff
checks passed. Logs: `dev-tmp/knowledge-setup-typecheck.log`,
`knowledge-setup-stamp.log`, `knowledge-setup-release-ready.log`,
`knowledge-setup-affected-check.log`. No production deploy or binary publication.

## Remaining Acceptance

Do not mark ready on these tests alone. Setup is repaired; resolve the dispatch
test-send boundary and complete Local directory/body/Skill acceptance. Center and
personal Remote body discovery, exact resource use with new inputs, and document
A-to-B checks passed as recorded above. Publication during an active model task
and revocation before a new model read now also pass through the personal Remote
runtime; live Center/Local equivalence remains unverified. Private callback and
fresh retained search passed; this run does not isolate automatic injection from
existing chat history as the cause of model use.
Complete the remaining semantic/privacy holdouts listed in the scenario table.
No claim is made about production ontology, long-run extraction quality, concurrent
model quality, or model forgetting.

## Independent Review Corrections (2026-10-01 UTC)

Starting head was clean `f5aef3bea06d359c5f702afe403cea86d6e397b0`, matching
the draft PR. No other worktree or branch was changed. Sol's review was bound to
`db46a400f83107f2780f5e23a87b598b6c5a6dd8`; the fixes below do not claim his
approval of newer code.

- `8f5853a92` fixes the shared adapter MCP catalog. The actual CLI server's two
  knowledge readers are now in the exact allowed set used by Codex and OpenClaw.
  The packaged discovery test compares actual stdio MCP discovery with that
  shared contract and independently checks the three-tool delivery-only set.
  The stale discovery expectation also omitted the existing `report_progress`;
  that expectation is corrected without changing progress behavior.
- `05f43a3c6` fixes personal Remote delegated document reads. Both task directory
  and body tool use `buildOrganizationDocumentReadContext`. Personal callers
  send their receiving identity, not a forged human speaker. Core uses the
  existing active native-delivery verifier, frozen audience policy, and owned
  active Agent ordinary-member read. Center/member and anonymous-member paths
  retain their existing authorization. No protected prompt, draft, or write
  permission is added.
- The same commit fixes the shared-capture owner contradiction and stale
  Brief/title-cache descriptions in shared contracts and the Remote owner.
  Earlier blanket "no owner conflict" evidence was incomplete; the corrected
  contracts now describe the implemented behavior. Setup code is unchanged.

### Focused Evidence

All following times are UTC; terminal display dates use Asia/Taipei.

- At 18:16:52, the complete Organization document integration suite passed
  39/39. The extended existing owned-Agent test creates actual isolated D1
  profiles, a personal binding, a real Space and memberships, and a schema-valid
  accepted native delivery with `sender.kind=agent_profile` and
  `trigger.source=space_wake`. Directory and body RPCs return approved B while
  draft C stays absent; mismatched owner, external requester, and disabled
  receiving Profile are rejected. This is workerd/DO/D1 boundary evidence,
  **not** a running model or real-user Wake.
- Remote tools/materialization/fresh-context suites passed 208/208. The added
  delegated read test uses the real callback storage and tool implementation;
  only the Core RPC response is a typed boundary substitute. It covers both
  directory context and body/list calls with the receiving identity.
- Adapter owner tests passed 4/4. Codex scoped-MCP and OpenClaw tool/denial suites
  passed 13, with 5 pre-existing opt-in native-install cases skipped. Their
  strict extra/missing/malformed-tool controls remain in place; this does not
  certify a native OpenClaw installation.
- Packaged CLI stdio MCP integration passed 4/4, including complete and
  delivery-only catalogs, reply receipt, and expired-receipt recovery. This is
  an actual packaged process; it does not prove a Local Agent model used a
  document or Skill. CLI, Core, and Remote typechecks passed.

Commands (from this worktree):

```sh
pnpm --filter @openmeld/core exec vitest run --config vitest.config.ts tests/organization-documents.integration.test.ts
pnpm --filter @openmeld/remote-agent exec vitest run tests/tools.test.ts tests/center-agent-runtime-materialization.test.ts tests/organization-document-prompt-context.test.ts
node --test runtime/adapters/core/test/dispatch-space-action-mcp.test.js
node --test runtime/adapters/codex/test/scoped-mcp.test.js runtime/adapters/openclaw/test/space-action-tools.test.js runtime/adapters/openclaw/test/delivery-only-native.test.js
pnpm exec turbo run build --filter=openmeld
pnpm --filter openmeld exec vitest run --config vitest.integration.config.ts tests/space-action-entry.integration.test.ts
pnpm --filter openmeld typecheck
pnpm --filter @openmeld/core typecheck
pnpm --filter @openmeld/remote-agent typecheck
```

Logs: `dev-tmp/knowledge-review-doc-suite.log`, `knowledge-review-remote-suite.log`,
`knowledge-review-mcp-owner.log`, `knowledge-review-adapter-tests.log`,
`knowledge-review-packaged-tools.log`, and `knowledge-review-*-types.log`.

Final closeout passed: affected checks **53/53** (51 cached on the final run),
the unchanged Setup argument/environment/lane regression **37/37**, packaged
build and release-ready **65/65**, manifest verification, strict docs, changelog,
and `git diff --check`. The first affected run caught a nullable callback in the
new test fixture; an explicit fixture assertion fixed it, and the focused test,
Remote check and final affected run passed. No production behavior was changed
to silence a check.

```sh
pnpm --filter openmeld exec vitest run tests/auth-computer-handoff.test.ts tests/computer-auth-handoff.test.ts
pnpm release:local-components stamp --next --base 7864a7641beb30377a28578c8163400361450fd3 --cli available --cli-reason 'Task knowledge readers match the strict controller catalog' --service available --service-reason 'Task-scoped knowledge readers in the carrier adapter catalog'
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm verify:release-ready
OPENMELD_AFFECTED_BASE=7864a7641beb30377a28578c8163400361450fd3 pnpm check:affected -- --concurrency=2
pnpm verify:docs -- --strict
pnpm changelog:build
pnpm changelog:check
git diff --check
```

Closeout logs: `dev-tmp/knowledge-review-setup-regression.log`,
`knowledge-review-stamp.log`, `knowledge-review-release-ready.log`,
`knowledge-review-affected-final.log`, `knowledge-review-docs.log`, and
`knowledge-review-changelog.log`. The manifest was rebuilt against the stated
base, not hand-edited. CLI/Service remain 0.3.234 available; floor stays 0.3.224.

### Remaining Runtime Boundary

The Local send previously failed before admission under the production Wake's
dispatch scope. This round did not retry it, clear dispatch environment, change
transport to evade it, or send dev IDs through production Core. The existing
main-journeys harness calls the same `space send` at
`scripts/e2e/openmeld-main-journeys-smoke.sh:316`. Service-readiness smoke is
explicitly read-only (`scripts/e2e/service-readiness-smoke.mjs:144`). The
work-coordinator fixture targets Staging and requires its own credentials; it
is not an isolated-dev admission entry. No applicable supported dev admission
harness was found in these existing owners.

The missing condition is an authorized invocation whose dispatch/action scope
actually targets the isolated dev Space (or an authorized dev test runner
outside this production dispatch). This does not require a production login,
weaker authentication, a rewritten boundary, or fake binding rows. Once that
invocation is available, send one ordinary Local Wake in the retained dev Space
and one Agent-source Remote Wake using the existing fixtures. Read the omitted
document and pinned resource, then record actual model output and selectors.

| Claim | Code boundary | Actual model/runtime |
| --- | --- | --- |
| Local full tool discovery and delivery-only restriction | Packaged MCP + strict adapters pass | Local directory/body/Skill Wake not admitted; still unverified |
| Agent-source personal Remote directory/body | Callback/tool + real D1/DO authorization pass | Not run this round; prior human-DM smoke is not a substitute |
| Human-source Remote approved B and frozen Skill/revocation | Prior boundaries retained; document suite rerun | Prior dated live evidence remains; human-source personal reads now need a representative follow-up because their identity selection changed |
| Center blank-session automatic memory use | Existing capture/recall boundaries unchanged | Still not isolated from history |
| Unadopted C versus approved B | Actual document read returns B, never C | No new model semantic holdout this round |
| Private content not shared | Existing scope/privacy checks unchanged | Prior fresh Remote negative isolation only; no new positive Center recall claim |

The dev stack and Service were not restarted. No new live-provider, browser,
Local model, or Remote model success is claimed. The packaged CLI and boundary
tests above do not replace these gaps. Independent latest-diff review and the
remaining representative runtime evidence are still due before any Ready
decision. The PR remains draft; no merge, deploy, or binary publication.

## Final Representative Runtime Acceptance

This follow-up ran the unchanged source head
`e5cdc6be14b927f9ed526b1ffdabd0119b3942c8` on 2026-10-01 UTC (2026-10-02
in the workstation's UTC+08 timezone). It adds evidence only. It supersedes the
two pending human-source Remote and blank-session Center entries above, without
promoting the remaining Local/delegated boundary tests to model E2E.

The normal root `pnpm dev:worktree` and `pnpm dev:web:worktree` commands started
the retained isolated lane `wt-e7ed328ad1a0`. Chrome control was unavailable
(`Owl extension-created tabs must be active`), and the in-app browser was not
available. The named Agent Browser session `knowledge-phase-one-smoke` used
normal Web login and only the synthetic account. No Local Service was started,
no production home was used, and no admission-denied Wake was retried.

### Personal Remote Human-Source Regression: Passed

The synthetic Skill was re-enabled through its normal Web **More actions →
Enable skill** menu. Neither its release nor its body was changed. A normal
human DM then asked Cedar Blank Memory Remote to list current documents, read
the omitted Maple Lantern Reporting Rule, activate the Skill, read its resource,
and classify new facts. The new input supplied facts, not the document format.

- Profile: `agt_119359a4-3a94-4a08-b1ce-0d5274fa1583`.
- Space: `69061b6a224b76dbae4eb1b5421055798de4921fb0b174e711b40cb7521375d4`.
- Source message: `70370ad5-950f-403a-91f2-d288c1d038db`.
- Submission: `37ba6180-a2ed-4b10-9725-48e778b6dba9`; accepted
  `2026-10-01T18:40:05.125Z`, completed callback `18:40:30.148Z`.
- The persisted admission records a verified member sender and
  `requester_private`. This is the human-source regression of the new receiving
  Agent read identity, not an Agent-source Wake.
- Actual model tool outcomes: Skill activation at `18:40:09.322Z`; full list of
  33 documents at `18:40:19.988Z`; approved body at `18:40:22.197Z`; frozen Skill
  search at `18:40:24.032Z`; successful resource read at `18:40:26.458Z`.
- Document `org_document_3c71981e-5d53-477b-ac4e-852a8cc65d7e` returned approved
  B, updated `2026-10-01T17:12:21.131Z`. The selected Skill release remained
  `a98db3c2-0ec6-4e25-9d0a-da85b1146720`, digest
  `8a2e3d01c3628cd77600372f28573ea4ac51aaf54c9ff9b37555bb20b086c137`.
  `references/example.md` returned its actual 252-byte body.
- The public response used B's State/Detail table: accessibility audit signed
  off under Completed; unstarted Tuesday translation under Next; unknown vendor
  ETA under Risk. It reported the matching document time, release, digest and
  resource size. The normal UI displayed those new facts correctly.

### Center Private Capture → Blank Conversation → Automatic Recall: Passed

In the existing Center private DM, the synthetic user requested one new personal
preference: Amber Heron updates use **Facts, Next move, Unknowns**, in that order,
and this is not team policy. No explicit memory writer, document or Skill tool
was called. The existing private completion callback supplied the capture path.

- Capture source message: `0b76a1fc-0fdb-459d-b244-ab546341ab51` in Space
  `57ae568797ddea3b843f0bd43871bec0092841fabac9c1e54b867b29bd32654b`.
  Submission `9fedb80b-b419-4e09-bc22-ff578d9235fc` was admitted at
  `2026-10-01T18:39:26.504Z` and completed at `18:39:34.620Z`.
- The user then selected **Open chat history → New chat**. The UI showed a blank
  conversation before sending: “For my fictional Amber Heron updates, what
  headings do I personally prefer, and in what order? If you do not have that
  preference, say so rather than guessing.” The query did not contain the answer.
- New Space: `4396e917ca30becf7a9fef03bd95fcb42406d0a2f3e4f1134068e1671d13ba76`.
  Source message: `56ddf5ef-1efa-40ae-8e28-eb355bfcc556`.
  Submission: `9d5afd17-b659-420e-b619-c5e42e650909`; accepted
  `2026-10-01T18:41:12.874Z`, completed callback `18:41:16.921Z`.
- The new runtime session/DO contains exactly one submission, belonging to this
  new Space. Its persisted `turnEnvelope.memory` contains `source: ca_dm`,
  `subject: member` items for the exact Amber Heron heading order and personal
  scope, recorded/valid from `2026-10-01T18:39:34.664Z`. The envelope is
  `requester_private`, audience `requester_only`, with six items and no truncation.
- This submission has zero tool outcomes: it did not search old conversations
  or actively search memory. Its public answer was **Facts → Next move →
  Unknowns**, explicitly personal rather than team policy. The UI response and
  callback text agree. Thus the held-out new conversation demonstrates automatic
  memory injection and correct use without prior conversation history.

This is one positive synthetic example, not a provider-quality or extraction
latency distribution claim. The same envelope still includes the previously
reported “Assistant confirmed” noise from an older synthetic turn; this remains
a nonblocking extraction research observation, not a reason to add a filter
model. Recall of nearby Cedar Lantern facts did not cause cross-project use in
this example.

### Evidence, Shutdown And Remaining Gap

Local logs: `dev-tmp/knowledge-acceptance-stack.log` and
`dev-tmp/knowledge-acceptance-web.log`. A read-only, synthetic-lane diagnostic
extract is retained at `dev-tmp/knowledge-final-smoke-evidence.json`, generated
by `dev-tmp/knowledge-final-smoke-read.mjs`. It contains selected ledger fields,
callback memory/public replies and tool outcomes, excluding reasoning and login
credentials. These diagnostics corroborate normal Web actions; they did not
create or mutate the test data. A Center screenshot is retained at
`dev-tmp/knowledge-center-blank-memory.png`; it is visual evidence only.

The named browser was closed and both owned dev command sessions were stopped
after callbacks completed. The isolated fixture state is retained, including
the explicitly re-enabled synthetic Skill. No production process or other
worktree was stopped. Only this evidence document changed; no release restamp,
product-code test rerun or changelog change is required for this follow-up.
`pnpm verify:docs -- --strict` and `git diff --check -- developing` passed.
`lsof -nP -iTCP:30240-30243 -sTCP:LISTEN` returned no listeners after shutdown.

Local model directory/body/Skill use and Agent-source Remote model use remain
unverified. No cross-Space Wake or alternate-transport retry was attempted. The
single next step is still a legitimately authorized isolated-dev admission
context/test runner, then one representative actual Wake for each missing
runtime path. This evidence does not provide that authority or change the gate.
The current Core authorization integration tests remain boundary evidence only.
Additional semantic holdouts and runtime cross-products were intentionally not
added. Independent review remains bound to its exact source SHA; a later
evidence-only commit does not constitute an additional code change or a Ready
decision. PR #1429 stays draft, with no merge, deployment or binary publication.

## Remaining Admission Entry: Bounded Diagnosis

On 2026-10-02 at 02:17 UTC, local HEAD and GitHub PR head both remained
`12eb8971af6e96689f182c8870b249e99ccefb2f`, clean and draft. No dev stack,
browser or Service was started for this investigation. The successful evidence
above was not rerun. This section identifies the missing execution authority;
it does not grant it or claim a newly admitted Wake.

### Where The Existing Denial Occurs

- `clients/openmeld-cli/src/space/send.ts:38` invokes
  `assertDispatchOwnedRuntimePublicWriteAllowed` before profile resolution
  (`:60`), base URL resolution (`:65`), or any network request.
- `clients/openmeld-cli/src/runtime/dispatch-owned-runtime.ts:235` reads the
  current dispatch mode and rejects ordinary public writes whenever it is
  active. The guard has no destination, lane, test-runner or delegated-grant
  input. Consequently the earlier denial did **not** test whether dev Auth or
  dev Core would authorize the synthetic user and Space.
- This differs from the adjacent Service mutation guard (`:252`): that owner
  explicitly permits confirmed non-production lanes. It does not establish a
  similar exception for Space writes. Copying that exception into public writes
  would widen the current dispatch's denied authority, not supply an independent
  authorized test entry.
- The carrier creates a Space Action context only for the admitted parsed task
  in `local-service/dispatch/execute-dispatch-task.ts:3237`, binding its dispatch,
  attempt, source, Space, target and recipient snapshot. Context creation is
  `runtime/dispatch-space-action-context.ts:142`; active dispatch/target matching
  is enforced at `:453`. This is a child of an existing admission, not a public
  bootstrap API that can request another environment's admission. Calling this
  internal constructor or replacing its context is not a legitimate solution.

The existing focused regression was run unchanged:

```sh
pnpm --filter openmeld exec vitest run --config vitest.integration.config.ts tests/space-send-agent-guard.integration.test.ts -t 'blocks public write when running inside a dispatch-owned runtime'
```

One selected test passed, six unselected cases were skipped. The test at
`:265` independently asserts that `fetch` is never called after rejection. Log:
`dev-tmp/knowledge-admission-guard.log`. This is a local guard test, not dev
account authentication or a model Wake.

### Existing Owners And The Smallest Valid Data Flow

An **independently authorized dev test invocation** must precede the normal
product path. Its execution owner must explicitly bind the retained worktree,
lane `wt-e7ed328ad1a0`, isolated home, synthetic organization/account, and Space
`ce723534e003094c2040c7b19e27d9ac8609485808f66d855ae420178d19dc84`. A shell or
browser's ability to reach localhost alone is not this authorization.

Once that invocation exists, reuse the current product chain unchanged:

1. The ordinary CLI resolves the lane account/profile and calls
   `postSpaceNormalMessage` (`packages/api-client/src/space/post-normal-message.ts:16`),
   through `POST /v1/spaces/:spaceId/signals`; no raw RPC or inserted dispatch row.
2. Gateway authenticates and resolves the requested owned Profile
   (`services/gateway/src/middlewares/auth.ts:101`), builds the verified actor
   context, and calls Core (`routes/rpc-http.signals.ts:437`). Core's
   `rpcPostSignal` requires writable Space access (`services/core/src/rpc/methods.ts:18888`)
   and routes to the target Space's ordinary signal handler
   (`space/transport/do/space.ts:4995`). Space membership, addressing and existing
   execution-context/Wake admission remain authoritative.
3. The dev Local target `agt_1fe138e9-4557-4f28-8863-92b364c86515` runs via the
   existing RuntimeCoordinator/current-account dev Service path, with the real
   Project connection and controller readiness rechecked at that time. Its
   normal action context is created by its own admitted task, not copied from
   this production task.
4. That legitimately admitted dev Agent can use its ordinary **Reply + Wake**
   to delegate the second specimen to personal Remote
   `agt_119359a4-3a94-4a08-b1ce-0d5274fa1583`, after normal member setup if needed.
   This gives Core a genuine Agent-source message and receiving Remote delivery.
   Do not manufacture an `agent_profile` sender. Both results must be published
   in the dev Space with trace selectors and actual document/resource output.

This reduces the remaining work to one externally admitted Local test and its
ordinary in-Space Agent-to-Agent handoff, rather than a new runner framework or
new credential store. It is a prepared plan, not a running background job.

### Why No Available Entry Was Executed

`scripts/dev/dev-account.py:2` explicitly prepares credentials for normal local
UI login. It provides no job submission or delegated capability. `dev:run`
(`scripts/dev/run-local-heavy.mjs:32`) passes `...process.env` to the existing
owned-command process launcher (`scripts/dev/owned-command.mjs:14`); it owns
resource reservations and process cleanup, not identity or task permission.
Running a denied send under it cannot create independent authority. The already
examined journey/readiness/Staging scripts were not re-investigated or retried.

The current dispatch tools bind their Space and source to this production Wake;
none exposes a dev target or independent invocation grant. Read-only discovery
also found a WebCodex Runner status interface, but its observation returned
`tunnel_client_not_seen` / HTTP 404 (client not seen for 300 seconds), without a
caller-visible runner or target authorization. No execution, reconnect, alternate
transport or authentication change was attempted there. Even an online generic
Runner would need explicit admission authority for this dev target; availability
alone is not permission.

The concrete missing capability is therefore **execution-owner creation of an
independent test invocation authorized for this exact dev lane/account/Space**,
not another dev account, production login, new memory writer or Core permission
check. Center should request that invocation from the environment/controller
owner and pass the bounded identifiers and two-step test above. The invocation
must originate independently; spawning a child here and removing inherited
dispatch markers would still evade the existing denial.

No safe repository-only change was identified that creates this outside
authority without either broadening the current guard or inventing a new
delegation authorization contract. This PR therefore does not change the guard,
CLI flags, Service, Core, or schemas. If the environment cannot provide such an
invocation, these two live paths remain blocked; this record does not ask Felix
to configure production or claim that Center already owns the missing tool.

Only evidence documentation changed. Strict documentation validation and
`git diff --check -- developing` passed. Existing architecture owners remain
unchanged; no permission, identity, lifecycle or publication rule is bypassed.
No dev ports 30240–30243 were listening when checked. The PR remains draft.
