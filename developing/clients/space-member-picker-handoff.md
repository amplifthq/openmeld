# Space Member Picker Fix Handoff

Status: DRAFT — investigation and implementation handoff only. Remove this file
in the same PR that completes the implementation; retain relevant durable facts
in the existing owner documents. This file is not a shipped feature or a settled
design decision.

## Agent Context

- Purpose: Preserve the entry context for the fix associated with issue #1124.
- Read this when: Taking over this branch to investigate and implement the fix.
- Update this when: New evidence changes the diagnosis or the implementation scope.
- Do not use this for: Authorization policy, a second membership model, release
  evidence, or an instruction to implement every suggestion literally.
- Source of truth: Current code and the existing Space/Web owner documents;
  this file and the PR description are advisory investigation notes only.

## Context and ownership

- [User report and discussion](https://github.com/amplifthq/openmeld/issues/1124).
- [Initial source review](https://github.com/amplifthq/openmeld/issues/1124#issuecomment-5696055045).
- Investigation baseline: `daa3a589c053a6e348ce1676f4f5423e5d34e554`.
- The PR description on this branch contains the expanded findings, source links,
  reduced-browser experiment results, limitations, and suggested repair options.
- Read `AGENTS.md`, `developing/product/space-collaboration.md`,
  `developing/clients/web.md`, and `developing/clients/shared-ui.md` as applicable.

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
popup. A reduced Chromium HTML/CSS probe reproduced footer clipping in short
viewports, but not in the normal tested sizes. This was not the compiled product
or the reporter's session. Removing that floor alone can collapse the list under
long notices, so it is not a validated complete fix. Verify the actual rendered
component, deployed revision, and viewport before attributing the screenshot.

The taking-over Codex agent owns further investigation and the final solution.
It may revise, reject, or replace these suggestions based on actual evidence.
Preserve existing server authorization, confirmed member-cache updates, Agent
owner selection/counts, Center Agent exceptions, guest-invitation semantics,
and Direct Message conversion behavior. No implementation, product-test pass,
production reproduction, deployment, or completed fix is claimed by this branch.
