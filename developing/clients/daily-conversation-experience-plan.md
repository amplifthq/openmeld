# Daily conversation experience repair

## Agent Context

- Purpose: Hand off the single repair PR covering issues #1088, #1067, and #1086.
- Read this when: Implementing or reviewing this combined daily-experience change.
- Update this when: Fresh main, observed behavior, or implementation changes the evidence or scope.
- Do not use this for: A new task board, notification policy, Desktop updater, runtime scheduler, or general app redesign.
- Source of truth: This temporary handoff records accepted scope; the existing Web, shared UI, Settings, Space, and execution owners remain authoritative.

Status: DRAFT — combined repair approved for handoff on 2026-09-16. Remove when the repairs are implemented and durable conclusions are incorporated into their owners, before merging the implementation PR. Do not merge this plan alone as a completed repair.

## Scope and stage

Felix requested one PR for all three issues. They share an everyday user-experience outcome, not a single technical root cause. Keep the implementation coherent without inventing a unifying framework or separate permanent state store.

The user should compose a new Center Agent message as naturally as any existing conversation, find the exact work advertised by the sidebar activity indicator, and open one stable Settings dialog. This is the implementation PR with a planning-only initial commit. The receiving Agent continues on this branch after resolving fresh main; no runtime implementation, tests, browser smoke, or deployment are claimed yet.

## Evidence at the inspected baseline

Baseline: `42ee500ef2af9244c5cb985ec3d09e624302a9a8`.

### Center Agent composition — #1088

[New chat](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/components/organizations/center-agent-new-chat.tsx) stores the pending message before awaiting session creation, but still awaits sidebar preference persistence before navigation and pending-message handoff. [The optimistic conversation](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/components/organizations/center-agent-optimistic-conversation.tsx) already renders a pending bubble and uses a separate minimal input surface. The issue's blanket claim that no optimistic feedback exists is therefore too strong without runtime evidence. Its file-name-only attachment tray and lack of the shared paste/drop wiring remain useful source findings.

Prefer sharing the established composition and attachment behavior, preserving only real new-session differences. First paint, authoritative submission, and sidebar naming are distinct events. A slow or failed cosmetic preference write should not unnecessarily hold up sending. Preserve draft text, files, stable message/session intent, failed-send recovery, and subsequent user input across navigation; a pending bubble must not imply the Agent has already started executing. Opening an empty composer should not create a server chat by itself. Avoid requiring a wholesale conversation load or redesign merely to share the input experience.

Useful existing owners include `space-composer.tsx`, `space-composer-attachments.tsx`, and the pending-message/draft helpers. Existing Spaces attachment timeout/retry behavior should not be accidentally lost when reusing components.

### Activity navigation — #1067

[Account active-Wake summary](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/packages/schemas/src/schemas/http/account-space-active-wake.ts) carries Space and Agent counts without exact message/thread locators. The sidebar therefore cannot express the advertised work's precise destination from that summary alone. Existing Space focus routing and `clients/web/src/lib/inbox/source-target.ts` provide useful navigation contracts.

Prefer a locator derived from current authorized work evidence, not a guessed latest message. A single run should open its source and correct thread. Several runs need an understandable choice or a stable target matching the displayed status; the exact presentation is not prescribed here. Authorized viewers should not have to own the Agent or the initiating request just to navigate. Missing, completed, deleted, inaccessible, or older-version targets need honest handling without granting access or inventing a running task.

Keep thread-scoped full activity in its proper conversation. Do not flood the main timeline to compensate for a missing jump. Do not add one heavy background read per sidebar row. Optional new fields alone do not prove old strict readers are compatible; validate the actual mixed-version contract and rollout if the payload changes. Navigation and read-only activity do not acquire Stop authority or alter execution state.

### Stable Settings — #1086

[App Settings host](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/components/settings/app-settings-dialog.tsx) currently puts a complete Settings shell with null navigation in the lazy fallback, before the loaded Settings page owns another shell. Prefer one stable dialog/navigation owner with loading restricted to the appropriate content. Exact component organization remains an implementation decision.

Preserve the current organization/personal grouping, selected section, host capability filtering, focus, Escape/backdrop dismissal, route behavior, and background drafts. A gated or obsolete section should recover without mounting multiple competing windows. Do not mask the symptom with arbitrary delays or eagerly load all heavy panels as the default fix. Verify the cold first-open transition, not only reopening a cached chunk or counting simultaneous DOM nodes.

## Boundaries and acceptance

PRs #1070 and #1076 already improved thread loading, exact reply navigation, read observation, and conversation loading. Preserve these improvements. Product review on #1100 retains both clickable reply previews and the explicit Open thread action; this PR must not disable one as incidental cleanup. #1090 Tasks, #1089 notification scope, and #1098 Desktop distribution/update work are outside this batch.

Use targeted behavior evidence: first send with attachments under delayed/failing session or preference reads; paste/drop and draft survival; exact main/thread activity jumps including multiple or stale runs and repeated selection; and cold Settings opening plus capability-filtered destinations. Shared Web/Desktop consumers should retain their host boundaries, but this is not authorization to package or deploy Desktop. Broader tests should match the actual changed contracts rather than become an unrelated release matrix.

Relevant owners are `developing/clients/web.md`, `developing/clients/shared-ui.md`, `developing/clients/shell-and-settings.md`, `developing/product/space-collaboration.md`, and `developing/architecture/shared-contracts.md`. Any durable contract, compatibility, rollout, and Changelog updates belong with implementation. Keep the three issues open during this planning stage; apply closing links only after their agreed outcomes are actually implemented.
