# Opportunities

## Agent Context

- Purpose: Define the first OpenMeld Opportunity loop, including product
  meaning, recipient scope, lifecycle, Center Agent review, Inbox projection,
  and the boundary between recommending and executing work.
- Read this when: You are changing Opportunity discovery, recommendation,
  decisions, Center Agent Opportunity tools, Opportunity-backed Inbox items,
  or a future Opportunity delivery surface.
- Update this when: Opportunity meaning, lifecycle, recipient policy,
  authority, source ownership, presentation, or rollout scope changes.
- Do not use this for: Changelog authoring, Routine execution, Task lifecycle,
  App permissions, Inbox read state, or a general notification system.
- Source of truth: This file owns the Opportunity product model. Core owns the
  durable records; source domains own the evidence; Inbox is only a recipient
  attention projection; existing capabilities own every resulting action.

## Product promise

An **Opportunity** is one concrete, evidence-backed way OpenMeld could help one
member achieve a better result.

A **Recommendation** is how the Center Agent presents that Opportunity in a
conversation or existing attention surface. A Recommendation is not a second
object, a broadcast, a score, a permission grant, or completed work.

For example, a member asks, "What changed in OpenMeld?" The Center Agent reads
the official Changelog and the Organization capabilities visible to that
member. It sees that reusable Routines are available and that release reviews
are still being done manually. It may recommend one Opportunity:

> Review releases before they ship. Release reviews currently happen after
> deployment. A weekly release-review Routine could catch blockers earlier.
> Would you like to do that, leave it for later, or dismiss it?

This is useful because the Agent did the reasoning. OpenMeld did not require a
new rules engine to recognize a particular industry, repository, or workflow.

## Phase 1 experience

Phase 1 is conversation-first and deliberately small:

1. A verified member talks with the Center Agent in Web, Slack, Lark, Feishu,
   a Space, or another supported interactive surface.
2. The Center Agent notices one meaningful Opportunity from the current
   request and trusted evidence already available through its tools.
3. The Center Agent records and presents at most one Opportunity in that turn.
4. Core creates one ordinary Inbox update for the same member so the
   recommendation is not lost when the conversation moves on.
5. The member answers naturally: accept, not now, or dismiss.
6. The Center Agent records that exact decision. The quiet Inbox update remains
   history. No suggested action runs merely because the Opportunity was
   accepted.

There is no standalone Opportunities page in Phase 1. The canonical product
surfaces are the existing Center Agent conversation and Inbox. Inbox opens the
Center Agent, where the member can continue in ordinary language.

Phase 1 also has no background scan, scheduled discovery, proactive Channel
message, direct message fan-out, email, scoring service, preference center, or
Organization-wide review queue. A Routine cannot use Opportunity tools.

## Center Agent review

The Center Agent is the first editorial reviewer. There is no second model call
and no separate human moderation step before an interactive recommendation.
The model-visible write tool is the boundary: the Center Agent may call it only
when it can provide all of these fields:

- a stable deduplication key;
- a concrete observation;
- the expected practical benefit;
- one clear suggested next step; and
- one to eight bounded evidence statements.

The Center Agent must not turn every Changelog entry, ordinary update, raw
Agent observation, or vague idea into an Opportunity. It recommends at most one
per turn, only to the verified human currently speaking, and never selects a
different recipient. This default-silent interaction is the Phase 1 quality
control: a weak recommendation is easy to dismiss, while bulk low-confidence
output has no delivery path.

## Lifecycle

Each Opportunity has one of four states:

- `open`: the current member has not decided;
- `accepted`: the member wants to pursue the recommendation;
- `deferred`: the member said not now; Phase 1 does not resurface it
  automatically; or
- `dismissed`: the member does not want the recommendation.

`accepted` and `dismissed` are terminal. `deferred` may later become
`accepted` or `dismissed` only when the member explicitly revisits the same
Opportunity. Replaying the same decision is idempotent. Reusing one stable key
for different content fails visibly instead of silently changing history.

## Recommendation is not execution

Accepting means "this recommendation is worth pursuing." It never means
"grant every permission and do whatever is necessary."

If the member says only, "Yes, that sounds useful," the Center Agent records
`accepted` and explains that nothing has run. If the member says, "Yes, create
that weekly Routine for Monday at 9 AM in Release Room," the Center Agent may
record acceptance and then use the existing Routine capability because the
same message separately supplies a concrete authorized action and its inputs.

Every downstream action keeps its existing owner, permissions, confirmation,
attribution, audit, idempotency, and failure contract. Opportunity state never
becomes an execution token or a general authorization path.

## Ownership and privacy

Core D1 is the source of truth for Opportunity identity, current decision,
recipient, safe evidence, and creation/decision provenance. Core is the only
writer. The durable record is scoped by both `organizationId` and
`recipientUserId`; list and decision operations return not found for another
member rather than revealing that a record exists.

Source systems remain authoritative for the facts cited as evidence. An
Opportunity stores only bounded safe statements, not transcripts, provider
objects, credentials, private local paths, raw diagnostic payloads, or copies
of Changelog entries. The Center Agent profile and native delivery identifiers
are provenance, not authority.

Inbox stores one `organization_opportunity` update keyed by the canonical
Opportunity id. It is normal importance and does not enter the action badge,
browser notification, or email path. Inbox owns read and Dismiss state; the
Opportunity owner owns accept, defer, and dismiss decisions. Dismissing the
Inbox row does not dismiss the Opportunity, and deciding the Opportunity does
not rewrite Inbox history.

## Changelog and Self-Evolution boundaries

The Git-backed Changelog remains the only official OpenMeld product-update
history. It can supply evidence to Center Agent reasoning, but an Opportunity
does not copy or republish the Changelog and not every update becomes a
recommendation.

The **Opportunity Ledger** maintained by the optional Center Agent
Self-Evolution Routine remains an Organization Document in Phase 1. It is not
the typed Opportunity store, does not automatically create member
Recommendations, and is not synchronized in either direction. A future import
or reporting path must define explicit provenance, recipient selection, review,
deduplication, and authorization before connecting those two domains.

## Future extension boundary

Later phases may let Center Agent or Local Agents submit evidence from longer-
running work, add optional recommendation destinations, or let an Organization
owner configure proactive delivery. Those additions must reuse the same
Opportunity meaning and decision lifecycle without making agent text an
authority grant.

No future phase is justified merely by the existence of this table. Real use
must first show that interactive Recommendations are relevant, understandable,
and easy to maintain. New delivery channels come after recipient preferences,
frequency controls, and exact source/authority contracts, not before them.
