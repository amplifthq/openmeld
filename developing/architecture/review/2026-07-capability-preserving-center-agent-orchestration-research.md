# Capability-Preserving Center Agent Orchestration

## Agent Context

- Purpose: Preserve a dated, primary-source evidence base for deciding how a
  general-purpose Center Agent can coordinate agents that may be more capable
  than the Center Agent without narrowing their technical judgment.
- Read this when: Designing Center Agent delegation briefs, task leadership,
  reviewer independence, capability-aware routing, completion barriers, or
  multi-agent evaluation.
- Update this when: OpenMeld changes its delegation contract, exposes new
  Agent Profile capability evidence, runs the proposed evals, or a cited
  primary source changes materially.
- Do not use this for: Claiming that OpenMeld already implements the proposed
  mechanisms, removing permission or safety controls, ranking models from
  marketing names alone, or authorizing external actions.
- Source of truth: Linked primary sources own the external facts. This file
  owns only this dated research synthesis and its explicitly labeled OpenMeld
  design inferences.

Date: 2026-07-30

Status: RESEARCH SNAPSHOT — NOT A DESIGN DECISION. Remove or distill this file
when reviewed owner documents and implementation contracts supersede it.

## Question

How should a general collaboration system behave when a central coordinator
may be less capable on the task than the agents it dispatches?

The failure to avoid is not merely a weak answer. It is **capability
suppression**: a coordinator converts its own assumptions into fixed scope,
expected conclusions, or reviewer non-goals, so stronger specialists produce
excellent local work inside the wrong frame.

## Bottom Line

The most general correction is:

> The Center Agent should own the coordination control plane, while delegated
> agents own task-level cognition inside the user's authority envelope.

This is not a request for an unconstrained system. It separates two different
types of constraint:

1. **Action constraints** protect authority, safety, cost, data, and external
   side effects. They should remain hard and deterministic.
2. **Conclusion constraints** pre-decide architecture, suppress cross-boundary
   findings, or tell a reviewer what must not count as a problem. They should
   not be invented by the coordinator.

In short: **constrain authority, not judgment**.

OpenMeld should preserve the original user outcome and authoritative
boundaries, give capable specialists room to plan and challenge the brief,
preserve independent dissent, and evaluate the composed result against the
original outcome. The Center Agent may route, budget, wait, retry, and
synthesize status. It should not silently become the final technical authority
simply because it occupies the center of the graph.

## What The Primary Sources Actually Establish

### Manager control and specialist control are different orchestration modes

The OpenAI Agents SDK distinguishes two patterns:

- in **agents-as-tools**, a manager retains the conversation and final-answer
  control while calling specialists for bounded subtasks;
- in a **handoff**, the specialist becomes the active agent for the rest of the
  turn.

The official guidance says handoffs fit cases where the specialist should
respond directly or own the next part of the interaction, while the manager
pattern fits cases where one agent must combine specialist outputs or enforce
shared guardrails. This is an architectural choice, not a cosmetic API
difference. [OpenAI Agents SDK: Agent orchestration][openai-orchestration]
[OpenAI Agents SDK: Handoffs][openai-handoffs]

OpenAI's broader guide similarly describes manager and decentralized patterns
as different control topologies. It also recommends first establishing a
performance baseline with the most capable model for each task before replacing
it with a smaller model, specifically to avoid prematurely limiting the
system's ability. [OpenAI: A practical guide to building agents][openai-guide]

**OpenMeld inference:** When the Center Agent is not the strongest task-level
reasoner, a manager pattern that lets it pre-decide the plan and reinterpret all
results is the wrong default for high-judgment work. The Center Agent can remain
the durable lifecycle coordinator while assigning **task leadership** to the
best available specialist. This is closer to a semantic handoff than an
agent-as-tool call, even when the user-facing reply still returns through the
Center Agent.

### Effective orchestrators supply objectives and boundaries, not predetermined paths

Anthropic's production research system gives subagents an objective, output
format, tool/source guidance, and clear task boundaries. It also lets subagents
plan, evaluate results, identify gaps, and refine their next action. Anthropic
explicitly says its prompting strategy emphasizes heuristics rather than rigid
rules. [Anthropic: How we built our multi-agent research system][anthropic-multi-agent]

Anthropic also reports that multi-agent systems can take different valid paths
from the same starting point, so evaluation should judge whether the system
achieved the right outcome and followed a reasonable process rather than
requiring one prescribed path. It warns that small changes to the lead agent
can unpredictably change subagent behavior and says collaboration prompts
should define division of labor, problem-solving approaches, and effort
budgets—not merely accumulate strict instructions.
[Anthropic: multi-agent evaluation and reliability][anthropic-multi-agent]

**OpenMeld inference:** A useful delegation brief is detailed about the
outcome, authority, evidence, environment, and deliverable. It is deliberately
non-prescriptive about conclusions that require domain judgment. "Review this
PR against the original billing outcome" is a boundary. "Do not treat the
missing projector as a problem" is a conclusion, unless the user or a settled
product decision explicitly made it a non-goal.

### A weaker judge should not rely on one unchallenged stronger consultant

Google DeepMind's scalable-oversight study directly tests weaker LLM judges
evaluating stronger LLM agents. Across its tested tasks, debate outperformed
consultancy when the consultant was randomly assigned a correct or incorrect
position. In open consultancy, weak judges were similarly persuaded whether
the stronger consultant chose the correct or incorrect answer; the authors
warn that this can amplify incorrect behavior. Open debate reduced that
failure, although results versus direct answering were task-dependent and
mixed outside information-asymmetric extractive tasks.
[Kenton et al.: On scalable oversight with weak LLMs judging strong LLMs][weak-judge-paper]

The same paper finds that stronger debaters modestly improved weak-judge
accuracy, but also reports important limitations: more debate turns did not
reliably help, and asking the weak judge to rely on its own chain-of-thought
could hurt, possibly because it discounted stronger agents' verbalized
reasoning.

OpenAI's weak-to-strong research reaches a compatible warning in a different
training setup: naive weak supervision can teach a strong model to imitate the
weak supervisor's errors, while methods that permit confident disagreement can
recover more of the strong model's latent capability. The result is a proof of
concept, not a direct orchestration benchmark, and it did not recover the full
strong-model capability. [OpenAI: Weak-to-strong generalization][weak-to-strong]

**OpenMeld inference:** When a weaker Center Agent cannot independently verify
a technical dispute, it should not settle the dispute by rewriting the strong
agent's conclusion. It should commission independent opposing analysis,
preserve both evidence packets, use deterministic verification where possible,
and escalate the remaining material choice. The Center Agent is a judge of
task state; it is not automatically a qualified judge of every domain claim.

### Capability discovery should precede routing

The A2A specification treats a remote agent as an opaque system whose internal
tools and memory need not be exposed. Its Agent Card instead publishes
identity, interaction capabilities, authentication requirements, and concrete
skills with descriptions, examples, and supported input/output modes. Clients
use this declared capability surface to determine suitability and structure a
request. [A2A: Agent discovery][a2a-discovery]
[A2A: Core concepts][a2a-concepts]

**OpenMeld inference:** OpenMeld does not need to expose private chain of
thought or controller internals to route well. It needs a trustworthy,
task-relevant **Agent Capability Snapshot**. Model identity can be one signal,
but task-specific skills, tools, environment access, reasoning mode, context
limits, past evals, and current readiness are more useful than a global
"stronger/weaker" label.

### A planning-heavy orchestrator is itself a high-capability role

Microsoft's Magentic-One gives its Orchestrator responsibility for
decomposition, planning, progress tracking, and replanning, and explicitly
recommends a strong reasoning model for that role. Anthropic's published
research architecture likewise used Opus as the lead and Sonnet subagents in
the reported configuration. [Microsoft AutoGen: Magentic-One][magentic-one]
[Anthropic: How we built our multi-agent research system][anthropic-multi-agent]

**OpenMeld inference:** These systems do not show that a weaker model can
reliably own technical planning for stronger workers. They show the opposite
design assumption: when the orchestrator owns cognition-heavy planning and
synthesis, that role benefits from a strong model. OpenMeld should therefore
either:

1. assign task-level leadership to a sufficiently capable specialist; or
2. keep a weaker Center Agent's role thin and mechanically verifiable.

Model heterogeneity is not itself a problem. Unacknowledged **authority and
capability inversion** is.

## Current OpenMeld Contract Gap

This section describes the current reviewed contract surfaces. It does not
claim that task coordination is broken. The existing contract is strong at
execution coordination; the missing layer is semantic goal acceptance.

### Delegation is currently carried as free text

`centerAgentWakeAgentProfilesInSpaceBodySchema` in
`packages/schemas/src/schemas/http/center-agent.ts` currently carries:

- target and fallback Agent Profile ids;
- a completion mode;
- represented-member and Reference context;
- a Space id; and
- one free-text `text` field.

`centerAgentWakePublicationCommandSchema` freezes the same text in its v1
publication command. The hosted prompt correctly tells the Center Agent to
write a clear, self-contained instruction, choose a capable path, and choose a
completion barrier. That is enough to dispatch useful work, but the text is
also the only place to encode:

- the original user goal;
- acceptance criteria;
- explicit user-approved deferrals;
- hard authority boundaries;
- Center Agent suggestions;
- Center Agent hypotheses; and
- the requested evidence or reviewer stance.

Those facts have different authority and challengeability, but free text gives
them no machine-checkable provenance. A coordinator can therefore phrase its
own assumption like an authoritative non-goal, and the child has no contract
signal that it may challenge it.

### Completion modes coordinate time, not acceptance

`packages/schemas/src/schemas/runtime/agent-task-coordination.ts` cleanly owns
Task Handles, completion conditions, barriers, child states, and terminal
outcomes. A terminal outcome records execution facts such as:

```text
succeeded | completed | failed | stopped | stayed_silent | publication_failed
```

The continuation receives the exact delegation snapshot and matching terminal
outcome. This proves when a child reached an authoritative execution or
publication state. It does not prove that:

- the child's result satisfies the original requirement;
- every acceptance criterion was checked;
- independently passing slices compose into one working system;
- a reviewer remained independent from the implementation frame; or
- a high-severity dissent was resolved.

This distinction already agrees with OpenMeld's owner rule that the Center
Agent judges fulfillment at the user-goal level. The gap is that the user-goal
contract and its settlement are not yet preserved as first-class delegation
data. Today, `all_terminal` can correctly resume a parent after all children
finish, but nothing in the coordination schema makes `all_terminal` equal
`goal_accepted`. It must never be interpreted that way.

### The required correction is additive

OpenMeld should not overload Task Handle terminal truth with semantic quality.
RuntimeCoordinator, native delivery, and Agent Task Coordination should keep
owning execution truth. Add a separate, versioned goal/assessment layer that
references those exact tasks and outcomes.

## General Failure Modes

### 1. Inferred non-goals become hard constraints

The coordinator decides that a missing cross-platform path, security property,
or integration step belongs to "later," then places that decision in every
child prompt. Reviewers correctly obey the brief and never test the original
requirement.

### 2. Slice-local success is promoted to goal completion

Every individual task passes its local tests, but no agent is asked to trace
the composed user journey. The coordinator counts terminal children instead of
settling the original outcome.

### 3. The manager summary destroys epistemic detail

Specialists return evidence, uncertainty, and disagreements. The coordinator
compresses them into "approved" or "no findings," so later reviewers cannot
recover what was actually established.

### 4. A reviewer inherits the implementer's frame

The reviewer receives the implementation plan, expected approval, and a list
of acceptable omissions. It becomes a confirmation pass rather than an
independent attempt to falsify the result.

### 5. The central position is mistaken for domain authority

The coordinator is allowed to overrule a specialist because it owns routing
and publication, even when it has neither better domain capability nor stronger
evidence.

### 6. "Fewer restrictions" removes real safety boundaries

A reaction to over-constraint removes permission checks, budgets, stop rules,
or destructive-action approval. This confuses freedom to reason with authority
to act.

### 7. Capability is guessed from branding

The system permanently ranks providers or model names without a
task-specific, versioned evaluation. A generally capable model may still lack
the environment, tools, context, or specialization needed for one task.

### 8. Debate is treated as a universal truth machine

The weak-judge evidence is promising but task-dependent. Adding more rounds,
more agents, or more prose does not guarantee a better verdict. Debate must
produce checkable claims and be evaluated against real outcomes.

## Proposed OpenMeld Mechanisms

Everything in this section is a design inference to test, not a settled
production contract.

### 1. Make the Center Agent a control-plane coordinator

Use an explicit ownership table:

| Concern | Canonical owner |
| --- | --- |
| Desired outcome and material product choices | User or settled owner document |
| Permission, identity, secrets, external side effects | Core policy and user authority |
| Agent discovery, dispatch, budget, dependency graph, barriers, retry, cancellation, publication | Center Agent plus Core coordination |
| Technical decomposition, investigation, implementation approach, and findings | Task lead specialist |
| Independent acceptance against the original outcome | Independent reviewer or verifier |
| Unresolved material disagreement | User or explicitly authorized higher-confidence adjudicator |

The Center Agent may propose a technical decomposition. It must present that
decomposition to the task lead as a **working plan**, not an immutable fact.

### 2. Introduce constraint provenance

Every nontrivial delegated constraint should be typed:

| Kind | Meaning | May the child challenge it? |
| --- | --- | --- |
| `authority_boundary` | Permission, identity, data, secret, destructive-action, or deployment limit enforced by the system/user | No; the child may report that it blocks the goal |
| `acceptance_criterion` | User-stated or owner-document outcome | It may expose ambiguity or conflict, but not silently discard it |
| `explicit_deferral` | A named omission explicitly approved by the user or authoritative owner | It may report downstream risk; it cannot treat the omitted work as authorized |
| `coordination_hint` | Suggested split, order, files, or method | Yes |
| `working_hypothesis` | Coordinator inference about cause, architecture, priority, or likely result | Yes; designed to be falsified |

Each item should carry `source`, `scope`, `recordedAt`, and an explicit
override/escalation rule. The Center Agent must not promote
`coordination_hint` or `working_hypothesis` into `authority_boundary`.

This is the central structural fix. It prevents model-written prose from
silently laundering an orchestration opinion into user authority.

### 3. Use a loss-minimizing delegation brief

A general `Delegation Brief` should carry:

```text
original user outcome
authoritative acceptance criteria
authority and side-effect envelope
trusted context and evidence pointers
available environment/tools
requested artifact and verification evidence
completion/reporting contract
coordination hints, clearly labeled as challengeable
```

It should not carry an expected verdict, a target number of findings, or
coordinator-invented "non-issues."

The original request and authoritative criteria should remain separately
addressable rather than existing only inside a coordinator summary. Summaries
can save context, but they must not replace the source contract.

A candidate additive schema is:

```text
DelegationBrief.v1
  briefId
  goal
    sourceKind
    sourceLocator
    statement
  acceptanceCriteria[]
    criterionId
    statement
    sourceKind
    sourceLocator
  constraints[]
    constraintId
    kind
    statement
    sourceKind
    sourceLocator
    challengeable
  requestedEvidence[]
  coordinationHints[]
  workingHypotheses[]
  taskLeadership
  createdAtMs
```

`sourceLocator` should refer to a trusted OpenMeld message, owner-document
version, policy, or explicit user decision. It is evidence provenance, not a
new authorization path. Core continues to enforce real authority through its
existing contracts.

### 4. Give specialists a first-class right to challenge the brief

A delegated agent should be able to return a structured `scope_challenge`
without treating the task as failed:

```text
kind: scope_challenge
affectedCriterion
claim
evidence
whyCurrentSplitCannotSettleTheGoal
proposedNextStep
requiresAdditionalAuthority
```

Examples:

- the assigned slice is locally correct but cannot satisfy the original
  end-to-end outcome;
- a declared non-goal contradicts an acceptance criterion;
- the coordinator supplied stale or incomplete evidence;
- a proposed task split creates two sources of truth;
- completing the fix requires authority not currently granted.

The Center Agent may reject the proposed action when it exceeds authority. It
must not erase the finding.

### 5. Separate task leadership from result publication

OpenMeld already separates child execution from parent continuation through
completion modes. Add a separate semantic decision:

```text
taskLeadership:
  center_agent | delegated_agent | peer_panel
```

- `center_agent` fits low-judgment routing, formatting, or tasks where the
  Center Agent has demonstrated sufficient capability.
- `delegated_agent` fits work where one specialist should own decomposition and
  technical decisions while the Center Agent monitors lifecycle.
- `peer_panel` fits high-risk or disputed work where independent specialists
  should produce competing evidence.

The user-facing reply may still be published by the Center Agent. Publication
ownership must not imply technical-decision ownership.

### 6. Add task-specific capability snapshots

Before routing high-judgment work, the Center Agent should receive a bounded,
trusted projection such as:

```text
agentProfileId
controllerKind
modelSelection and reasoning mode
declared task skills
available tools and environment
context and modality limits
current readiness and permission mode
task-family eval evidence
known limitations
snapshot version and freshness
```

Routing should prefer task evidence over a universal rank. If the system lacks
enough evidence to compare the Center Agent and candidate specialists, the
safe epistemic default is **non-interference**: preserve the specialist's
judgment and require evidence for any coordinator override.

### 7. Make review independent by construction

For an adversarial review, provide:

1. the original user outcome;
2. authoritative constraints and explicit user-approved deferrals;
3. the final artifact or composed code state;
4. test and runtime evidence;
5. a request to falsify completion.

Do not provide the implementer's expected conclusion as a system-level fact.
Do not tell the reviewer which risks "must not" count unless that exclusion has
authoritative provenance.

The reviewer should return structured findings:

```text
criterion
verdict: supported | contradicted | unknown
severity
claim
evidence
reproduction or verification
confidence
required authority, if any
```

A separate settlement shape can compose those findings:

```text
GoalSettlement.v1
  goalId
  status: supported | contradicted | unknown
  criterionAssessments[]
    criterionId
    verdict: supported | contradicted | unknown
    evidenceRefs[]
    assessorTask
  unresolvedFindings[]
  composedArtifactRefs[]
  settledBy
  settledAtMs
```

`GoalSettlement` must reference exact Task Handles and terminal outcomes but
must not replace them. Execution can be terminal while settlement remains
`unknown` or `contradicted`.

### 8. Require both local and composed acceptance

Use two different gates:

- **slice acceptance** checks whether each bounded change satisfies its local
  contract;
- **goal settlement** checks the final composed state against the original
  user journey and cross-cutting invariants.

Goal settlement should trace real boundaries, such as:

```text
input -> authorization -> durable state -> execution -> recovery
      -> cross-platform projection -> user-visible terminal outcome
```

No count of locally approved children should automatically mark the parent
goal complete.

### 9. Preserve disagreement instead of asking the Center Agent to invent consensus

When specialists disagree, the Center Agent should:

1. normalize each claim into the same evidence schema;
2. run available deterministic checks;
3. ask each side to address the other's strongest evidence;
4. identify the unresolved material point;
5. escalate only the remaining decision.

It may synthesize status and remove duplicate wording. It must not silently
drop a high-severity minority finding because another agent said "approve."

### 10. Keep deterministic safety controls

The following remain infrastructure-owned even in delegated-lead mode:

- exact identity and represented-member authority;
- allowed tools, Apps, Projects, Agent Profiles, and data scope;
- secrets and credential isolation;
- destructive-action approval;
- budgets, maximum fan-out, deadlines, and stop rules;
- exact Task Handles, terminal evidence, retries, and cancellation;
- result destination and publication authority.

These controls limit what an agent may do, not what it may notice or report.

## Proposed Invariants

These invariants are more important than the exact field names:

1. **Goal preservation:** Every delegated child that can affect acceptance can
   recover the same original goal and criterion ids; a Center Agent summary is
   not the sole copy.
2. **Authority provenance:** Only a trusted user, policy, or owner decision may
   create a non-challengeable boundary or explicit deferral.
3. **No constraint laundering:** Center Agent hints and hypotheses remain
   challengeable after serialization, rendering, continuation, and compaction.
4. **Specialist challenge:** A child may report a scope or premise conflict
   without taking an unauthorized action and without its task being rewritten
   as failed.
5. **Completion is not acceptance:** No terminal child status, barrier, or
   publication result directly sets a goal criterion to `supported`.
6. **Independent review:** An acceptance reviewer receives the original
   criteria and artifact evidence without inheriting an expected verdict.
7. **Evidence-preserving synthesis:** The Center Agent may summarize duplicate
   wording but cannot delete, downgrade, or invert a material finding without a
   new evidence-linked assessment.
8. **Dissent survives:** Conflicting high-severity assessments remain visible
   until deterministic evidence, an authorized reviewer, or the user settles
   them.
9. **One execution truth:** Task Handles, lifecycle, terminal outcomes,
   cancellation, and publication remain owned by the existing coordination and
   runtime contracts.
10. **Fail honestly across versions:** A consumer that cannot preserve a
    required brief or assessment reports that capability gap; it does not
    silently downgrade high-judgment work to unstructured acceptance.

## Evaluation Plan

Anthropic's guidance favors outcome-based evals because valid agent paths vary,
and OpenAI recommends establishing the strongest-model baseline before
optimizing model cost. OpenMeld should therefore evaluate orchestration as a
possible source of capability loss, not only evaluate each model separately.

### Core metrics

| Metric | What it catches |
| --- | --- |
| **Delegation fidelity** | Percentage of original acceptance criteria and authoritative boundaries preserved in every relevant child brief |
| **Constraint laundering rate** | Coordinator hypotheses or hints that become unchallengeable child constraints |
| **Capability retention** | Task score of a strong agent under OpenMeld orchestration divided by its score with the same authority/tools acting directly |
| **Orchestration regret** | Direct strong-agent score minus orchestrated score; positive values mean coordination made the result worse |
| **Cross-boundary defect recall** | Planted end-to-end defects found after all local slices pass |
| **Dissent survival** | Material minority findings still visible in the final evidence packet |
| **Premature terminal rate** | Parent goals marked complete before their outcome contract is settled |
| **Human correction load** | Manual prompts required to continue, restore scope, or request a missing system-level review |
| **Authority violations** | Attempts outside explicit permissions; this must not rise when cognitive freedom rises |
| **Cost and latency** | Additional turns, tokens, wall time, and tool calls needed for each quality gain |

### Minimum adversarial benchmark

Construct tasks where:

- every isolated slice is correct but the composition is broken;
- the coordinator's initial hypothesis is plausible but wrong;
- a user requirement conflicts with a coordinator-invented non-goal;
- one reviewer is anchored on the implementation plan and another sees only
  the original requirement and final artifact;
- the strongest specialist must challenge the task split to succeed;
- an apparent capability advantage is false because the agent lacks the
  required environment or tool;
- a dangerous action is correctly blocked while the agent still reports the
  technical finding.

Run at least these variants:

1. current manager-style prompting;
2. thin coordinator plus delegated task lead;
3. independent implementer/reviewer with evidence-preserving synthesis;
4. peer debate only for unresolved high-risk claims.

The success condition is not "more agents found more issues." It is improved
goal accuracy with no increase in authority violations and an acceptable
cost/latency tradeoff.

## Practical Rollout Sequence

### Phase 0 — Prompt and evaluation only

- State that the Center Agent coordinates capability and lifecycle; it does not
  pre-decide specialist conclusions.
- Label hard boundaries separately from suggestions and hypotheses.
- Require delegated agents to report scope conflicts.
- Give final reviewers the original goal and composed artifact.
- Add capability-retention and cross-boundary-defect evals before schema work.

This phase should also add a prompt invariant: `completionMode` selects when
the Center Agent continues; it never states whether the user goal passed.

### Phase 1 — Add readers and typed evidence contracts

- Add versioned `DelegationBrief` and `GoalSettlement` schemas under
  `packages/schemas`.
- Deploy parsers and persistence that accept the current v1 free-text command
  plus the additive structured form before any producer emits it.
- Keep the existing `text` field as the human-visible and legacy-controller
  instruction. Render the structured brief losslessly into that instruction
  for a consumer that cannot yet ingest structured data.
- Preserve one stable `briefId` across publication retries and parent
  continuations.
- Add constraint provenance to the delegation brief.
- Add `scope_challenge` and structured assessment outputs.
- Preserve original outcome references through continuations.
- Store dissent and unknowns without converting them into a binary approval.

### Phase 2 — Dual-write from the Center Agent

- Make the hosted Center Agent tool emit both the ordinary Space text and the
  structured brief.
- Keep current authorization, Wake publication, Task Handle, and completion
  semantics unchanged.
- Expose whether each selected Agent runtime can consume the structured form.
- For high-judgment tasks, report an explicit compatibility limitation instead
  of silently discarding acceptance criteria or provenance.

### Phase 3 — Structured child assessment

- Teach capable local and hosted Agent adapters to return criterion-linked
  assessments and `scope_challenge` artifacts.
- Preserve their ordinary visible report; the structured assessment is a
  durable evidence projection, not a replacement for the Agent's artifact.
- Start with read-only review and research tasks before using the contract for
  implementation acceptance.

### Phase 4 — Capability-aware task leadership

- Project task-relevant capability snapshots.
- Select `center_agent`, `delegated_agent`, or `peer_panel` leadership.
- Keep Core completion, authority, and publication invariants unchanged.

### Phase 5 — Goal settlement and adaptive oversight

- Use real eval evidence to tune routing and fan-out.
- Trigger independent debate only for material unresolved claims.
- Route irreversible or product-defining disagreements to the user.
- Continuously compare orchestrated performance with the direct strong-agent
  baseline to detect regression.

Only this phase should allow a structured acceptance surface to claim that a
multi-child user goal is supported. Rollback at every earlier phase stops the
new producer while preserving the existing v1 text, Task Handles, barriers,
and publication path; no destructive rewrite of historical execution truth is
needed.

## Rejected Simplifications

### "Always use the strongest model as Center Agent"

This can improve planning but does not solve the general product problem.
Models, costs, providers, tools, and task-specific strengths change. OpenMeld
still needs contracts that remain correct under capability inversion.

### "Give every child the entire conversation"

More context can preserve requirements but also carries stale assumptions,
prompt injection, unrelated private data, and anchoring. Preserve the original
outcome and authoritative evidence explicitly; include other history only when
it is relevant and permitted.

### "The Center Agent should never synthesize"

Synthesis is valuable for status, duplicate removal, dependency tracking, and a
single user-facing result. The restriction is narrower: synthesis must preserve
evidence, uncertainty, dissent, and provenance, and it must not invent
technical authority.

### "Debate every task"

The weak-judge evidence is not universal, and multi-agent work is expensive.
Use independent challenge for high-risk, cross-boundary, or disputed claims,
not as mandatory ceremony for routine work.

### "Remove task boundaries so strong agents can do anything"

Task boundaries prevent duplicate work and uncontrolled expansion. They should
define the objective, authority, deliverable, and resource budget while leaving
technical conclusions challengeable.

## Decision Tests For A Future Design

An OpenMeld design should not be approved until it can answer:

1. Can a child distinguish user authority from a Center Agent suggestion?
2. Can a specialist say that the assigned slice cannot satisfy the original
   goal without being treated as off-task?
3. Does the final reviewer receive the original acceptance contract?
4. Can a high-severity dissent survive Center Agent synthesis verbatim enough
   to be verified?
5. Can the Center Agent coordinate an agent it cannot technically out-judge?
6. Does task leadership change without changing execution, identity,
   completion, or publication authority?
7. Do local approvals remain visibly different from goal settlement?
8. Can the system show that orchestration did not reduce the strongest
   available agent's task performance?
9. Are destructive permissions still enforced when cognitive constraints are
   loosened?
10. Can every coordinator-created non-goal be traced to explicit user or owner
    authority?

## Sources

- [OpenAI Agents SDK — Agent orchestration][openai-orchestration]
- [OpenAI Agents SDK — Handoffs][openai-handoffs]
- [OpenAI — A practical guide to building agents][openai-guide]
- [OpenAI — Weak-to-strong generalization][weak-to-strong]
- [Anthropic — How we built our multi-agent research system][anthropic-multi-agent]
- [Kenton et al. — On scalable oversight with weak LLMs judging strong LLMs][weak-judge-paper]
- [A2A Protocol — Agent discovery][a2a-discovery]
- [A2A Protocol — Core concepts][a2a-concepts]
- [Microsoft AutoGen — Magentic-One][magentic-one]

[openai-orchestration]: https://openai.github.io/openai-agents-python/multi_agent/
[openai-handoffs]: https://openai.github.io/openai-agents-python/handoffs/
[openai-guide]: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
[weak-to-strong]: https://openai.com/index/weak-to-strong-generalization/
[anthropic-multi-agent]: https://www.anthropic.com/engineering/multi-agent-research-system
[weak-judge-paper]: https://arxiv.org/abs/2407.04622
[a2a-discovery]: https://a2a-protocol.org/latest/topics/agent-discovery/
[a2a-concepts]: https://a2a-protocol.org/latest/topics/key-concepts/
[magentic-one]: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html
