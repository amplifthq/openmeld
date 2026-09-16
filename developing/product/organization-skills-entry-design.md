# Organization Skills Promotion To A First-Class Organization-Level Entry — Design Reference

## Agent Context

- Purpose: Support promotion of Organization Skills from a Center Agent home
  navigation item to a first-class Organization-level entry, with the product
  owner's motivation, verified current state, first-step scope boundaries,
  research questions, and acceptance references.
- Read this when: Taking over the feature PR or evaluating the Skills
  entry-point and navigation migration, route ownership, the relationship
  between an Organization-level Skills entry and the Center Agent product
  home, CLI and remote-agent consumption boundaries, or acceptance coverage.
- Update this when: Scope decisions, validation evidence, or repository
  assumptions change.
- Do not use this for: A shipped-feature claim, a mandatory implementation
  recipe, or authority beyond this PR's stated scope.
- Source of truth: [Organization Skills](organization-skills.md) remains the
  owning product document for the Organization Skills product. This file only
  records requirements and design references for this feature PR; it must not
  contradict that owner.

Status: DRAFT — implementation handoff for the Skills entry promotion PR;
runtime implementation and acceptance remain pending.

Remove when the feature ships and its enduring contracts are recorded in
[Organization Skills](organization-skills.md), or when this design is
superseded. Git history preserves the discussion.

Reviewed baseline: `main` at
`42ee500ef2af9244c5cb985ec3d09e624302a9a8`, September 16, 2026. Recheck the
relevant code before implementation.

## PR intent and handoff

This is the implementation PR for promoting Organization Skills to a
first-class Organization-level entry, not a standalone documentation
deliverable. The drafting agent planned and reviewed; the implementation agent
continues in the same PR and branch. This document is a starting reference,
not the completed feature. The PR stays Draft until the intended
implementation and risk-appropriate validation are complete.

## Verified current state

| Observed baseline | Implication for this change |
| --- | --- |
| [Organization Skills](organization-skills.md) defines the Organization Skill as Organization-owned: it belongs to exactly one Organization, is visible to every current member, and has one stable identity with immutable releases. | The data model and authority rules are already Organization-scoped. The gap this PR addresses is not storage or ownership. |
| The CLI contract `openmeld skills list / show / load` already authenticates the account and Organization, resolves an enabled release through Core, and materializes a read-only cache for local agents. | Local agents already have an authenticated consumption path. Entry promotion should not change the CLI contract by default. |
| The Center Agent and personal Remote Agent runtime read the enabled Organization Skill release snapshot through the shared Flue runtime; personal runtime does not require Center designation. | Remote personal agents already consume Organization Skills. The promotion concerns product entry ownership and presentation, not a new runtime path. |
| In the Web product, Skills is item 6 of the Center Agent header navigation (Messages, Graph, Files, Tasks, Routines, Skills, Plugins) and its routes live under `/o/{orgSlug}/center-agent/skills` — see `clients/web/src/routes/o/$orgSlug/_center-agent/center-agent.skills*.tsx`. | Skills is presented as a capability inside the Center Agent product home rather than as a team-level shared capability. This presentation gap is the core problem. |

The product owner's stated motivation is the same as the earlier decision to
move Plugins toward the team level: Organization Skills should be a shared
Organization capability that the Center Agent, local agents through the CLI,
and personal remote agents can all consume — not a feature that only exists
inside the Center Agent product page. The exact history and final presentation
of the Plugins move should be re-verified by the implementation agent and used
as the closest precedent.

## Problem statement and requested outcome

Organization Skills are functionally a team-level capability, but the Web
product presents them as a Center Agent feature: the only management and
browsing entry is a navigation item inside the Center Agent home, under a
`center-agent` route segment. The product owner wants Skills promoted to a
first-class Organization-level entry, so that:

1. the entry ownership matches the data and authority reality (Organization
   owned, visible to all members, consumed by Center Agent, CLI, and remote
   agents);
2. the global sharing goal is legible in the product: members can see and
   reach the Organization's Skills without going through the Center Agent
   product home; and
3. scope boundaries are clarified first, before the Skills product is
   re-polished and refactored in later work.

The requested first step is boundary clarity, not a full redesign. This PR
should establish what moves, what stays, and what must not change, and leave
product polish for the follow-up work the owner has planned.

## First-step scope: boundary clarity

The following are open research questions for the implementation agent, not
prescribed answers:

- Which surfaces move to the Organization level: navigation placement, route
  paths (`/o/{orgSlug}/skills` versus the current
  `/o/{orgSlug}/center-agent/skills`), or both — and what happens to the
  existing routes (redirect, alias, or removal)?
- How the Organization-level Skills entry relates to the Center Agent product
  home: does the Center Agent header keep a Skills item, a link, or neither?
- Which non-Web surfaces are in or out of scope for this first step: the CLI
  command group, the Center Agent management surface, and personal remote
  agent consumption should be confirmed unchanged rather than redesigned.
- How a personal workspace should present this change without introducing a
  separate Personal Skill type, scope, or catalog.
- Which owner documents must be updated together with the implementation
  (at minimum [Organization Skills](organization-skills.md), plus navigation
  and route ownership where they are recorded).
- Whether deep-link URLs used by Center Agent replies, messages, or help
  content depend on the current `center-agent/skills` paths.

## Suggested direction — personal suggestions, for reference only

The recommendations below are one reviewer's partial view. They are not
prescribed mechanics and need multi-party judgment before adoption.

- Prefer an entry-and-presentation promotion: keep the existing Core data
  model, authority rules, release semantics, and runtime contracts unchanged,
  and move only the Web entry, navigation, and routes to the Organization
  level. The verified current state suggests the hard parts already work.
- Keep the `openmeld skills` CLI contract backward compatible. Changing CLI
  shapes would churn local agents and the helper instructions for no benefit
  this first step needs.
- Treat the Plugins precedent as the reference the owner named, but verify it
  in the current code before copying its final presentation; the two products
  differ in that Skills already has a complete CLI and runtime consumption
  contract.
- Sequence the work as the owner described: this PR settles scope boundaries
  and entry ownership; the later Skills product polish/refactor starts only
  after this PR is merged and validated.

## Acceptance and remaining work

- [x] Verify the current Organization Skills data, CLI, runtime, and Web entry
  baseline and record it above.
- [ ] The agreed scope boundary (what moves, what stays, what must not
  change) is decided and recorded in the owning documents.
- [ ] An Organization-level Skills entry exists and is reachable without
  passing through the Center Agent product home, with correct permissions.
- [ ] The relationship between the Organization-level entry and the Center
  Agent home is implemented as decided, with old routes behaving as decided.
- [ ] CLI, Center Agent management surface, remote-agent runtime, and
  personal-workspace presentation are verified unchanged (or changed only as
  decided).
- [ ] Owner documents are updated together with the implementation.
- [ ] Risk-appropriate repository checks and real-user validation of the
  entry migration are complete.

No unchecked item above is complete. Draft status, this section, and the PR
description — not the feature title — communicate what is implemented,
pending, and validated.
