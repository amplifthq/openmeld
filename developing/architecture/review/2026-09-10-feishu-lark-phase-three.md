# Feishu and Lark native workflows

## Agent Context

- Purpose: Record PR 884 implementation, evidence, and rollout boundaries.
- Read this when: Reviewing or continuing phase-three acceptance.
- Update this when: Acceptance or release dependencies change.
- Do not use this for: Release authorization or additional business permissions.
- Source of truth: Runtime and Routine owner documents define permanent contracts.

## Implemented boundaries

Streaming publishes answer deltas through the existing delivery owner. Final
publication fences late updates. Private reasoning is not streamed. CardKit
streaming, sequence ordering, and terminal replacement follow the official
[streaming API](https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview.md).

Native Stop buttons forward cancellation to the existing Remote Agent worker;
they do not invent a second terminal writer. A completed card offers a collapsed
follow-up form. Submission is a new ordinary user request, not business approval.
Core checks the current card, connection, chat, represented member, and expiry.
The same submitted text on the same parent card has one idempotency identity.
The provider's [button contract](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/button.md)
uses callback values for ordinary buttons; `name` is a form-only field.
The [form container](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container.md)
stays at the card root, with a collapsible panel inside it.

Current-conversation Routines retain a Core-verified locator from the admitted
request. Each Run freezes that locator in the existing atomic claim. Connection
and delegator authorization remain mandatory. Native Delivery owns execution
admission, duplicate suppression, final publication, and recovery; no new queue
or parallel delivery ledger was introduced. Database errors retain their original
meaning instead of becoming provider connection errors.

Feishu and Lark business Plugins use separate user consent through OpenConnector.
They do not borrow bot credentials. Lark support depends on OpenConnector PR 15,
including regional OAuth and API hosts, and covers Docs, Drive, Wiki, Base,
Calendar, and Tasks using the existing Feishu executor factories.

## Contract impact

Migration 0167 adds nullable Routine and Run destination snapshots and widens the
destination constraint. Existing Space and Slack rows retain their destinations.
It preserves the personal Agent executor columns from main's migration 0166.
The migration uses deferred foreign keys and was exercised with the existing
Routine integration suite. Apply it before deploying writers.

Shared Routine HTTP/RPC projections add `message_channel`; Remote Agent envelopes
add an optional verified `routineLocator` and a Message Channel Routine destination.
New readers accept old envelopes. Old strict readers cannot consume the new
fields or enum. Deploy compatible Web/Gateway readers and Remote Agent receivers
before Core produces these new envelopes. New Remote Agent code exposes the
current-channel Routine destination only when the admitted envelope supplies the
verified locator, so old Core does not activate the new producer. Keep compatible
readers during rollback; do not reinterpret persisted Message Channel Routines
as Spaces or Slack destinations.

Card controls reuse the normalized event and cancellation RPC. The bounded action
value limit accommodates JSON escaping of the 1,000-character form input. Old
cards continue to normalize without new controls. New controls fail closed on
old unsupported paths rather than granting actions from model-authored text.

CLI, Service, Prepare, workstation Wake, Space actions, and diagnostics retain
their existing semantics and version constants. Shared-schema artifact stamping
and the release readiness gate must still be completed before a Core release.
No new Cloudflare bindings are required. This design preserves the scoped
architecture owners: Routine owns scheduling, Native Delivery owns publication,
the worker owns execution cancellation, and OpenConnector owns business consent.

## Local acceptance

Lane: `wt-d3ba22003165`; bot: `OpenMeld Local Smoke 864`.

- Observed a growing answer card and final replacement.
- Submitted a native follow-up form and observed `PHASE3_FORM_OK` in the original thread.
- Stopped a streaming answer and observed the terminal Stopped card after worker cancellation.
- Created a one-time Routine through a real Feishu message and observed
  `PHASE3_ROUTINE_F_OK` in that original thread. The documented local scheduler
  trigger simulated the Cloudflare minute tick; production scheduling was not tested.
- Web changed-file React Doctor found no issues (93/100).
- Business Plugin entry points render, but local connection management returns
  503 because the dedicated development admin credential is absent. OAuth and
  actual business operations are not accepted by this evidence.
- Lark conversation acceptance remains explicitly deferred by the user.

The first natural-language Routine attempt used a bare tool name. The next
attempt repeated discovery instead of execution and was stopped. A request with
the exact Code Mode call created the Routine. This is guided acceptance, not
first-attempt natural-language success. The bare-name error now provides the
correct callable without automatically retrying a write.

The first scheduled delivery failed because the new claim persisted a prefixed
Run ID where the provider requires a UUID. Both normal and failure claims now
persist their atomic delivery UUID, and duplicate claims preserve the winner's
key. The SQLite regression asserts the provider UUID contract rather than the
internal Run ID. A new real request and Run passed after the fix; the earlier
failed Run is not relabeled as successful.

Native screenshots are retained in the task's `dev-tmp/phase3-unified-smoke/`.
They supplement boundary and real-database tests; they do not prove unobserved
permissions, production behavior, or other provider APIs.
