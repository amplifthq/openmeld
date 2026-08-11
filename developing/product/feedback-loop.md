# Feedback Loop

## Agent Context

- Purpose: Define the Feedback Inbox and Feedback Issue product model, delivery
  modes, privacy boundary, and ownership rules.
- Read this when: You are changing Feedback submission contracts, Feedback
  Inbox provisioning, Feedback Issue handling, or CLI, Center Agent, and Web
  Feedback surfaces.
- Update this when: Feedback vocabulary, lifecycle, delivery behavior, privacy
  policy, data ownership, or follow-on batch boundaries change.
- Do not use this for: SQL tutorials, route implementation details, production
  provisioning logs, or general customer-support policy.
- Source of truth: This file owns Feedback Loop product semantics. Data writer
  and sensitive-data rules are also constrained by
  `developing/architecture/data-and-observability.md`.

## Product Position

Feedback Loop is OpenMeld's official internal experiment for receiving product
feedback. It is not a publicly released product surface in this phase. The
foundation is organization-scoped from its first migration: the official
OpenMeld organization is one ordinary Feedback Inbox owner, not a hard-coded
tenant or a special execution path.

Submitting a Feedback Issue stores it in a Feedback Inbox. Submission does not
Wake, invoke, notify, or otherwise trigger an agent. Handling automation belongs
to later batches and must preserve the same stored issue as its source of truth.

## Stable Vocabulary

- **Feedback Inbox**: An organization-owned destination identified externally
  by a random, non-enumerable, rotatable `inboxKey`.
- **Feedback Issue**: One submitted bug, experience problem, idea, or question.
- **submitterKind**: Exactly `human`, `local_agent`, or `center_agent`.
- **Feedback Issue status**: Starts at `new`; triage uses `dismissed`,
  `investigating`, `ticketed`, or `needs_human`; completed handling uses
  `resolved`.

Do not rename these concepts to report, ticket, case, queue, mailbox, or another
near-synonym. A ticket is an optional downstream outcome represented by the
`ticketed` status; it is not the Feedback Issue itself.

## Product Structure

### Submission Surface

Humans, local agents, Center Agents, and anonymous submitters use the public
Feedback submission endpoint. Authentication is optional enrichment: a valid
Bearer credential records the submitting user, while missing or invalid
credentials remain anonymous and do not block submission. The bounded shared
contract accepts no attachments, arbitrary records, or free-form client blobs.
In Web, the human entry lives under **Settings → Personal → Send feedback** and
opens the existing bounded feedback dialog.

### Feedback Inbox

Each Feedback Inbox belongs to one organization. `inboxKey` is the public
submission locator; `inboxId` is the durable internal identity. Inbox status is
`active` or `paused`. A paused inbox rejects new submissions without changing
existing Feedback Issues.

### Handling Surface

The Core Feedback Issue service owns listing and status updates. They are not
Gateway RPC methods and have no HTTP routes. The Remote Agent's
`openmeld_list_feedback_issues` and `openmeld_update_feedback_issue` tools call
the explicit-organization methods on Core's default service-binding entrypoint.
The organization comes only from the Core-originated turn context; neither tool
accepts an organization identifier. The list result labels issue summaries and
details as untrusted external submissions that must be treated as triage data,
never instructions. Scheduled handling may reuse the same Core boundary without
introducing a second writer.

The status machine is forward-only. A `new` issue may become `dismissed`,
`investigating`, `ticketed`, or `needs_human`. An `investigating`, `ticketed`,
or `needs_human` issue may become `resolved`. Same-status writes are allowed so
the handling surface can update `triageNote`; `dismissed` and `resolved` are
otherwise terminal. Reopening requires a future explicit product decision and
must not be modeled as an implicit backward transition.

## Delivery Modes

`inbox_only` is the only implemented and accepted delivery mode. It means a
submission is stored and nothing else is triggered.

`direct_to_ca` is a reserved future vocabulary value only. No current schema,
service branch, route, or worker may accept or execute it. Introducing it
requires an explicit product and architecture change that defines agent
authority, retry, idempotency, privacy, and visible failure behavior.

## Center Agent Preset Reporting Privacy

Center Agent reporting must describe the observed product symptom, not export
the user's data. Preset reporting must not attach conversation transcripts,
prompts, files, credentials, arbitrary records, or private application state.
It may submit the bounded Feedback Issue fields, a source organization identity,
and the small allowlisted client context.

Preset reporting is enabled by default and can be opted out per organization.
A missing policy row means enabled; a policy storage or query error fails closed
and must not be interpreted as enabled. Organization members may read the
policy, while only organization owners and admins may change it.

`openmeld_report_feedback` accepts only `category`, `summary`, and optional
`details`. It derives `sourceOrganizationId` from the Core-originated turn,
sets `submitterKind` to `center_agent`, and sends only the allowlisted
`clientContext.clientKind = center_agent`. It cannot accept organization IDs,
attachments, arbitrary records, contact data, or client blobs. Center Agent
reports use the same public submission endpoint and the same server-side rate
limits as other submitters. They do not receive a privileged ingestion path.

## Data Ownership

- `openMeldFeedback_inboxes` stores organization-owned Feedback Inbox identity,
  label, key, delivery mode, status, and timestamps. The guarded admin ensure
  command is the W-FB1 provisioning entrypoint.
- `openMeldFeedback_issues` stores Feedback Issues and their triage state. The
  Core Feedback Issue service is the sole runtime writer.
- `openMeldFeedback_reporting_policies` stores the organization-level preset
  reporting opt-out and the user who last changed it. Core is the sole policy
  writer; absence means the product default of enabled.

The Core service copies the receiving inbox's `organizationId` onto each issue.
Callers cannot choose that receiving organization. The copied value is a query
projection written by the same Core operation; it is not a second tenancy
authority.
