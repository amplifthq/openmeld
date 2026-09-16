# Anonymous Read-Only Space Sharing Investigation

## Agent Context

- Purpose: Frame the reported gap between external guest access and account-free,
  read-only sharing of a Space message with its conversation context.
- Read this when: Investigating the companion Draft PR's external Space-link
  report or deciding the intended audience and interaction contract.
- Update this when: Production evidence or an explicit product decision changes
  the classification of the report.
- Do not use this for: An implementation plan, authorization to publish a private
  Space, or proof that a permission conflict has been reproduced.
- Source of truth: This document owns only the investigation scope. Existing
  product semantics remain in [Space Collaboration](../../product/space-collaboration.md).
  The companion PR description contains the reporter's exact incident links and
  transcribed screenshot observations.

Status: DRAFT — problem framing only; no implementation or product decision.

Remove this file when the investigation is resolved and its durable conclusions
are recorded in the relevant owner documents or issue/PR disposition.

## Desired outcome and reported result

A Space owner wants to share a readable link with an external recipient who has
no account and does not sign in. A message link should open the permitted content
and locate that message with its relevant thread context. Reading should not
require joining the Space or Organization and should not grant posting, editing,
or Agent execution rights.

The reporter enabled **Allow external guests**, retained **Only invited people**,
and observed **Members · 4**. Opening the Space link in another computer's browser
showed **This Space isn't available** instead of readable content.

## Evidence boundary

The report is based on supplied screenshots and a bounded static inspection of
repository revision `42ee500ef2af9244c5cb985ec3d09e624302a9a8`, not an independent
production reproduction or a verified deployed revision.

The visible guest helper text requires sign-in. The product owner document says
that guest invitations do not publish a Space to the internet, and the guest
confirmation in the inspected Web source describes participation rights beyond
reading. Invitation-based guests and anonymous read-only viewers are therefore
not interchangeable concepts in this investigation.

**Only invited people** is shown under the Space's own Access settings; the
screenshots do not establish a separate Organization-wide restriction. The
second browser's actual session, the persisted link-access mode, and the reason
for the denial remain unverified. The failed screenshot shows the base Space
URL, so it does not independently establish a message/thread navigation defect.

## Investigation questions

- What is the intended product contract for anonymous reading, separately from
  signed-in guest participation and Organization discovery or joining?
- Which authoritative access facts and viewer identity produced this denial?
  Is it expected enforcement, an incorrect decision, or an entry failure?
- Can an owner discover the supported external-reading workflow from the current
  sharing surface, and understand what a copied link does and does not grant?
- Do public entry, any permitted in-app transition, and message/thread loading
  agree on both the reader's entitlement and the requested destination?
- What context is intentionally shareable: one message, its thread, or the full
  Space? Which files, membership details, Agent activity, and other metadata are
  outside that audience? What are the revocation expectations?
- Does the unavailable experience truthfully represent the underlying result
  while preserving private-Space confidentiality?

## Handoff boundary

Classify the report from evidence before choosing a remedy. A correct rejection
under today's guest contract does not by itself resolve the unmet anonymous
sharing workflow. Conversely, a readable URL must not be treated as permission
to expose an invite-only Space.

This brief specifies no code changes, schema changes, new routes, UI redesign,
or permission-precedence change. No production settings are changed. Runtime
behavior, browser reproduction, and application tests are not validated by this
documentation-only draft.
