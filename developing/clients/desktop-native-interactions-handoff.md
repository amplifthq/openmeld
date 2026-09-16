# Desktop native interaction repair handoff

## Agent Context

- Purpose: Reserve one implementation PR for four bounded Desktop fixes.
- Status: Investigation handoff only; no product implementation or validation is claimed.
- Read this when: Taking over `codex/fix-desktop-native-interactions-20260916`.
- Source of truth: The associated PR's main implementation-handoff comment contains the evidence, source links, suggested changes, exclusions, and focused checks. This file is only its temporary branch marker.
- Lifecycle: Remove this marker when the implementation is complete; retain any changed durable behavior in the existing Desktop/Web owner documents.

## Accepted scope

1. Preserve persisted composer drafts during unconfirmed Desktop session revalidation without weakening real sign-out/account isolation.
2. Open allowed ordinary external links in the system browser while continuing to deny arbitrary Electron windows and unsafe schemes.
3. Restore ordinary close-to-hide behavior after a normal quit is cancelled, without undoing accepted updater installation protection.
4. Preserve native Space WebSocket close metadata through the shared schema, preload, and renderer adapter so existing consumers retain their semantics.

## Baseline and boundaries

The review baseline is main `a9e0fa1f1c8148a077a7bad8d6f7a3572475451f`.
Related Desktop PR #1128 was inspected at `169a437e6cc526bc834d3b3d340de86a9afc45ff`.
Recheck these refs and the affected files at takeover; they are evidence anchors, not permanent branch heads.

This PR does not absorb #1128's connections, unread counts, or #1110 notification-navigation work, nor #1105's shared conversation changes. It does not authorize a SDK transport rewrite, broad upstream cancellation, a new synchronization engine, or unrelated lifecycle hardening.

Keep this as an implementation PR, not a documentation-only deliverable. Use Practical Engineering and the existing scoped owner documents and delivery workflow. Do not merge, deploy, package, publish, or change real account/Service state merely to complete this handoff.
