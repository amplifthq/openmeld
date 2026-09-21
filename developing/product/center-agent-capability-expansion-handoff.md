# Center Agent capability expansion — handoff (2026-09-21)

Status: **planning handoff only**. Owner-approved direction (Felix Lu, 2026-09-21). No implementation code in this branch. The full problem statements, proposed minimal behavior, guardrails, and acceptance sketches live in the PR conversation comments; this document is the durable summary.

## Why this exists

Between 2026-09-15 and 2026-09-21, a chain of Center Agent failures around scheduled Routine runs (tracked in #1173, investigated in #1198) showed a recurring pattern: the Center Agent is the first responder when something misbehaves, but it lacks the read entry points to answer even basic "what actually happened" questions, and it twice produced conclusions from gaps instead of facts.

A 2026-09-21 self-review of this organization's actual usage observed: 25 human members, 113 Agent Profiles (94 owned by the owner), and 40+ Spaces. Work falls into three classes — coordinating product debugging (most frequent), operating scheduled Routines, and business assistance. The pain in the first two classes lands directly on Center Agent reliability and diagnosability.

**Selection principle:** only deterministic, generalizable items — objectively missing read entry points, or reproducible tool defects. Items requiring the platform to judge whether a model turn "did enough" were explicitly rejected by the owner and are out of scope.

## Items

### 1. Routine run read-only diagnostics

Missing read entry point. When a scheduled Routine misbehaves, the Center Agent cannot query the Run's state and resorts to inference from indirect signals; on 2026-09-16 this produced an incorrect "system blind spot" conclusion. Proposed: a read-only query returning translated, business-semantic state per Routine Run (current state, stage timestamps, failure reason summary, pointer to delivery records), scoped to Runs the requesting member can already see. See PR comment 2.

### 2. Execution diagnostics coverage for Routine runs

Turn diagnostics exist for interactive turns; the equivalent is not queryable for turns inside Routine runs (the 2026-09-19 empty-response incident has a blank where its model timeline would be, recorded in #1198). Proposed: extend the same structured diagnostics coverage to Routine run turns, read-only, without evaluating run "quality". See PR comment 3.

### 3. Fix Center Agent activity read tools

Two reproducible defects observed 2026-09-21: `openmeld_read_center_agent_activity` fails with `organization.membership_required` for the organization's own Center Agent, and `openmeld_read_agent_activity` has no pagination or filter parameters, so a full read exceeds the 131072-byte result cap and returns truncated. Together these block any organization-level usage analysis. See PR comment 4.

### 4. Cross-surface conversation and memory retrieval

Members routinely re-paste context across conversations; memory is automatic excerpts, useful but scattered. Proposed (minimal): a read-only retrieval entry point for the Center Agent's own past interactions and conclusions in this organization, strictly respecting existing per-conversation visibility. See PR comment 5.

### 5. To verify before separate filing

Two recorded defects had no open tracker found by issue search on 2026-09-21: Slack message links that are reliable in the turn they are retrieved but fail later, and the lack of an addressing path from a direct message into Space work. Closed #124 ("Fix Inbox links to exact Slack messages") is an older, related fix; a successor should confirm current behavior before re-filing. See PR comment 6.

## Explicitly out of scope

- **Turn-completeness judging / auto-continuation** — rejected by the owner: whether a turn "should have done more" is model reasoning, not a deterministic platform signal. Records (tool-call counts, model timeline, publication state) already exist; this is not a capability gap.
- **`empty_assistant_response` / `submitted` hangs** — execution-layer bugs owned by #1173 / #1198.
- **Failure-notification readability** — already covered in #1173 acceptance criteria.

## Successor notes

Fetch the then-current `origin/main` before implementing; reconcile with in-flight work (notably #1198); keep this PR Draft until behavior is demonstrated; follow the repository `AGENTS.md` and scoped owner documents. Design decisions marked "open" in the comments (e.g. whether cross-surface retrieval is one tool or strengthened memory capture) are decisions to make, not commitments.
