# Center Agent Capability-Preserving Orchestration Research

## Agent Context

- Purpose: investigate how Center Agent can coordinate an executor or reviewer
  that may have stronger task-level cognition without narrowing that agent to
  Center's own decomposition, preferred solution, or conclusion.
- Read this when: evaluating Center Agent delegation quality, task-level
  capability routing, independent review, action-versus-cognition scope, or the
  difference between execution terminality and goal acceptance.
- Update this when: Center Agent delegation inputs, task-coordination schemas,
  capability projections, continuation envelopes, conversation compaction, or
  acceptance semantics materially change, or when a benchmark produces new
  evidence.
- Do not use this for: claiming a production incident, changing execution
  authority, ranking model vendors, authorizing side effects, or implementing
  the proposed contracts without owner review.
- Source of truth: current product and architecture owner documents own
  production semantics. This file owns only this dated research synthesis and
  its explicitly labeled proposals, hypotheses, and validation gaps.

Date: 2026-07-30

Status: RESEARCH SNAPSHOT — NOT A DESIGN DECISION. Remove or distill this file
when an accepted architecture decision, benchmark results, and relevant owner
document updates supersede it.

Audience: Center Agent, Remote Agent Runtime, Core Agent Task Coordination,
Agent Profile, Data/Observability, and evaluation owners

Evidence rule: confirmed implementation facts, design risks, hypotheses, and
validation gaps are labeled separately. This snapshot does not claim a
production incident unless the repository contains direct evidence of one.

## One-Page Plain-Language Conclusion

The main risk is not that Center Agent uses a particular model. The main risk is
that the current delegation boundary gives a child Agent Profile one
Center-authored text instruction, while the child explicitly does not see the
Center conversation. The task-coordination system then tracks whether execution
and publication reached a terminal outcome, but it has no separate, durable
concept for "accepted against the original goal." This is a confirmed contract
gap. It is not evidence that current production tasks are routinely wrong.

OpenMeld already has a strong execution-control foundation:

- Center's prompt says to split work only when data, identity, side effects, or
  environment differ. It does not require decomposition for its own sake.
- Routing is intended to use live capability and authorization signals rather
  than a fixed Organization matrix.
- Core owns exact Task Handles, completion subscriptions, barriers,
  continuations, retries, Stop propagation, and durable terminal outcomes.
- RuntimeCoordinator remains workstation execution truth. D1 coordination
  records remain a ledger and projection.
- Authorization fails closed. Delegation does not let Center choose Binding,
  Runtime, or dispatch authority.

Those strengths should remain. The smallest long-term-correct improvement is to
add a capability-preserving task contract and a separate acceptance loop without
replacing RuntimeCoordinator, Wake, Space publication, or current task
coordination.

Center should be the **coordination authority**, not the default technical
judge. Its minimum duties should be:

1. preserve the original goal, authoritative acceptance criteria, owner
   decisions, constraints, and required evidence;
2. discover and route against task requirements plus declared and observed
   capabilities;
3. enforce data and action permissions;
4. own Task Handles, dependencies, barriers, retry, cancellation, and budgets;
5. collect evidence, preserve dissent, publish state, and request an owner
   decision when evidence cannot settle a disagreement.

The selected executor should retain the full task-level cognition needed to do
the work: problem framing within the goal, decomposition, hypotheses, technical
method, tool use, cross-layer inspection, tests, criticism of the proposed
approach, and reporting of unexpected but relevant findings. A non-goal should
limit requested side effects or deliverables. It should not silently become a
ban on inspection, reasoning, questioning, or reporting.

Action scope and cognition scope must therefore be separate:

- **Action scope** answers, "What may this agent change, send, publish, spend,
  or execute?"
- **Cognition scope** answers, "What may this agent inspect, reason about,
  question, and report within data it is already authorized to access?"

The default cognition scope should be open within authorized data. Real privacy,
tenant, owner-decision, and side-effect boundaries still apply. "Read and
report" does not imply "change."

For work that needs acceptance, completion should mean only that the executor
finished or stopped. An independent reviewer should receive the original goal,
authoritative criteria, artifacts, evidence, and repository/version context
directly. It should not initially receive Center's preferred conclusion or the
implementer's hidden reasoning. Review findings and dissent should remain
visible. Therefore:

```text
all children terminal != work accepted
```

The recommended first increment is not a permanent debate swarm. It is:

1. an immutable, versioned `TaskIntent`;
2. an additive delegation envelope that separates role, capability
   requirements, action scope, cognition scope, and evidence requirements;
3. an orthogonal `AcceptanceState`;
4. one independent review when risk policy requires it;
5. evidence-calibrated routing in shadow mode before it controls production.

Only high-risk or genuinely disputed work should wake a Coach or a second
adversarial reviewer. Model brands must not encode rank. OpenMeld should filter
by hard requirements, then select using fresh capability offers, observed
task-family evidence, uncertainty, cost, latency, and risk.

## Research Scope And Non-Goals

This snapshot covers:

- Center Agent system-prompt assembly and execution-routing guidance;
- Center Agent Wake, task-list, task-watch, and completion callback tools;
- HTTP and runtime task-coordination schemas;
- Core delegation, terminal-outcome, continuation, and D1 coordination paths;
- model-visible Agent Profile and local-connection capability projections;
- Wake publication and Space dispatch inputs;
- Remote Agent continuation envelopes and Flue compaction;
- relevant current owner documents and prior research snapshots;
- official A2A, MCP, OpenAI, Anthropic, and scalable-oversight sources.

This snapshot does not:

- change production code, schemas, prompts, owner documents, tests, or config;
- claim that one model vendor is generally stronger than another;
- redesign RuntimeCoordinator, Binding, Runtime Transport, Space truth, or
  publication authority;
- make Center Agent a universal workflow engine or a second execution owner;
- recommend unrestricted side effects;
- treat generic multi-agent research as proof of an OpenMeld production bug;
- deploy, migrate data, run production tasks, or establish benchmark results.

## Evidence Labels

| Label | Meaning |
| --- | --- |
| Confirmed implementation fact | Directly observed in current repository source or owner documents |
| Confirmed contract gap | A requested semantic has no first-class representation in the inspected contract surface |
| Design risk | The current contract permits a failure mode, but no production incident was established |
| Hypothesis | Plausible mechanism that requires a controlled experiment or trace |
| Validation gap | The repository evidence does not settle the question |
| External inspiration | Official source or paper that informs a design, not evidence about OpenMeld behavior |

## Current Architecture: What Is Already Right

### Coordination and execution truth are separated

The current system correctly separates several authorities:

- Agent Profile is identity, not execution readiness.
- Core-owned readiness decides user-facing Wake availability.
- RuntimeCoordinator owns an in-flight workstation execution.
- D1 task-coordination records and dispatch records are durable ledgers and
  projections, not execution authority.
- Queue is a delivery conveyor, not an owner of execution truth.
- Local OpenMeld Service carries local execution but does not own Agent Profile,
  Space, or final readiness truth.

This research must not collapse these boundaries into one "smart orchestrator."

### Routing is intended to be dynamic

`services/remote-agent/agent-core/prompt/execution-routing.ts` tells Center to
infer task requirements, inspect live signals, and choose direct, delegated,
combined, or blocked execution. It also says not to maintain a fixed
Organization-specific capability matrix and not to split work unless work units
genuinely require different data, identities, side effects, or environments.

That is the correct direction. The missing part is not a new routing slogan. It
is a model-visible, task-relevant capability contract and runtime evidence that
can make that instruction operational.

### Task coordination is durable and event-driven

Core already has:

- exact Task Handles and child-parent links;
- completion subscriptions;
- `all_terminal`, `first_success`, `on_failure`, and per-child continuation
  behavior;
- fallback activation;
- idempotent continuation submission;
- terminal outcomes including success, completion, failure, stop, silence, and
  publication failure;
- a reliable path from child terminal evidence to Center continuation;
- durable Space publication and dispatch activation ordering.

The recommendation reuses these mechanisms. It adds intent and acceptance
semantics beside them.

## Severity-First Findings

### High: execution completion and goal acceptance are one semantic layer short

**Classification:** confirmed contract gap.

Task-coordination schemas and D1 state represent execution and publication
terminality. Barrier evaluation treats `all_terminal` as "no unfinished child,"
and `first_success` as a terminal success-like status. The continuation snapshot
contains task state and terminal outcome. No inspected first-class contract
records whether the result satisfied the original goal and authoritative
criteria.

This does not mean `all_terminal` currently publishes a false success. Center
may inspect child publications and reason correctly. The gap is that correctness
depends on a later model turn instead of a durable acceptance contract.

**User impact if the risk materializes:** every child can finish cleanly while
the requested outcome remains incomplete, wrong, or unsupported. The system can
faithfully report execution terminality but cannot query a separate acceptance
truth.

### High: the child receives Center's rewrite, not an immutable original task

**Classification:** confirmed contract gap plus design risk.

The Wake tool accepts a `text` instruction and target profiles. Its guidance says
the woken agent sees only what Center sends, not the Center conversation. Core
publishes that Center-authored text to Space and activates the exact targets.
The delegation and continuation contracts do not contain a versioned immutable
original goal or authoritative acceptance criteria.

The Space dispatch includes the Center-authored source text and continuity
snapshot, which is stronger than a bare Task Handle. A persistent Center
conversation may also retain the original goal. Therefore repository evidence
does **not** prove that a production goal was lost. It proves that the
cross-agent contract cannot distinguish the user's authoritative goal from
Center's task rewrite.

**User impact if the risk materializes:** a capable executor can optimize the
wrong problem perfectly because the weak point is the instruction boundary, not
the executor's intelligence.

### High: independent review, acceptance, and dissent have no first-class role

**Classification:** confirmed contract gap in the inspected surfaces.

No independent reviewer or Coach role, review verdict, acceptance projection, or
durable dissent field was found in the inspected Center prompt, Wake contract,
task-coordination schemas, continuation snapshot, or capability projection.
Current coordination can delegate a review as ordinary text, but that does not
provide direct original-goal delivery, context isolation, a review state, or
dissent preservation.

**User impact if the risk materializes:** implementation self-report or Center's
own technical judgment can become the practical acceptance decision even when a
separate agent could find a material error.

### High: "smallest capable route" lacks task-cognition evidence

**Classification:** confirmed projection limitation plus design risk.

The model-visible Agent Profile and local-connection candidate projections
provide identity, status, readiness, runtime, freshness, device, and operational
connection information. Local Agent Controller snapshots can contain model and
skill inventories, but the cloud projection intentionally removes those
inventories. No inspected Center-facing projection offers task-family
capabilities, context limits, relevant tool sets, expected artifact types, or
observed quality evidence.

There is no confirmed hard-coded global ranking such as "Codex is stronger than
Claude." The problem is the opposite: current routing guidance is dynamic, but
the available projection is too operational to compare cognition fit among
multiple ready candidates.

**User impact if the risk materializes:** Center may route based on availability
and identity because it lacks evidence to distinguish "can be woken" from "fits
this task."

### Medium: continuation is structurally reliable but semantically thin

**Classification:** confirmed contract shape plus design risk.

Continuation reliably carries child Task Handles, states, terminal outcomes, and
published-result pointers. Center can be instructed to read exact published
results. The snapshot does not carry acceptance criteria, required evidence,
artifact manifests, unresolved questions, or dissent.

**User impact if the risk materializes:** the final synthesis can lose why a
result is trustworthy, what remains uncertain, or which disagreement still
matters, even though task terminality is correct.

### Medium: compaction can preserve structure while losing task invariants

**Classification:** hypothesis and validation gap.

Flue is the sole conversation-history and summary layer. Current model history
retains a recent token window, and compaction observation checks structural
issues. No inspected semantic validator compares a compacted conversation to an
immutable original goal and acceptance criteria.

This is not proof that compaction currently loses goals. It is a testable risk:
long delegations may preserve fluent summaries while dropping a constraint,
dissent, exact error, or owner decision.

### Medium: barrier choice can create avoidable latency

**Classification:** bounded design risk, not a general serial-bottleneck defect.

Core supports parallel target activation and several completion modes.
`first_success`, `on_failure`, and per-child continuations mean the architecture
is not inherently serial. However, `all_terminal` delays synthesis until every
child is terminal, and Routine continuation currently uses one all-terminal
resume. That may be the safest default, but it can create tail-latency when a
slow child is no longer relevant.

### Medium: `child_reports_directly` has no machine-checkable acceptance guard

**Classification:** design risk.

The prompt correctly limits this mode to work where every child's publication
fully satisfies the request. The coordination system can ensure that children
report and become terminal, but it does not prove that each publication fully
satisfies the original criteria.

### Low: forced uniformity is not established, but evidence summaries are narrow

**Classification:** validation gap.

Child publications remain individually addressable, and Center can read exact
results. This is evidence against a claim that OpenMeld currently collapses
every result into one uniform answer. However, the coordination snapshot is
status-oriented, so evidence and dissent can become dependent on natural-language
publication and later synthesis.

## Mechanism Inventory: Can The Current System Suppress A Stronger Agent?

| Mechanism | Current evidence | Assessment |
| --- | --- | --- |
| Over-decomposition | Prompt says split only when capabilities or boundaries truly differ | No confirmed defect; model behavior still needs replay measurement |
| Preselected solution or conclusion | Delegation is one Center-authored text field; no contract distinguishes goal from proposed method | Real design risk |
| Non-goal becomes an inspection ban | No typed distinction between action non-goals and cognition/report scope | Validation gap with a clear benchmark target |
| Context trimming | Flue compacts history and keeps a recent raw window; no immutable invariant comparison | Confirmed mechanism, semantic-loss hypothesis |
| Original user goal hidden | Child explicitly sees only sent text; no immutable original-goal field | Confirmed contract gap |
| Weak Center adjudicates technical disagreement | No separate acceptance/review contract; Center synthesizes after continuation | Real design risk, no incident established |
| Completion equals acceptance | Execution terminal states exist; acceptance state does not | Confirmed semantic gap |
| Serial bottleneck | Multiple completion modes and parallel activation exist; `all_terminal` can wait for the slowest child | Bounded policy risk, not an architectural absolute |
| Over-unified output | Exact child publications are readable; coordination snapshot is narrow | Not confirmed; dissent-loss risk remains |
| Reviewer lacks independent context | No first-class reviewer role or context-isolation contract found | Confirmed contract gap |
| Static model ranking | Fixed Center model exists, but no hard-coded executor ranking found | Claimed mechanism not found |
| Capability route based on insufficient evidence | Candidate projections emphasize readiness and operational state | Confirmed projection limitation |

## Minimum Center Agent Responsibility

Center should own only cross-task coordination and user/Organization authority:

1. **Goal fidelity**
   - preserve an immutable reference to the original goal;
   - preserve authoritative acceptance criteria and owner decisions;
   - distinguish constraints from suggested methods;
   - make changes to the task intent versioned and observable.
2. **Capability discovery and routing**
   - derive hard task requirements;
   - read fresh declared capabilities and runtime evidence;
   - filter candidates that cannot satisfy hard requirements;
   - choose among eligible candidates using evidence, uncertainty, cost,
     latency, and risk;
   - explain why a route was selected.
3. **Authority and side effects**
   - enforce Organization, data, tool, action, publication, and spend limits;
   - never infer action permission from cognition capability;
   - fail closed on missing identity, ownership, or authorization.
4. **Coordination**
   - create and track Task Handles;
   - express dependencies and barriers;
   - activate retry, fallback, cancellation, and Stop;
   - enforce loop and budget limits.
5. **Evidence and state**
   - gather exact artifact and evidence references;
   - keep dissent and unresolved questions;
   - publish execution and acceptance state separately;
   - escalate to the owner when evidence cannot settle a decision.

## Task-Level Cognition To Delegate Intact

Unless an owner decision or real safety boundary says otherwise, the selected
executor should own:

- reframing the problem without changing the authoritative goal;
- selecting a technical method;
- decomposing its own work;
- forming and testing hypotheses;
- choosing tools within its action authorization;
- inspecting relevant layers within authorized data;
- challenging Center's proposed solution;
- identifying cross-layer consequences;
- producing artifacts and evidence;
- reporting unexpected relevant findings;
- declaring uncertainty and dissent.

Center may ask for a deliverable and evidence. It should not prescribe an
unverified solution merely because it must create a self-contained instruction.

## Action Scope And Cognition Scope

### Proposed rule

```text
Action authorization is narrow and explicit.
Cognition is open within already-authorized data unless an explicit
privacy, tenant, legal, owner-decision, or information-protection rule limits it.
```

### Example

A reviewer can be authorized to:

- read a repository snapshot;
- inspect tests and adjacent layers;
- reason about a user-visible consequence;
- report that an API contract is inconsistent.

The same reviewer can still be forbidden to:

- edit code;
- create a PR;
- send Slack;
- mutate production data;
- access another Organization;
- override a settled owner decision.

"Do not change the database" should not mean "do not inspect or report a
database-contract problem."

### Proposed scope fields

| Field | Purpose |
| --- | --- |
| `dataScope` | Data, tenants, projects, Spaces, and references the role may read |
| `actionScope` | Tools and side effects the role may execute |
| `cognitionScope` | Inspection, reasoning, challenge, and reporting limits |
| `ownerDecisions` | Settled choices a role must not silently override |
| `nonGoals` | Work not requested; does not imply a cognition ban |
| `evidenceRequirements` | Evidence required before an acceptance decision |

`cognitionScope` should default to `open_within_authorized_data`. Any narrower
value should carry a reason and be visible in traces so restriction leakage can
be measured.

## Candidate Designs

### Option A: capability-preserving task contract plus one independent review

Add an immutable task intent, additive delegation envelope, task-relevant
capability projection, and orthogonal acceptance state. Use one independent
reviewer only when risk policy requires it.

**Advantages**

- Smallest change that repairs the semantic boundary.
- Reuses Wake, Task Handles, current barriers, exact child publications,
  RuntimeCoordinator, and Space.
- Gives executor and reviewer direct access to authoritative criteria.
- Separates execution truth from acceptance without weakening either.
- Can launch in record-only and shadow-routing modes.
- Keeps cost and latency bounded.

**Costs and risks**

- Requires cross-service schema and projection work.
- Needs a canonical owner for task intent and acceptance.
- Requires privacy-aware goal references.
- A single reviewer can still be wrong; deterministic evidence remains
  necessary.

### Option B: multi-candidate proposal, critique, debate, and Coach graph

Run multiple independent executors or reviewers, exchange critiques, and ask a
Coach or owner to resolve remaining disagreement.

**Advantages**

- Can increase independent finding yield on difficult, decomposable tasks.
- Makes disagreement and uncertainty explicit.
- Provides more evidence when the judge is weaker than a specialist.

**Costs and risks**

- Materially higher tokens, latency, and operational complexity.
- Correlated agents can create confident wrong consensus.
- Rebuttal rounds can add cost without adding verifiable information.
- A weak Coach can still choose a fluent but wrong claim.
- Harder context isolation, privacy, cancellation, and budget policy.
- Poor fit for tasks that are not parallelizable.

### Recommendation

Adopt Option A as the default incremental architecture. Treat Option B as an
opt-in high-risk policy that must earn its use in evaluation. Do not begin with
a general debate framework.

## Recommended Architecture

### 1. `TaskIntent`: immutable goal and authority

Illustrative contract:

```ts
type TaskIntent = {
  taskIntentId: string;
  version: number;
  originalGoalRef: AuthorizedContentReference;
  authoritativeAcceptanceCriteria: AcceptanceCriterion[];
  ownerDecisions: OwnerDecision[];
  constraints: Constraint[];
  nonGoals: NonGoal[];
  evidenceRequirements: EvidenceRequirement[];
  createdBy: ActorReference;
  createdAtMs: number;
};
```

Important properties:

- immutable per version;
- resolvable only through existing authorization;
- owner edits create a new version;
- children receive the same authorized task-intent version;
- the raw goal is not blindly copied into every ledger or diagnostic;
- summaries can cite it but cannot become its replacement.

### 2. `DelegationEnvelope`: coordination without solution capture

Illustrative additive contract:

```ts
type DelegationEnvelope = {
  taskIntentRef: VersionedTaskIntentReference;
  role: "executor" | "reviewer" | "coach";
  requestedOutcome: string;
  requiredCapabilities: CapabilityRequirement[];
  dependencies: AgentTaskHandle[];
  dataScope: DataScope;
  actionScope: ActionScope;
  cognitionScope: CognitionScope;
  evidenceRequirements: EvidenceRequirement[];
  completionPolicy: CompletionPolicy;
  acceptancePolicy: AcceptancePolicy;
  budget: TaskBudget;
};
```

The requested outcome may be Center-authored. It may not replace the
authoritative task intent.

### 3. `CapabilityOffer`: declare fit, then calibrate with evidence

Illustrative projection:

```ts
type CapabilityOffer = {
  subject: AgentProfileReference;
  taskCapabilities: DeclaredCapability[];
  tools: ToolCapability[];
  context: ContextCapability[];
  modalities: Modality[];
  environments: EnvironmentCapability[];
  actionPermissions: ActionPermissionProjection[];
  availability: AvailabilityProjection;
  freshness: Freshness;
  observedEvidence: ObservedCapabilityEvidence[];
  source: CapabilitySource;
  confidence: number;
};
```

Observed evidence should be keyed by a task signature, not a global score:

```ts
type ObservedCapabilityEvidence = {
  taskSignature: TaskSignature;
  sampleSize: number;
  successEstimate: number;
  acceptancePrecision?: number;
  criticalMissRate?: number;
  costEstimate?: number;
  latencyEstimateMs?: number;
  evidenceWindow: TimeRange;
  evaluatorVersion: string;
  uncertainty: number;
};
```

Routing should:

1. filter on hard data, tool, environment, context, modality, and permission
   requirements;
2. reject stale or unauthorized offers;
3. compare eligible candidates using relevant observed evidence;
4. account for uncertainty and exploration policy;
5. optimize cost and latency only inside the eligible set;
6. record the requirements, candidate snapshot, route reason, and evidence
   version.

Model name is metadata, not rank. Self-declared skills are discovery hints, not
proof of quality.

### 4. `ExecutionResult`: evidence-bearing, not self-accepting

```ts
type ExecutionResult = {
  taskHandle: AgentTaskHandle;
  terminalOutcome: AgentTaskTerminalOutcome;
  artifactRefs: ArtifactReference[];
  evidenceRefs: EvidenceReference[];
  performedChecks: CheckResult[];
  unresolvedQuestions: UnresolvedQuestion[];
  dissent: DissentRecord[];
};
```

The executor reports what happened. It does not write final acceptance for its
own work.

### 5. `IndependentReview`: direct criteria, isolated initial context

```ts
type IndependentReview = {
  reviewId: string;
  taskIntentRef: VersionedTaskIntentReference;
  reviewedExecutionResultRefs: ExecutionResultReference[];
  reviewerCapabilitySnapshotRef: CapabilitySnapshotReference;
  verdict:
    | "accepted"
    | "changes_required"
    | "blocked"
    | "unverifiable"
    | "owner_decision_required";
  findings: ReviewFinding[];
  verifiedEvidenceRefs: EvidenceReference[];
  unresolvedQuestions: UnresolvedQuestion[];
  dissent: DissentRecord[];
  confidence: number;
};
```

The initial reviewer context should contain:

- original goal and authoritative criteria;
- owner decisions and real constraints;
- exact artifacts and evidence;
- repository, data, or environment version;
- reviewer data/action/cognition scope.

It should initially omit:

- Center's preferred verdict;
- an implementer's hidden chain of reasoning;
- other reviewers' conclusions.

After the independent pass, a second phase may expose claims and evidence for
adversarial cross-checking.

### 6. `AcceptanceDecision`: a separate canonical projection

```ts
type AcceptanceState =
  | "not_required"
  | "pending"
  | "in_review"
  | "accepted"
  | "changes_required"
  | "blocked"
  | "unverifiable"
  | "owner_decision_required";
```

Execution and acceptance form two orthogonal dimensions:

```text
Execution:
planned -> active -> terminal outcome

Acceptance:
not_required
or
pending -> in_review -> accepted
                    -> changes_required -> new execution/review cycle
                    -> blocked
                    -> unverifiable
                    -> owner_decision_required
```

`all_terminal` means that an execution barrier is satisfied. For
acceptance-required work, it should make evidence ready for review, never write
`accepted`.

### Canonical ownership

A future implementation must choose one Core-owned writer for
`AcceptanceDecision` and expose read projections elsewhere. Remote Agent models
may propose a verdict, but should not become a parallel acceptance authority.
Observability should correlate decisions, not write them.

## Independent Reviewer And Coach Policy

### When one independent reviewer is enough

Use one reviewer when:

- the task has testable acceptance criteria;
- side effects are reversible or bounded;
- a reviewer can inspect exact artifacts and evidence;
- one independent pass meets the evaluated risk policy.

### Wake Coach when

- implementer and reviewer provide materially conflicting evidence;
- required evidence is missing and the reason is disputed;
- a high-risk or irreversible action is proposed;
- review confidence is low while impact is material;
- the maximum executor/reviewer repair loop is exhausted;
- criteria are ambiguous or conflict with an owner decision;
- a critic can generate claims that Center cannot independently verify.

Coach should compare claims and evidence, preserve dissent, and recommend
resolution. Coach does not receive broader action permission merely because it
has a coordination role.

### Adversarial absorption between capable agents

If two eligible agents such as Codex and Claude are selected, use capabilities
and evidence, not brand hierarchy:

1. each independently receives the same authoritative task intent;
2. each produces claims and evidence without seeing the other's conclusion;
3. each can inspect the other's claims and challenge evidence;
4. deterministic checks settle what they can;
5. Coach or owner receives the remaining disagreement and both dissent records.

Do not force consensus. A preserved unresolved disagreement is safer than a
fluent compromise that nobody verified.

## Minimal Prompt And Tool Contract Change Surface

### Prompt: minimal semantic changes

Keep current routing and authorization guidance. Add rules equivalent to:

1. Preserve the original goal and authoritative criteria. A delegation
   instruction may clarify an outcome but must not replace them.
2. Delegate outcomes and evidence requirements, not an unverified technical
   solution.
3. A non-goal limits requested work or actions. It does not prohibit relevant
   inspection, reasoning, challenge, or reporting unless an explicit cognition
   boundary says so.
4. Action permission and cognition scope are separate. Never infer write,
   send, publish, spend, or destructive permission from the ability to reason.
5. Execution terminality is not acceptance. Preserve evidence, uncertainty, and
   dissent.
6. Do not resolve a specialist disagreement by intuition. Verify claims against
   criteria and evidence, request independent review, or escalate.
7. Split work only for real capability, dependency, authority, data, or
   environment boundaries. Keep the executor's internal decomposition intact.

### Wake/delegation tool: additive fields

Prefer an authorized `taskIntentRef` over copying raw sensitive goal text.
Additive fields could include:

- `taskIntentRef`;
- `role`;
- `requiredCapabilities`;
- `dataScope`;
- `actionScope`;
- `cognitionScope`;
- `evidenceRequirements`;
- `acceptancePolicy`.

Keep current `text` as a requested-outcome instruction for compatibility.

### Capability discovery

Add a read-only, model-visible capability query that returns:

- task-relevant offers;
- availability and freshness;
- action permissions separately;
- observed evidence with sample size and uncertainty;
- why a candidate is ineligible.

It must not expose token secrets or let discovery reserve execution.

### Review and acceptance tools

The smallest new surfaces are:

- request an independent review for an execution result;
- read review state and exact findings;
- propose an acceptance decision with evidence;
- record the Core-owned decision or request owner input.

These may be specialized operations or role-aware extensions to delegation and
task coordination. The architectural requirement matters more than tool count.

## Phased Migration Plan

| Phase | Work | Owners | Dependencies | Acceptance | Rollback |
| --- | --- | --- | --- | --- | --- |
| P0: measurement and shadow | Build frozen fixtures and replay harness; log current task rewrite, requirements, candidate set, route reason, result, and human/deterministic acceptance; test prompt changes in shadow | Remote Agent + Evaluation/Data | Versioned traces, privacy review, benchmark corpus | Reproducible baseline; no production routing control; red-line metrics computable | Disable shadow capture; delete only derived benchmark data per retention policy |
| P1: additive intent and acceptance | Add versioned `TaskIntent`, delegation role/scopes, evidence-bearing result, orthogonal acceptance projection, and one independent review under a feature flag | Core Task Coordination + Shared Contracts + Remote Agent + Data/Observability | Consumer-first schema rollout, canonical acceptance owner, migration/retention plan, UI wording | Mixed-version compatibility; no old task relabeled; `all_terminal` cannot write acceptance; one full fixture/replay path and one controlled end-to-end path | Stop new producers first; retain readable inert rows; fall back to legacy continuation without pretending acceptance exists |
| P2: evidence-calibrated routing and selective Coach | Publish task capability offers, observed evidence, uncertainty, routing explanations, and opt-in Coach/adversarial review policy | Agent Profile/Runtime + Core + Remote Agent + Evaluation + Product | P1 evidence contract, enough samples, cost/latency policy, anti-gaming review | Routing beats or matches baseline within red lines; Coach used only by policy; dissent and owner escalation observable | Return to hard requirement filters plus one reviewer; disable learned ranking and Coach independently |

### Compatibility requirements

- Add new fields as optional or versioned until all strict consumers are ready.
- Deploy consumers before producers.
- Preserve old task and continuation semantics; do not backfill `accepted`.
- Do not change RuntimeCoordinator or terminal-outcome authority.
- Keep authorization in existing Core boundaries.
- Preserve exact child publications and Task Handles.
- Treat capability observations as time-bounded evidence, not permanent identity.
- Complete the repository Contract Impact Audit before any eventual
  implementation because shared schemas, Core, Remote Agent, and possibly local
  component consumers are involved.

## Failure Modes And Mitigations

| Failure mode | Mitigation |
| --- | --- |
| Capability offer is stale or exaggerated | freshness, source, sample size, uncertainty, hard eligibility checks |
| Sparse evidence penalizes a new capable agent | uncertainty-aware exploration with bounded risk and shadow evaluation |
| Reviewer copies Center's conclusion | blind initial context and direct task-intent delivery |
| Reviewer and implementer share the same blind spot | deterministic checks; task-family diversity policy only when evaluated |
| Critic invents plausible findings | require evidence references; measure critic false-positive rate |
| Weak judge summarizes instead of verifying | claim-by-claim verification contract; escalate unverifiable claims |
| Multiple agents produce wrong consensus | preserve independent results and dissent; measure wrong-consensus rate |
| Raw original goal leaks sensitive data | authorized references, audience filtering, retention policy, no blanket ledger copies |
| Review loop never terminates | maximum cycles, budget, explicit `blocked`/`owner_decision_required` |
| Coach gains accidental side-effect authority | Coach action scope remains independent and normally read-only |
| Evidence is gamed | versioned evaluators, hidden fixtures, deterministic checks, audit sampling |
| Compaction loses criteria | immutable task-intent reference, invariant-preservation checks |
| Mixed-version strict schemas fail | consumer-first rollout, version negotiation, compatibility fixtures |
| Acceptance becomes a second execution truth | orthogonal projection and one canonical Core writer |
| Cost and tail latency explode | risk-tier policy, parallel cancellation, budget caps, measured opt-in Coach |

## Evaluation System

### Reproducible before/after benchmark

For every fixture:

1. freeze task intent, repository/data snapshot, model and tool versions,
   permissions, context budget, cost budget, and time limit;
2. run A: current Center task rewrite and coordination;
3. run B: capability-preserving contract and independent acceptance policy;
4. use the same eligible candidate pool;
5. run multiple seeds or repeated trials where sampling applies;
6. preserve raw task instructions, tool events, artifacts, evidence, terminal
   outcomes, reviews, dissent, and acceptance;
7. adjudicate with deterministic checks where possible and blinded expert review
   otherwise;
8. report confidence intervals, not only point estimates.

### Minimum fixture families

- under-specified architecture research where the executor should question a
  proposed solution;
- cross-layer defect where a "do not change X" non-goal must not suppress
  inspection or reporting of X;
- implementation with seeded defects and a blind independent reviewer;
- long-context task that crosses compaction;
- read-only review with tempting unauthorized side effects;
- capability mismatch among tool, context, environment, and task domain;
- parallel children with a slow irrelevant tail and fallback;
- conflicting implementer/reviewer evidence requiring owner decision;
- publication failure versus successful execution;
- task that should remain direct because decomposition would reduce quality.

### Metrics

| Metric | Definition |
| --- | --- |
| Goal preservation | Share of authoritative goal clauses still directly addressable in executor and reviewer inputs |
| Handoff loss | Authoritative clauses, owner decisions, or evidence requirements omitted or contradicted across a handoff |
| Scope recall | Material in-scope obligations found and addressed |
| Restriction leakage | Rate at which action/non-goal restrictions incorrectly suppress inspection, reasoning, or reporting |
| Independent finding yield | Valid material findings found only by an independently contextualized reviewer |
| Wrong-consensus rate | Runs where agents agree on acceptance but ground truth says not accepted |
| Terminal-to-acceptance gap | Time and state distance between execution terminality and a justified acceptance decision |
| Critic advantage | Valid errors found with reviewer assistance minus reviewer-induced false findings |
| Judge verification rate | Share of material claims the acceptance actor actually verifies against evidence |
| Capability match | Share of routes satisfying all hard task requirements |
| Routing regret | Quality/cost/latency loss versus the best eligible route observed in replay |
| Acceptance precision and recall | Accuracy of accepted and changes-required decisions |
| Unauthorized-effect rate | Side effects outside `actionScope` |
| Cost and latency | Tokens, tool calls, dollar cost, wall time, p50/p95, and barrier tail wait |
| Retry/Coach amplification | Additional cycles and cost per resolved material issue |

### Proposed red lines

The exact numeric targets require Felix and product-owner approval. The following
are proposed minimum red lines for a controlled rollout:

- zero unauthorized side effects in the benchmark and canary;
- 100% of original-goal and authoritative-criteria references remain
  resolvable by authorized executor and reviewer roles;
- zero path where `all_terminal` alone writes `accepted`;
- zero accepted run with missing required evidence;
- zero critical restriction leakage;
- wrong-consensus rate must not regress at the chosen confidence level;
- critical-defect recall must not regress;
- cost and p95 latency must stay inside a risk-tier budget;
- every acceptance decision must correlate to task intent, execution result,
  evidence, reviewer policy, and decision actor.

Candidate, non-authoritative targets for P1 experiments:

- scope recall at least 95%;
- handoff loss at most 5% and zero loss of a critical criterion;
- positive independent finding yield without a material critic false-positive
  increase;
- target at least 30% relative reduction in wrong consensus on seeded fixtures,
  with confidence intervals reported;
- no more than one default independent review cycle unless risk policy or owner
  escalation explicitly allows more.

### Rollout gates

1. **Offline gate:** benchmark is reproducible and P0 red lines pass.
2. **Shadow gate:** capability router records choices but does not control
   production; compare route and acceptance regret.
3. **Internal opt-in gate:** P1 intent/review flow for reversible, observable
   tasks; manual owner acceptance remains available.
4. **High-risk opt-in gate:** selective Coach or adversarial review only after
   task-family evidence shows net benefit.
5. **Broader gate:** no red-line regression, mixed-version compatibility proven,
   observability complete, rollback rehearsed.

## External Primary Sources

All sources below were accessed on 2026-07-30. They are external inspiration,
not proof of an OpenMeld defect.

| Source | Primary result | OpenMeld mapping | Limit |
| --- | --- | --- | --- |
| [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/) | Agent Cards expose identity, skills, capabilities, input/output modes, and security; Task states distinguish several terminal execution outcomes | Useful shape for capability offers and evidence that "completed" is an execution state | Descriptive skill metadata does not prove task quality; A2A does not supply OpenMeld acceptance truth |
| [MCP Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Peers negotiate capabilities; clients use negotiated features; tool lists can change; tool annotations are untrusted | Support versioned discovery, freshness, and treating declarations as hints | MCP capability negotiation is not an executor-quality ranking |
| [OpenAI Agents SDK Handoffs](https://openai.github.io/openai-agents-python/handoffs/) | A handoff receives conversation history unless an input filter changes it; structured handoff metadata can be passed separately | Shows that context policy and structured task metadata are explicit design choices | Framework behavior is not evidence of OpenMeld behavior |
| [Anthropic: How We Built Our Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) | Subagents use separate contexts and independent trajectories; prompts and tool descriptions matter; parallelism can reduce latency but multi-agent use can be much more expensive; evaluation is essential | Supports isolated reviewer context, outcome-oriented task envelopes, parallel latency measurement, and budget gates | Research tasks parallelize better than many coding tasks; reported costs should not be copied as OpenMeld forecasts |
| [OpenAI: Finding GPT-4's Mistakes with GPT-4](https://openai.com/index/finding-gpt4s-mistakes-with-gpt-4/) | Human plus critic assistance found more issues than unassisted review, while critics can also introduce plausible false findings | Supports measuring critic advantage rather than trusting critique by default | Study conditions and short model answers do not establish OpenMeld production benefit |
| [Kenton et al., On Scalable Oversight with Weak LLMs Judging Stronger LLMs](https://arxiv.org/abs/2407.04622) | Debate and consultancy results are task-dependent and mixed | Supports task-family evaluation and avoiding universal debate policy | Does not define an OpenMeld orchestration contract |
| [Elasky et al., Weak Verifiers, Strong Provers](https://arxiv.org/abs/2605.27483) | Proposer-critic gains depend on critic classification advantage and a judge able to verify surfaced claims; one independent critique captured much of the benefit in studied verifiable tasks | Supports one-reviewer-first design and claim verification before more debate | Results concern programmatically verifiable code/logic tasks and must be replicated on OpenMeld fixtures |

## Prior Repository Research Absorbed

This snapshot builds on, but does not repeat:

- `developing/architecture/review/2026-07-agent-collaboration-efficiency-evaluation-idea.md`:
  controlled evaluation of collaboration quality and cost;
- `developing/architecture/review/2026-07-work-loop-collaboration-efficiency-metrics.md`:
  task-loop and handoff-efficiency metrics;
- `developing/architecture/review/2026-07-proactive-agi-pick-protocol-research.md`:
  external settlement, evidence, abstention, and preserving dissent rather
  than letting the execution actor write its own success.

Adversarial check against those snapshots:

- The current coordination layer has stronger terminal and continuation
  machinery than a generic "executor self-reports success" description implies.
  The missing layer is acceptance, not reliable terminality.
- Current routing guidance already rejects a fixed Organization matrix and
  unnecessary decomposition. The missing input is task-specific capability
  evidence, not a wholesale prompt reversal.
- Current child publications remain exact and readable. The risk is semantic
  handoff and adjudication, not proof that every output is already collapsed.
- External debate results are mixed. They do not justify a permanent
  multi-agent debate loop.

## What Not To Do

- Do not hard-code `Grok > Codex > Claude` or any other model ladder.
- Do not infer task capability from Agent Profile identity or Wake readiness.
- Do not let a capability discovery projection reserve execution or bypass
  Core authorization.
- Do not make D1 observability or Dispatch Ledger the execution or acceptance
  writer.
- Do not copy raw user goals into every diagnostic or reviewer context without
  authorization and retention controls.
- Do not let executor terminal status write acceptance.
- Do not make every task multi-agent.
- Do not require all reviewers to agree.
- Do not hide dissent to produce a cleaner final answer.
- Do not add retry/debate loops without maximum cycles, budgets, and owner
  escalation.
- Do not treat a non-goal as a ban on relevant inspection or reporting.
- Do not widen side-effect permission because cognition is open.
- Do not replace current Wake, Space, RuntimeCoordinator, Stop, or publication
  contracts with a large orchestration rewrite.

## Unproven Questions And Felix Decisions

### Needs evidence

- How often does Center's current task rewrite omit or distort a material goal
  clause?
- Does Flue compaction lose authoritative criteria or dissent in realistic
  long-running Center tasks?
- How often does `all_terminal` create meaningful tail latency?
- What is the baseline wrong-consensus rate for current Center synthesis?
- Which task families gain from one reviewer, two reviewers, or no reviewer?
- Can current Agent Profile metadata legally and safely expose the tool/model
  details required for task routing?
- Which observed capability evidence is robust enough to resist gaming and
  model/version drift?

### Needs Felix or owner decision

- Which tasks require acceptance, and which legitimately use
  `not_required`?
- Who is the canonical Core owner of `TaskIntent` and `AcceptanceDecision`?
- Are authoritative criteria written by the user, Center, product policy, or a
  merge of versioned sources?
- When may an owner override a reviewer, and how is the reason published?
- What risk tiers justify one reviewer, Coach, or adversarial review?
- What cost and p95 latency budgets apply per risk tier?
- Which original-goal content may be shared with local, native, or third-party
  agents?
- How long should capability observations, reviews, dissent, and task intent be
  retained?
- What benchmark thresholds are required before routing evidence controls a
  production decision?

## Owner-Document Compatibility Check

The recommendation is compatible in principle with the inspected owner
documents only if a future implementation preserves these rules:

- RuntimeCoordinator remains workstation in-flight execution truth.
- Agent Profile remains identity; readiness remains Core-owned.
- D1 remains a ledger/projection, not execution authority.
- Queue remains a reliable conveyor.
- Binding and claim eligibility remain policy projections.
- Space remains the publication surface and source of Space truth.
- Local OpenMeld Service remains a carrier and trust boundary.
- live invalidation remains a refresh signal.
- shared cross-service contracts use `packages/schemas`.
- one canonical owner writes acceptance; no dual-track acceptance fact.
- action authorization remains fail-closed.

Any implementation must update the relevant owner document in the same change
if it alters one of those rules.

## Repository Evidence Register

The research inspected the following current source and owner-document
surfaces. Paths are repository-relative.

| Path / symbol | Observed behavior | Architectural relevance / potential impact | Confidence |
| --- | --- | --- | --- |
| `AGENTS.md` | Routes authority, source-of-truth, testing, contract-impact, and production rules | Defines non-negotiable boundaries for this research | High |
| `developing/product/organizations-and-center-agent.md` | Defines Center coordination, Organization authority, and current product semantics | Center owner contract | High |
| `developing/product/agent-model-selection.md` | Separates Agent Profile model preference from readiness and execution | Prevents model preference becoming routing authority | High |
| `developing/product/agent-profiles.md` | Defines Agent Profile identity and Binding semantics | Identity is not capability proof | High |
| `developing/product/space-collaboration.md` | Defines Wake, Space publication, replies, and collaboration semantics | Preserves Space ownership | High |
| `developing/product/remote-agent-runtime.md` | Defines Center native runtime, history/compaction, tools, and delivery | Remote Agent owner contract | High |
| `developing/product/center-agent-routines.md` | Defines Routine/Run authority, targets, delivery, and continuation | Shows all-terminal Routine continuation boundary | High |
| `developing/architecture/agent-transport-contract.md` | Defines Wake execution, RuntimeCoordinator, final outcomes, Stop, and trace | Terminal execution truth must remain intact | High |
| `developing/architecture/data-and-observability.md` | Defines task coordination, ledgers, projections, and D1 ownership | Acceptance must not turn observability into authority | High |
| `developing/architecture/shared-contracts.md` | Defines shared schema and ACI projection ownership | Future contract belongs in shared schemas | High |
| `services/remote-agent/agent-core/prompt/execution-routing.ts` | Requires live requirement inference; discourages unnecessary splitting and fixed matrices | Good current routing principle; underpowered evidence surface | High |
| `services/remote-agent/agent-core/prompt/task-coordination.ts` | Center owns coordination and chooses child-direct versus continuation modes | Center is practical synthesis point | High |
| `services/remote-agent/agent-core/prompt/tools-guidance.ts` | Woken child sees only sent instruction, not Center conversation | Direct evidence for task-intent gap | High |
| `services/remote-agent/agent-core/prompt/principles.ts` | Requires verification and route selection | Good evidence principle | High |
| `services/remote-agent/agent-core/model.ts` | Center has a configured default model and environment override | Fixed Center runtime is not an executor rank | High |
| `services/remote-agent/agent-core/tools.ts` / Wake tool | Wake input contains targets, completion policy, fallback, Space, and one text instruction | No typed original goal, criteria, role, scopes, or acceptance | High |
| `services/remote-agent/agent-core/tools.ts` / list/watch tools | Exposes task state and completion subscriptions | Coordination visibility exists | High |
| `packages/schemas/src/schemas/http/center-agent.ts` | HTTP Wake and task responses carry targets, text, modes, Task Handles, states, and outcomes | Confirms public contract shape | High |
| `packages/schemas/src/schemas/runtime/agent-task-coordination.ts` | Defines terminal states, barriers, continuation, and snapshots | No acceptance/review/evidence/dissent state found | High |
| `packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts` | Continuation carries delegation snapshot and outcome | Structurally reliable, semantically narrow | High |
| `services/core/src/center-agent/application/center-agent-delegation-service.ts` | Registers child tasks, parent links, subscriptions, and completion policy | Reusable coordination foundation | High |
| `services/core/src/agent-task-coordination/application/agent-task-terminal-outcome-service.ts` | Applies authoritative terminal outcomes and propagation | Terminality is not the missing reliability layer | High |
| `services/core/src/agent-task-coordination/application/agent-task-continuation-service.ts` | Builds snapshots and resumes the observer task | Continuation has no task-intent or acceptance projection | High |
| `services/core/src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo.ts` | Evaluates `all_terminal`, `first_success`, failure, and completion from task state | Direct evidence that barriers settle execution coordination | High |
| `packages/db/src/core/agent-task-coordination.schema.ts` | Persists terminal outcomes, subscriptions, delegation, and activation state | No separate goal-acceptance state in inspected tables | High |
| `services/core/src/center-agent/application/product-operations.ts` | Projects ready/connectable local candidates and operational metadata | Insufficient task-cognition evidence for comparative routing | High |
| `services/core/src/rpc/methods.ts` / `rpcGetCurrentOrganizationDirectory` and `rpcCenterAgentGetOrganizationDirectory` | Projects Agent Profile identity/status/readiness | Directory is not a task-capability catalog | High |
| `packages/schemas/src/schemas/runtime/agent-controller-interface.ts` | Local controller snapshot can describe operational capabilities, models, and skills | Possible declared-capability source | High |
| `clients/openmeld-cli/src/local-service/reporting/agent-controller-interface-cloud-projection.ts` | Removes model and skill inventories from cloud projection | Confirms Center cannot rely on those inventories today | High |
| `services/core/src/center-agent/application/center-agent-wake-publication-service.ts` | Prepares delegation, publishes, then activates accepted targets | Correct durable ordering | High |
| `services/core/src/rpc/methods.ts` / Center Wake RPC | Validates targets and publishes exact Center-authored text | Confirms delegation source text | High |
| `services/core/src/space/transport/do/space.ts` | Builds per-target dispatch outbox from source text, signal, and continuity | Child receives more than a handle, but not immutable user intent | High |
| `services/core/src/remote-agent/application/turn-envelope.ts` | Builds continuation turn envelope from coordination input | No frozen original goal found | High |
| `services/core/src/remote-agent/application/native-delivery-service.ts` | Submits continuation with task IDs, statuses, outcomes, and result-reading guidance | Reliable wakeback, no acceptance contract | High |
| `services/remote-agent/agent-core/turn-envelope.ts` | Renders child completion status and asks Center to complete continuation | Center remains synthesis actor | High |
| `services/remote-agent/flue-adapter/conversation-compaction.ts` | Observes compaction structure | No semantic invariant comparison found | Medium-high |
| `services/remote-agent/flue-adapter/model.ts` | Retains a recent raw-message token window alongside compacted context | Provides basis for compaction-loss fixture | High |

Searches across the inspected production scopes found no first-class
`IndependentReview`, Coach role, task-level `AcceptanceState`, cognition scope,
or preserved dissent contract. This is a scoped negative finding, not proof
that no unrelated experimental code exists anywhere in the repository.
