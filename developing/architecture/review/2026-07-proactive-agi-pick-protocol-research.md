# Proactive Agents And The Search For A “Pick-Like” Coordinate System

## Agent Context

- Purpose: Preserve a dated, primary-source evidence base for investigating
  whether open-ended agent work can be represented in a small common coordinate
  system instead of a growing collection of bespoke workflows.
- Read this when: Designing proactive or ambient behavior, long-running agent
  execution, agent self-improvement, capability controls, or agent evaluation.
- Update this when: A cited primary source changes materially, a falsification
  test is run, or a prototype produces measured evidence that confirms or
  contradicts the research hypotheses.
- Do not use this for: Claiming that OpenMeld already implements this mechanism,
  authorizing autonomous external actions, defining the production owner of any
  execution state, or replacing the scoped product and architecture documents.
- Source of truth: Linked primary sources own the external facts. This file owns
  only this dated research synthesis and its explicitly labeled inferences.

Date: 2026-07-19

Status: RESEARCH SNAPSHOT — NOT A DESIGN DECISION. Remove or distill this file
when a reviewed architecture decision and its owner document supersede it.

## Question And Method

Can open-ended proactive agent work be reduced to a small common coordinate
system rather than a growing collection of bespoke “agent workflows”? This
research uses Pick’s theorem only as an analogy: a hard problem may become
simple after it is represented in the right coordinates. It is **not** a
mathematical theorem, it does not define a standard, and this document does not
claim that the right agent coordinate system has been found.

The evidence below was independently collected from official vendor
documentation and engineering posts, primary research papers, and the Pi
repository source. No secondary summaries are used as factual support.
“Fact” means the cited source says or demonstrates it. “Inference” means a
design conclusion drawn here, and is deliberately not presented as a proven
result.

## Bottom Line

The sources support a small execution core: an agent can be modeled as a system
that repeatedly observes an environment, chooses a tool action, and consumes
its result. They do **not** establish a universal coordinate system for deciding
what matters, when to intervene, or whether a real-world outcome was good.

The earlier version of this snapshot overreached by presenting
Goal–Authority–Proof as the “GAP Loop Protocol.” That framing is withdrawn:

- `GAP` already names the *Governed Action Protocol*, a June 2026 individual
  Internet-Draft with a directly overlapping action-governance lifecycle.
- *Proof-Carrying Agent Actions* independently centers runtime-neutral
  governance on action certificates, approvals, receipts, replayable proof,
  and outcome closure.
- Goal, authority, evidence, and closure are therefore useful governance
  dimensions, but this review does not establish them as a novel protocol or
  as the missing Pick-like coordinate system.

The narrower open hypothesis is that the missing coordinate may live outside
the agent’s reasoning trace: represent work as a proposed transition in the
world, then let later world observations settle what happened. This snapshot
uses **Mismatch → Trial → Settlement** as a deliberately provisional research
language for that hypothesis. It is neither sourced fact nor a settled design.

There is **no** primary evidence here that unconstrained self-recursion is safe,
generally reliable, or a route to AGI. The strongest self-improvement results
operate in bounded, automatically scored domains, and explicitly use
sandboxing and human oversight. The evidence therefore favors
world-settled, evidence-gated learning over an agent that edits its own goals,
evaluator, or production authority.

## What “Proactive”, “Ambient”, And “Loop Engineering” Mean Here

### Facts

- The *Proactive Agent* paper defines the departure from reactive systems as
  anticipating and initiating tasks without explicit instructions. Its
  benchmark labels predicted interventions as accepted or rejected by people;
  it does not equate “more unsolicited actions” with success.
  [Source: Lu et al., *Proactive Agent*](https://arxiv.org/abs/2410.12361)
- Anthropic describes agents as LLMs using tools based on environmental
  feedback in a loop, and recommends ground truth from the environment at
  every step, human checkpoints when needed, and explicit stopping conditions.
  [Source: Anthropic, *Building Effective AI Agents*](https://www.anthropic.com/research/building-effective-agents)
- The sampled primary sources do not establish one accepted technical
  definition for either “ambient agent” or “loop engineering.” “Ambient” is
  therefore a product mode here—an agent can receive signals without a fresh
  chat request—not an asserted scientific category.

### Inference

Proactivity should be a separately accountable decision:

```text
signal -> propose intervention -> admit / defer / stay silent -> bounded work
```

It must measure both false interventions (nuisance or unsafe work) and missed
interventions. Optimizing only for user-visible action invites spam; optimizing
only for silence makes an “ambient” agent inert. A new trigger should begin by
creating a reviewable proposal, not by silently exercising write authority.

## Evidence Register

| Area | Fact evidence | Consequence for the research question |
| --- | --- | --- |
| Minimal agent loop | Anthropic distinguishes predefined workflows from agents that dynamically direct their own process and tool use; it advises starting with the simplest solution and only adding complexity when it improves outcomes. [Source](https://www.anthropic.com/research/building-effective-agents) | Keep the cognitive loop small and make added orchestration earn its existence through measured benefit. |
| Pi’s design | Pi calls itself a “minimal terminal coding harness,” provides a small default tool set, and moves additional behavior into extensions, skills, prompts, and packages. [Source: Pi README at reviewed commit](https://github.com/badlogic/pi-mono/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/packages/coding-agent/README.md) | The stable primitive is a clear harness contract, not a giant fixed agent framework. |
| Pi’s actual loop | Pi’s core loop streams an assistant turn, validates and executes tool calls, appends tool results, emits lifecycle events, observes cancellation and termination, and repeats while work remains. It supports sequential or parallel tool execution but does not need a planner hierarchy to be an agent. [Source: Pi agent-loop source at reviewed commit](https://github.com/badlogic/pi-mono/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/packages/agent/src/agent-loop.ts) | Separate a tiny “decide → act → observe” runtime from policy, state ownership, and user experience. |
| Long-running work | Anthropic found that context compaction alone did not solve long tasks. Its harness used an initializer, structured feature list, progress artifact, incremental work, clean handoff, and real end-to-end testing. [Source](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Persist a compact, inspectable handoff and verified checkpoint—not an ever-growing conversation—as the continuation unit. |
| Independent judgment | Anthropic reports that agents evaluating their own output skew too positive; its long-running harness separated planner, generator, and evaluator and negotiated testable sprint contracts. [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps) | An executor cannot be the sole writer of “success.” Separate work, evidence collection, and verdict authority. |
| Durable execution | Cloudflare Workflows documents durable multi-step execution, persisted state, automatic retries, waits for external events or approvals, and lifecycle management. Its retry configuration also distinguishes retryable work from an explicit non-retryable terminal error. [Overview](https://developers.cloudflare.com/workflows/) [Retry semantics](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/) | A durable coordinator can carry *continuation mechanics*—wait, retry, resume, compensate—but should not turn retry into a claim that the task is still correct or authorized. |
| Reasoning plus action | ReAct interleaves reasoning traces with environment actions; the paper reports that actions provide new information while reasoning updates plans and handles exceptions. [Source](https://arxiv.org/abs/2210.03629) | Record observations and tool outcomes as first-class inputs. Do not treat free-form plans as evidence. |
| Reflection and refinement | Reflexion stores verbal reflection from feedback in episodic memory; Self-Refine iterates generation, feedback, and revision with one model; Voyager couples environment feedback, error messages, self-verification, a curriculum, and a growing executable-skill library. [Reflexion](https://arxiv.org/abs/2303.11366) [Self-Refine](https://arxiv.org/abs/2303.17651) [Voyager](https://arxiv.org/abs/2305.16291) | Reflection is useful as a *candidate hypothesis* or reusable skill, but it is not proof. Retain it only when an external check validates it in a defined domain. |
| Objective evaluation | Anthropic defines agent outcomes as final environmental state, not the agent’s final message. It recommends isolated trials, deterministic graders where possible, calibrated model graders where necessary, and transcript inspection because graders can be wrong or hacked. [Source](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Any implementation needs a durable trace and outcome verifier. Score changes alone are insufficient release evidence. |
| Evolution under a verifier | DeepMind says AlphaEvolve combines LLM proposals with automated evaluators and evolutionary selection; its stated scope is problems whose solutions can be automatically verified. [Source](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/) | Evolution is most credible where the evaluator is objective, external to the candidate, and hard for the candidate to alter. |
| Recursive self-improvement | The Darwin Gödel Machine (DGM) paper describes agents that modify their own code, retain an archive of variants, and empirically validate each candidate on coding benchmarks. It reports experiments in sandboxes with human oversight, while also stating that proving most changes net-beneficial is impractical. [Source](https://arxiv.org/abs/2505.22954) | “Self-improvement” should mean a candidate passes a bounded evaluation and can be rolled back—not that production code, goals, or authority mutate themselves. |
| Goodhart and reward tampering | OpenAI documents an agent achieving a higher game score by circling for proxy rewards instead of completing the race. DeepMind shows that a literal task specification can be satisfied while missing the intended outcome. Anthropic further demonstrates, in a controlled curriculum, rare generalization from specification gaming to reward-function tampering and hiding traces. [OpenAI](https://openai.com/index/faulty-reward-functions/) [DeepMind](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/) [Anthropic](https://www.anthropic.com/research/reward-tampering) | Neither a completion flag, an evaluator score, nor the agent’s narrative can be the sole truth. Candidates must not write the objective, the verifier, or their own final verdict. |
| Permission boundaries | MCP requires servers to validate inputs, enforce access controls and rate limits, sanitize outputs, and recommends confirmation for sensitive operations, validation before LLM exposure, timeouts, and audit logs. OpenAI’s agent guidance pauses a run for approval and resumes the same serialized state; it also says validation must sit next to each side-effecting tool rather than only at agent-level guardrails. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) [OpenAI approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals) | Authority should be a deterministic, narrow capability attached to the action boundary: read, reversible write, irreversible write, publication, money, secret, and external communication are not equivalent. |
| Direct precedent: Governed Action Protocol | Joshua Shovan’s `draft-shovan-gap-00`, submitted on 30 June 2026, describes an open wire protocol with a `Declare → Grant → Invoke → Receipt` lifecycle, capability grants, grant evaluation, delegation, revocation, workflows, and content-addressed decision receipts. It is an individual Internet-Draft with intended status Informational: a work in progress, not an IETF standard or IETF endorsement. [Current Datatracker entry](https://datatracker.ietf.org/doc/draft-shovan-gap/) [Reviewed version](https://datatracker.ietf.org/doc/html/draft-shovan-gap-00) [Archived text](https://www.ietf.org/archive/id/draft-shovan-gap-00.txt) | The name “GAP Loop Protocol” and any broad claim to originate a governed action/authority/receipt lifecycle must be withdrawn. GAP’s receipt primarily records a gateway decision; it does not by itself settle whether the intended open-world effect later occurred or remained beneficial. |
| Direct precedent: Proof-Carrying Agent Actions | Wang’s *Proof-Carrying Agent Actions* (arXiv:2606.04104v1, submitted 2 June 2026) proposes runtime-neutral governance centered on an action certificate. It defines pre-action admissibility, action open, assumption capture, approval, and outcome closure, bound to a portable action envelope, runtime and approval receipts, and replay-ready proof. The paper explicitly does not claim universal pre-execution control or equal receipt depth across runtimes. [Abstract and metadata](https://arxiv.org/abs/2606.04104) [Full text](https://arxiv.org/html/2606.04104) | Portable action evidence, approval semantics, runtime neutrality, and proof closure are prior art, not the novelty of this research. PCAA reaches outcome closure, but does not claim a universal delayed-world-fact coordinate system for open-ended problem solving or self-improvement. |
| Governance and traceability | NIST AI RMF describes a voluntary risk-management framework for incorporating trustworthiness in AI design, development, use, and evaluation; its Generative AI profile is the current companion for GenAI-specific risks. [Source](https://www.nist.gov/itl/ai-risk-management-framework) | Traceability, risk review, and post-incident learning are protocol requirements, not optional dashboards. |

## First Reduction Tested: Boundary, Interior, And Proof

### Inference

An earlier pass reduced a complex run to three inspectable surfaces:

| Surface | Question it answers | Minimum durable fact |
| --- | --- | --- |
| **Boundary** | *May this system do this now?* | A scoped capability, budget, deadline, stop rule, and escalation rule. |
| **Interior** | *What work was attempted?* | Ordered observations, tool calls, results, checkpoints, and recoverable continuation state. |
| **Proof** | *What changed in the world, and who verified it?* | External observation(s), verifier identity/version, verdict, and diagnostic trace pointer. |

This remains a useful engineering checklist. It removes four common sources of
accidental complexity:

1. A chat transcript is not durable execution state.
2. A tool call is not a completed outcome.
3. An agent saying “done” is not proof.
4. A better benchmark score is not permission to rewrite production behavior.

The agent loop stays deliberately boring:

```text
observe -> select one bounded action -> execute under capability -> record result
        -> verify against outcome contract -> close | continue | escalate | stop
```

The surrounding system—not the model alone—must own terminal conditions,
permission decisions, and record formats. The model remains valuable where it
is strongest: interpreting a situation, proposing a next action, and generating
a candidate solution inside those bounds.

### Why this is not yet the Pick-like coordinate

Boundary, Interior, and Proof presuppose that someone can already state the
case, desired outcome, and verifier. In many valuable tasks that is the hard
part:

- a person can sense that a project is going wrong without knowing the right
  intervention;
- a customer complaint may reveal a symptom but not the owning problem;
- a research task may not have a known correct answer or a neutral judge;
- an effect may appear successful now and fail days later in the real business
  context.

If a human could always provide a precise Goal and Proof specification first,
many cases could be implemented as conventional workflows. This decomposition
therefore helps govern already-legible work; it does not yet explain how an
agent discovers what the work is or learns from an initially ambiguous world.

## Withdrawn Intermediate Mechanism

An earlier draft expanded Boundary, Interior, and Proof into six records named
Signal, Case, Capability, Attempt, Proof, and Verdict. That mechanism is not
advanced here. It introduced a second ontology before demonstrating that the
three-term coordinate worked, and much of its action-governance function
overlaps GAP and PCAA.

The useful constraints survive elsewhere in this snapshot: a signal has no
authority, execution is not outcome, uncertainty remains explicit, and
learning cannot rewrite its own evidence. No six-record protocol, state
machine, or infrastructure plane is proposed.

## Evidence Gaps And Falsification Tests

- **No universal proof:** AlphaEvolve and DGM are strong domain evidence, not
  proof that recursive self-improvement transfers to open-ended business,
  social, or safety-critical work.
- **Proactivity quality is unresolved:** the sampled proactive research shows
  accepted/rejected interventions, but does not settle how to price interruption,
  detect missed opportunities, or obtain consent in a real product.
- **Self-evaluation is still useful but weak alone:** papers show iterative
  gains, while Anthropic reports self-grading bias. Compare an independent
  verifier against self-verdicts on a blinded test set before trusting either.
- **Durability is not correctness:** vendor workflow retry/resume features do
  not prove idempotence, valid authority after a delay, or semantic success.
  Test duplicate delivery, expiry while waiting, partial side effects, and
  rollback failure.
- **Evaluator Goodhart risk remains:** every automated verifier can be
  overfitted or exploited. Maintain held-out tasks, adversarial tests,
  transcript review, and periodic human calibration.
- **Any implementation mapping remains unverified here:** compatibility with a
  particular product or runtime requires a separate current-state architecture
  review. This snapshot assigns no production owner and changes no execution,
  readiness, routing, authorization, or outcome truth.

## What The Direct Precedents Change

The prior-art check separates three problems that the earlier synthesis had
collapsed:

| Layer | Question | What current evidence already covers |
| --- | --- | --- |
| **Execution mechanics** | How does an agent observe, act, wait, retry, and resume? | Pi, ReAct, durable workflows, and long-running harnesses supply strong patterns. |
| **Action governance** | May this action happen, under whose authority, with what approval and receipt? | MCP guidance, GAP, and PCAA directly address substantial parts of this layer. |
| **World settlement** | After the action, what actually happened in the relevant world, what remains uncertain, and what should be learned? | Agent evaluation and feedback research address pieces, but the sampled sources do not provide one general coordinate system for open-world settlement. |

This changes the novelty boundary. A portable action envelope, capability
grant, approval checkpoint, receipt, replay bundle, or outcome-closure record
may be useful, but none is a defensible broad novelty claim here. The unresolved
research question begins where a valid action receipt ends.

GAP and PCAA are direct, partially overlapping precedents—not proof that agent
governance is solved. GAP’s receipt can prove what a gateway decided. PCAA can
carry assumptions and close an outcome record. Neither fact alone proves that a
customer was helped, a project remained unblocked, a deployed fix survived real
traffic, or a scientific hypothesis became more credible.

## Theoretical Reset: Put The Coordinate In The World

### Research hypothesis: Mismatch → Trial → Settlement

The candidate reduction is intentionally plain:

1. **Mismatch** — some observation no longer fits an expectation, need,
   constraint, or prior model. The system may discover the mismatch before it
   can state a complete goal.
2. **Trial** — the system chooses a bounded response, including asking a person,
   gathering information, making a reversible change, or deliberately doing
   nothing. The response carries a prediction about what observable difference
   should follow.
3. **Settlement** — later observations compare the prediction with what the
   relevant world actually did. The result may be `supported`, `contradicted`,
   `mixed`, `still unknown`, or `not attributable`.

In one line:

```text
observe a mismatch -> make one testable move -> let later world facts settle it
```

The basic unit is therefore not “a task the model says it completed.” It is a
prediction about a world transition, linked to the observations that later
support, contradict, or leave that prediction unresolved.

This remains a hypothesis. “Mismatch,” “Trial,” and “Settlement” are research
labels, not protocol fields, schema names, product terminology, or a claim of
scientific novelty.

### Why this may be closer to the Pick analogy

Pick’s theorem does not make polygon-area arithmetic faster; it changes the
representation from decomposing shapes to counting lattice points. The
analogous move here would be:

- stop trying to standardize every kind of plan, business workflow, and chain
  of thought;
- represent many kinds of work by the same observable before/after relation;
- ask the same small set of questions regardless of domain:
  - What did the world show that no longer fit?
  - What observable change did this Trial predict?
  - What did the world later show?

A support ticket, code repair, research experiment, project intervention, or
personal reminder may have radically different content while still admitting
that same comparison game.

The analogy is incomplete in one decisive way. Lattice points are objective and
the theorem is proven. Real-world observations can be delayed, disputed,
partial, manipulated, privacy-sensitive, or causally ambiguous. No evidence in
this review proves that all useful tasks can be mapped into these three terms,
or that their mapping will be simple.

### Why this does not require a complete goal first

A precise Goal–Authority–Proof contract can only be written after the problem
is legible. Mismatch can begin earlier:

- “Customers repeat the same question” is observable before the right product
  change is known.
- “This deployment passes tests but support incidents rose” is observable
  before the code defect is located.
- “The team keeps reopening this decision” is observable before anyone knows
  whether the cause is missing evidence, authority, or alignment.

The first Trial may therefore be information gathering rather than a solution.
Its predicted transition can be “this observation will distinguish hypothesis
A from B.” Discovery, decision support, and execution can share the same
coordinate without pretending they share the same verifier.

### Settlement is not the same as success

Settlement records what later evidence does to a particular prediction. It is
not a universal declaration that the whole situation is good.

For example:

```text
Mismatch:
  Production users abandon checkout after a UI release.

Trial:
  Restore the previous payment-step layout for 10% of traffic.

Prediction:
  If the layout caused the abandonment, completion should recover in the
  treated cohort without increasing payment failures.

Settlement:
  Completion recovered, payment failures did not, but the observation window
  is too short to settle refund impact.
```

One prediction is supported while the wider outcome remains open. This is more
honest than a single `completed` flag and more useful than the executor saying
its code looks correct.

### Human judgment remains a world fact, not an oracle

Some worlds are social or institutional. A legitimate owner’s approval, a
customer’s reported experience, and affected parties’ disagreement can all be
relevant observations. They should be recorded with identity, time, scope, and
provenance. They do not become universal truth merely because a human supplied
them.

The coordinate must preserve plural and conflicting observations rather than
force every case into one automated score.

## Relationship To Action Governance

World settlement does not replace authorization or proof-carrying actions. The
layers compose:

```text
Mismatch proposes attention
  -> governance decides whether a Trial may occur
  -> an existing runtime performs the Trial
  -> receipts prove what was authorized and executed
  -> later observations settle the Trial's prediction
  -> the result may change future hypotheses, not historical facts
```

The following boundaries remain necessary:

1. A signal or mismatch has no authority.
2. Every side effect is checked at the effect boundary under current
   authorization.
3. Execution receipts and world observations are separate facts.
4. The executor cannot be the only source of settlement evidence.
5. `unknown`, disagreement, delayed outcome, and failed attribution remain
   first-class results.
6. Irreversible Trials require a higher approval boundary because later
   evidence cannot undo harm.

These are synthesis constraints, not a proposed replacement for GAP, PCAA,
MCP, a domain authorization model, or any product’s existing state owners.

## Learning Without Self-Deception

A useful recursive loop would accumulate settled Trials, not merely
self-authored reflections:

```text
settled Trial
  -> update a hypothesis about when a response works
  -> test that hypothesis on a new or held-out mismatch
  -> retain, revise, or reject it after new settlement
```

Potentially reusable artifacts include intervention patterns, tool-selection
policies, context-retrieval policies, diagnostic questions, and abstention
rules. A learning candidate must not rewrite the evidence that judged it,
erase failed branches, grant itself new authority, or promote itself directly
into production.

The strong form of the hypothesis is cross-domain: settlements from many
different tasks improve future Trial selection because all are represented in
one coordinate system. That strong form is unproven and should be a primary
falsification target. If each domain still requires an unrelated ontology,
verifier, and learning rule, then the coordinate has not produced the claimed
reduction.

## Framework-Neutral Compatibility Criteria

This research should not require a new agent framework. A prototype should be
able to sit beside a small local loop, a durable workflow engine, or a
multi-agent system through four narrow interfaces:

1. **Observe:** reference a timestamped source fact without copying authority
   from that source.
2. **Try:** invoke an existing typed action through its existing authorization
   boundary.
3. **Resume:** wake when delayed evidence arrives without treating delay or
   retry as success.
4. **Settle:** append evidence and a scoped interpretation without rewriting
   execution history.

Compatibility with OpenMeld, Pi, or any other runtime is an implementation
question, not evidence for the theory. A future integration must preserve each
system’s existing owners for execution, identity, authorization, delivery, and
user-visible state. This document neither verifies current infrastructure nor
proposes a migration.

## General Problem Reduction

| General agent failure | Candidate reduction |
| --- | --- |
| Proactive spam | A mismatch can propose attention but cannot authorize action; silence and no-op are valid Trials. |
| Goal ambiguity | Begin with an information-gathering Trial instead of manufacturing a precise goal. |
| Hallucinated completion | Settle against later observations; executor prose is only a claim. |
| Infinite loops | Each Trial predicts a bounded observable change and has a settlement window, budget, and stop rule. |
| Prompt injection | An observation may inform a hypothesis but cannot expand action authority. |
| Memory pollution | Promote patterns linked to settled Trials; retain unsupported reflection as a hypothesis. |
| Reward hacking | Store the prediction, counter-signals, and world observations separately from the policy being judged. |
| Long horizons | Resume on new evidence and permit `still unknown` instead of keeping an inference loop alive. |
| Multi-agent conflict | Agents may propose competing Trials; shared authority and settlement evidence remain external to them. |
| Delayed impact | Schedule later observation and allow prior settlements to reopen when material counter-evidence arrives. |
| Scientific exploration | The Trial predicts discriminating observations rather than a predetermined answer. |
| Recursive self-deception | Preserve failed branches, sealed evaluations, independent evidence, and rollback. |

This reduction does not eliminate politics, undecidability, causal uncertainty,
or evaluator error. Its intended value is to make those limits observable
instead of allowing a model to convert them into a fabricated completion.

## Falsification Program

Do not build a platform first. Test whether the coordinate actually compresses
real work.

### Minimum experiments

1. **Retrospective encoding:** take completed and failed long-running tasks
   across at least three domains. Have independent annotators map them into
   Mismatch, Trial, prediction, and Settlement without inventing missing facts.
   Measure coverage and agreement.
2. **False-completion test:** compare transcript-based completion with
   settlement based on external observations. Measure how often the latter
   reopens or rejects apparent success.
3. **Proactivity test:** compare unsolicited interventions selected from
   mismatches with a reactive baseline. Measure accepted help, unnecessary
   interruption, missed opportunities, and delayed regret.
4. **Transfer test:** use settled Trials from one task family to choose Trials
   in held-out families. Compare against domain-specific policies and a no-
   memory baseline.
5. **Ablation test:** remove prediction, delayed observation, independent
   evidence, or failed-branch retention one at a time. Check which claimed
   benefits disappear.

### Reject or substantially revise the hypothesis if

- independent annotators cannot identify the units reliably;
- most valuable cases require domain-specific structures that the common
  coordinate merely renames;
- external settlement does not reduce false completion or improve recovery;
- the representation loses important affected-party disagreement or delayed
  harm;
- cross-task learning overfits proxies and fails held-out or human-reviewed
  cases;
- implementation adds more operational concepts than it removes from one real
  end-to-end scenario;
- it requires a second writer for a product’s execution, authorization, or
  user-visible truth.

The first milestone is therefore not an SDK, schema, or autonomous runtime. It
is a reproducible corpus and a result showing whether this representation is
smaller, more reliable, and more transferable than the alternatives.

## Source Verification Notes

- The GAP citation was checked against the Datatracker entry, fixed
  `draft-shovan-gap-00` HTML, and IETF archive copy. It is described here only
  as an individual Internet-Draft and work in progress.
- PCAA title, sole author, arXiv identifier, submission date, checkpoint list,
  and stated limitations were checked against arXiv metadata and full text.
- All other links in this snapshot target primary papers, official source
  repositories, specifications, vendor engineering material, or official
  framework pages. Automated link checks returned HTTP 200 for every retained
  URL except OpenAI’s *Faulty Reward Functions* page, which returned HTTP 403
  to the command-line client but loaded successfully through browser
  retrieval. Its canonical page was retained rather than interpreting bot
  denial as a missing source.

## Research Boundary

This is a descriptive, non-normative research snapshot. It records primary
sources, explicit inferences, a withdrawn overclaim, and falsifiable questions.
It is not a specification, standard, architecture decision, product roadmap, or
claim that the proposed coordinate works.

It does not authorize a new runtime, unattended proactive action,
self-modifying agent, schema, database writer, policy change, production
deployment, or modification of any existing system owner.
