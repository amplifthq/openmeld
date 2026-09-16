# Space Member Picker Fix Handoff

Status: DRAFT — investigation and implementation handoff only. Remove this file
in the same PR that completes the implementation. Update existing owner documents
only for newly established durable behavior, as scoped below; do not migrate
historical bug details. This is not a shipped feature or a settled design.

## Agent Context

- Purpose: Preserve the entry context for the fix associated with issue #1124.
- Read this when: Taking over this branch to investigate and implement the fix.
- Update this when: New evidence changes the diagnosis or the implementation scope.
- Do not use this for: Authorization policy, a second membership model, release
  evidence, or an instruction to implement every suggestion literally.
- Source of truth: Current code, reproducible product behavior, and the existing
  Space/Web owner contracts. This file and the PR description are advisory,
  dated investigation notes, not authority over those sources.

## Context and ownership

- [User report and discussion](https://github.com/amplifthq/openmeld/issues/1124).
- [Initial source review](https://github.com/amplifthq/openmeld/issues/1124#issuecomment-5696055045).
- Investigation date: 2026-09-16. Source baseline:
  `daa3a589c053a6e348ce1676f4f5423e5d34e554`.
- [PR #1126](https://github.com/amplifthq/openmeld/pull/1126) contains the expanded
  findings, source links, reduced-browser experiment record, limitations, and
  suggested repair options; see Findings 4 for the layout investigation.
- Read `AGENTS.md`, `developing/product/space-collaboration.md`,
  `developing/clients/web.md`, and `developing/clients/shared-ui.md` as applicable.

At the inspected revision, source evidence contradicts the early interpretation
that direct Add capability or its UI entry is missing. This does not invalidate
the user's observation that the action was not visible or discoverable. The
reporter's deployed revision remains unverified. Recheck current code and actual
behavior; do not treat this handoff as overriding either the report or new
contradictory evidence merely because it was written later.

## Starting points, not a prescribed solution

The normal picker already renders an Add button and calls the immediate
Organization Directory membership API. Do not implement a duplicate direct-add
capability or turn its organization-only candidates into a mixed Add/Invite flow.

The picker query can remain enabled while the dialog is closed. Reopening an
already-mounted dialog does not itself revalidate that directory; staleTime is
not a refresh timer. Cached-data refresh failures also suppress the directory
error/retry UI. Consider an explicit, deduplicated open-time revalidation using
the existing query and distinguish background failures from initial failures.

Treat Organization candidates, Space membership, and recent activity as separate
facts. The existing live feed already handles `space.members.changed` by
refreshing members; do not assume the entire live-update mechanism is absent.

The candidate list has a `min-h-40` floor inside a height-capped, overflow-hidden
popup. The earlier PR investigation records a reduced HTML/CSS probe on
2026-09-16 using the source baseline above, Chromium 144.0.7559.96, and 30 synthetic
rows: no clipping at 1280x720, 800x600, or 390x844; clipping at 800x360 and 390x400;
and clipping at 390x500 with a synthetic multiline error/retry notice. Dimensions
are CSS pixels, not screenshot pixels. These are source-derived probe conditions,
not an OpenMeld build or the reporter's session. This document review did not
independently rerun the probe or validate its measurements; the PR record is a
starting point for product checks, not confirmation from another reviewer.
Removing the floor alone can collapse the list under long notices, so it is not
a validated complete fix. Verify the actual rendered component, deployed revision,
and viewport before attributing the screenshot.

The taking-over Codex agent owns further investigation and the final solution.
It may revise, reject, or replace these suggestions based on actual evidence.
Preserve existing server authorization, confirmed member-cache updates, Agent
owner selection/counts, Center Agent exceptions, guest-invitation semantics,
and Direct Message conversion behavior. No implementation, product-test pass,
production reproduction, deployment, or completed fix is claimed by this branch.

## Completion and durable context

Delete this handoff when the actual implementation is completed. Record a new,
lasting Web interaction or refresh/error-handling contract in
`developing/clients/web.md` only where it needs durable documentation. Update
`developing/product/space-collaboration.md` only if membership or invitation
semantics actually change; the existing immediate-Add distinction need not be
copied again. `developing/clients/shared-ui.md` applies only to a changed shared
primitive contract or ownership boundary, not this picker's local styling.
Exact query keys, CSS classes, and implementation details belong in source/tests;
obsolete failure mechanisms and probe measurements remain in PR/git history.
Do not make broad documentation migration a prerequisite for this focused fix.
