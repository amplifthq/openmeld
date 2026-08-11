# Linear Agent Chat Session Model Research

## Agent Context

- Purpose: compare Linear Agent's user-managed chat model with OpenMeld's
  current single Center Agent Direct Message conversation and identify the
  strongest task-solving model for OpenMeld.
- Read this when: evaluating Center Agent conversation identity, parallel work,
  task context isolation, chat history, or user-visible task management.
- Update this when: Center Agent conversation identity, Agent Task Coordination,
  Linear Agent's documented behavior, or a task-concurrency benchmark changes.
- Remove this snapshot after its recommendations are either incorporated into
  the owning Center Agent task-context documents or explicitly rejected by a
  recorded product decision.
- Do not use this for: claiming Linear's unpublished concurrency limits,
  implementing a new authority path, or treating a UI pattern as execution
  evidence.
- Source of truth: current OpenMeld owner documents and source own production
  semantics. Linear's official documentation owns documented Linear behavior.

Date: 2026-08-07

Status: RESEARCH SNAPSHOT — NOT A DESIGN DECISION.

Evidence rule: verified facts, inferences, recommendations, and unknowns are
kept separate. The screenshots and live Chrome inspection establish visible UI
behavior; they do not reveal Linear's private scheduler or concurrency limits.

## Plain-Language Conclusion

Linear does not expose multiple Agent identities. It exposes one Linear Agent
identity through multiple named, recoverable chat contexts. A user can start a
clean chat for another topic, keep several chats open in toolbar tabs, and
return to chat history. Linear Loops are separate durable automation objects;
they are not chats that must remain open.

OpenMeld currently has one managed Center Agent identity and one Center Agent
Direct Message Space per active human/agent pair. That Space id is also the
Remote Agent conversation id. Turns inside one conversation are serialized,
while conversations in different Spaces or external-provider threads can run
in parallel.

If the only choices were Linear-style user-managed chats or one endless serial
conversation, user-managed chats would provide stronger task-solving capacity:
they isolate unrelated context, permit multi-tasking, and give each task a
clear recovery and history boundary. The cost is that the user must decide when
to create, name, resume, and close chats.

OpenMeld should not copy that management burden. The better product model is:

```text
one Center Agent identity
+ one Chat home
+ automatically created task-scoped contexts
+ parallel execution across independent tasks
+ serialized turns within one task
+ shared member/Organization memory through Core-owned policy
```

The user manages work outcomes, not sessions. A root request creates a task;
replies inside that task steer it. Completed tasks collapse into searchable
history. This is an architecture change, not a Web-only UI change: task context
identity must be Core-owned and must not create a second source of execution,
publication, or memory truth.

## Verified Linear Facts

Linear's official documentation states that:

- the dedicated chat keeps context over time;
- a new chat provides a clean slate when switching topic, Issue, or Project
  scope or when the user wants to prevent earlier chat context from being
  reused;
- multiple chats can be open at once as toolbar tabs, with labels, unread
  updates, and working state;
- chat history lets users resume prior conversations;
- a new Linear browser tab starts a new Agent chat by default, though the user
  can change the default home;
- all chats still operate over the same authorized Linear workspace data and
  configured guidance;
- Loops trigger on a schedule or Issue conditions and own instructions, scope,
  permissions, connectors, published versions, and run history.

Sources:

- [Linear Agent documentation](https://linear.app/docs/linear-agent)
- [Loops documentation](https://linear.app/docs/loops)
- [Linear Agent MCP support changelog](https://linear.app/changelog/2026-04-23-linear-agent-mcp-support)
- [Code Intelligence changelog](https://linear.app/changelog/2026-05-14-code-intelligence)

The supplied screenshots and live Chrome inspection additionally verified:

- every saved chat has its own `/agent/{chat-slug}` URL;
- the chat switcher groups history by recency;
- a full-page chat and a different toolbar chat can remain open with separate
  composers;
- chat options include deletion, while moving a chat to the toolbar and
  favoriting it create additional user-visible organization choices.

Linear's May 14 changelog says follow-up messages can be queued while one Agent
turn is working and are sent after that turn completes. This supports a useful
distinction: a single chat remains an ordered conversation, while multi-tasking
is achieved across chat contexts.

## Verified OpenMeld Facts

- Each Organization has exactly one managed Center Agent identity. Users do not
  create or select another Center Agent.
- Center Agent Chat reuses the existing conversation surface and opens the
  lazily created Center Agent Direct Message Space.
- There is no separate Center Agent DM subsystem. The DM is the shared Direct
  Message Space model for the human/Center Agent pair.
- The Remote Agent conversation id for a Space conversation is the Space id.
  Turns inside one conversation are serialized; conversations across Spaces or
  provider threads run in parallel.
- Flue owns per-conversation history and compaction. Core-owned member and
  Organization memory are separate from that transcript.
- Existing Agent Task Coordination already owns exact Task Handles,
  continuations, completion conditions, and bounded terminal snapshots. The
  user is explicitly not expected to manage those coordination mechanics.

Relevant owner documents and source:

- `developing/product/organizations-and-center-agent.md`
- `developing/product/remote-agent-runtime.md`
- `developing/product/space-collaboration.md`
- `clients/web/src/components/organizations/center-agent-page.tsx`
- `clients/web/src/lib/organizations/center-agent-route-loader.ts`

## Capability Comparison

| Criterion | User-managed chats | One endless conversation | Automatic task contexts |
| --- | --- | --- | --- |
| Independent-task throughput | Strong | Weak | Strong |
| Context isolation | Strong | Weak over time | Strong |
| Natural continuity | Requires chat choice | Strong | Strong through task continuation plus memory |
| User management cost | Medium | Low | Low |
| Cancellation and retry scope | Per chat | Often ambiguous | Per task |
| Failure isolation | Strong | Weak | Strong |
| Audit and return-to-work | Clear by chat | Mixed timeline | Clear by task |
| Cross-task coordination | Mostly manual | Implicit and unsafe | Explicit dependencies and completion barriers |
| Implementation complexity | Medium | Lowest | Highest |

The base model does not become more intelligent because a product adds chat
tabs. Effective task performance still changes because the scheduler and
context boundary determine whether the model sees relevant context, unrelated
history, stale assumptions, and clear ownership for tool actions.

## Recommended OpenMeld Contract

1. Preserve one Center Agent identity and one Chat product entrance.
2. Treat each independent top-level request as one Core-owned task context with
   an exact Task Handle and immutable requester/destination facts.
3. Serialize messages that steer the same task; admit independent tasks in
   parallel within explicit account, Organization, model, and tool limits.
4. Keep the Center Agent DM Space as the durable user-facing result surface.
   Do not create hidden Spaces or let Web session ids become authority.
5. Keep member and Organization memory separate from task transcripts. Recall
   only the bounded facts authorized by current Core policy.
6. Use explicit task dependencies and existing continuation barriers when one
   task depends on another. Do not infer dependency from timing or a shared
   chat feed.
7. Protect conflicting writes. Independent read work may run freely; writes to
   the same Issue, document, repository, or external resource need optimistic
   concurrency, idempotency, or a resource-scoped execution fence.
8. Make Stop, Retry, recovery, needs-attention, unread, and result ownership
   task-scoped.
9. Present active tasks automatically and collapse completed work. Search,
   pinning, and reopening are secondary history tools, not required setup.

## Unknowns And Validation Gaps

- Linear does not publish exact chat concurrency, queue, rate, or resource
  isolation limits. "Multiple open chats at once" proves the product model,
  not unlimited simultaneous inference.
- Linear does not publicly document maximum chat count, retention, compaction,
  or cross-chat cache behavior.
- OpenMeld has not benchmarked task success, context leakage, or conflicting
  writes under automatic parallel task contexts.
- It remains a product decision how the composer distinguishes a new task from
  steering an existing one. The safest default is structural: the Chat-home
  composer starts a task, while a task-local composer continues it. Ambiguous
  natural-language routing should ask instead of silently choosing.

## Suggested Evaluation

Compare the current serial DM with a task-context prototype using the same
model and tools. Include one long sequential goal, two unrelated concurrent
goals, two tasks that write the same object, an ambiguous follow-up, a stopped
task, and a task resumed after several days. Measure goal completion, wall-clock
time, wrong-context rate, user management actions, conflict rate, recovery
accuracy, and trust. Do not ship parallel writes until the conflict and
authority tests pass.
