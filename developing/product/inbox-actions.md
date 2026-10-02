# Inbox actions

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
| Local Agent permission, plan, question | Execution interaction; Binding owner | RuntimeCoordinator stores and delivers the response, expires or cancels the interaction; its durable Inbox repair updates the projection |
| Center Agent response request | Explicit member request in a Space | Center attention request owner resolves on the addressed member's reply |
| Document review | Exact document draft; authorized reviewer | Document owner approves, rejects, or supersedes the draft |
| Organization invitation | Invitation request; authorized reviewer | Invitation owner tracks review separately from delivery and joining |
| Agent creation request | Creation request; authorized reviewer | Agent creation request owner accepts or rejects the request |
| Work recovery | Interrupted work and recovery stage; Agent owner | Recovery owner approves queued work, skips interrupted work, or ends the gate |
| Authorization update | Connector requirement revision; owner/admin | Authorization owner verifies updated grants and resolves recipients together |
| Agent model correction | Confirmed model issue; Agent owner | Model owner reconciles the selected model and current evidence |
| Channel setup | Setup request; authorized organization member | Channel setup owner completes or ends setup |
| Computer connection | Durable connection incident; Computer owner | Runtime Transport resolves restored or deactivated incidents |
| Failed automatic continuation | No human request | Normal update linking to the continuation's own failure publication |

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
