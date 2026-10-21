# Inbox actions

## Agent Context

- Purpose: Define action ownership and the reusable handling boundary for Inbox sources.
- Read this when: Adding a request type or changing an action's handling and resolution.
- Update this when: A source's action contract or shared presentation boundary changes.
- Do not use this for: Execution authority, transport protocols, or notification delivery policy.
- Source of truth: Each listed source owns its request; Inbox owns the recipient projection.

## Boundary

Inbox is a recipient projection, not an approval store. A source may publish an
action only when it owns a concrete open request, an authorized handling path,
and a terminal transition that closes its Inbox projection. Failures without a
supported intervention are updates, even when the failure matters.

## Shared contract

An action has a stable source identity and immutable request revision, an
authorized actor, current state, bounded content, supported responses, and a
source-owned destination. A new content revision requires a new request identity
where the existing owner does not support explicit revisions. Never approve a
new plan using the identity of the old plan.

Use the existing typed permission, question, and plan-review contracts. Generic
human questions use the question contract when owned by a live interaction;
business requests outside a live execution remain with their business owner.
Do not put independent tasks in RuntimeCoordinator merely to reuse a card.
An external action opens its owning product surface; a notification cannot
provide an unbacked "Complete" control for that business operation.

The shared UI takes a typed request and a response callback; it does not know
which transport carries the response. Business authorization and response
validation run on the server. An accepted response is not successful execution.
Exact retries return the retained result; conflicting responses must not appear
successful. A failed transport leaves the result unconfirmed until the source
can be read or the same response safely retried.

## Existing source inventory

| Source | Request and actor | Handling and terminal owner |
| --- | --- | --- |
| Local Agent permission, plan, question | Execution interaction; Binding owner. Urgent when the root requester is not the owner; one item per Session (`contextId`) | RuntimeCoordinator stores and delivers the response, expires or cancels the interaction; its durable Inbox repair updates the projection. Answering anywhere closes the item everywhere; the requester may cancel the waiting task |
| Agent access request (`agent_access_request`) | First Direct Message from a colleague or identified external user to an Agent Profile; Agent owner | Agent access owner records the grant (`always`) or a one-time allowance, or the decline, and then starts a new Session or rejects; revocation ends the grant |
| Agent Space request (`agent_space_request`) | Mention or add of another member's Agent, bound to the exact message id; Agent owner | MemberAgent request owner adds the Agent and dispatches the bound message, hands off to a DM, or ignores; an edited or deleted message voids it |
| Credential confirmation (`credential_confirmation`) | Exact sensitive operation made with the CLI login credential during a non-owner-rooted task on that computer; Agent owner | The sensitive-operation owner applies or rejects that exact operation and writes the audit record |
| Center Agent response request | Explicit member request in a Space | Center attention request owner resolves on the addressed member's reply |
| Document review | Exact document draft; authorized reviewer | Document owner approves, rejects, or supersedes the draft |
| Space Task review or rework decision | Exact submitted result; current Human reviewer, or the requester/Space owner at the automatic-rework limit | Task owns revision-checked review, cancellation and continuation. Its existing durable delivery outbox projects and resolves recipient attention from current Task state. Reading or Dismiss never changes Task state; an Agent reviewer does not create a request for its personal owner. |
| Organization invitation | Invitation request; authorized reviewer | Invitation owner tracks review separately from delivery and joining |
| Agent creation request | Creation request; authorized reviewer | Agent creation request owner accepts or rejects the request |
| Work recovery | Interrupted work and recovery stage; Agent owner | Recovery owner approves queued work, skips interrupted work, or ends the gate |
| Authorization update | Connector requirement revision; owner/admin | Authorization owner verifies updated grants and resolves recipients together |
| Plugin action confirmation | Exact pending action; original requesting member only | Plugin request owner records approval or rejection from the signed-in requesting account; expiry and permission changes resolve attention. Approval is not provider execution or cancellation of an older operation. |
| Agent model correction | Confirmed model issue; Agent owner | Model owner reconciles the selected model and current evidence |
| Channel setup | Setup request; authorized organization member | Channel setup owner completes or ends setup |
| Computer connection | Durable connection incident; Computer owner | Runtime Transport resolves restored or deactivated incidents |
| Failed automatic continuation | No human request | Normal update linking to the continuation's own failure publication |

Implementation status: the Agent access request, Agent Space request, and
credential confirmation rows are MemberAgent program sources, PR #236,
shipped. Their urgency comes from the root requester fact defined in
[Inbox](inbox.md#agent-owner-requests).

Plugin confirmations with verified Space provenance also appear on the original
message, including Thread messages. Inbox and message cards use the same request
and the shared Local Agent approval-card components. Only the requesting member
can read or decide the private request. Reading the message never approves it.

An approval stores continuation intent in the same transaction as the decision.
The existing Core scheduled recovery retries delivery after the original reply
settles. It submits one idempotent continuation through the existing Space Wake
owner, with the exact account and original operation identity; it never executes
the provider action itself. Expired authorization, changed source, lost access,
or a stopped source prevents continuation. Unsupported or historical requests
without verified message provenance retain their Inbox decision path and do not
claim automatic resumability. A requested continuation is not a completed action.

## References and repair

A message destination belongs to the publication owner. Keep Space, Thread,
and Signal together; an observed child result cannot borrow its parent's Space.
Unavailable source content must not be presented as a still-actionable request.

Source state, recipient read state, and recipient dismissal are distinct.
Repairing a notification preserves read/dismissal decisions and never rewrites
the task's outcome. Source projection failures need retained retry evidence and
must not prevent other terminal effects from being attempted.

When projection semantics change, delivery includes a bounded historical repair
with source identity checks, not just an event-replay handler. Validate from an
old stored record with no future events. Keep general source conflicts closed;
historical repair is narrowly scoped to an identified retired producer.
