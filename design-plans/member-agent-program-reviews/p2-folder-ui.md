# Phase 2 · Folder UI (smoke R1C-02) — external review

Package: folder list in Profile settings, owner-only folder write route, and
the composer Folder menu, fixing smoke finding R1C-02 of
[the MemberAgent program](../member-agent-program.md).
Branch: `claude/map-p2-folder-ui`, reviewed diff `e38b50124..4eb7e9c7e`.

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: non-owner read or write; a local path reaching Core or another
  user; removing the default or changing it without admission and the
  Binding fence; the two-ordered-writes rule and its partial-failure
  message; Web state bugs (stale list, composer, recorded-list writes,
  "Continue in another folder").

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Non-owner access through the route, dialog or composer. | — | None found. |
| 2 | Local path reaching Core storage or another user. | — | None found. |
| 3a | [P1] The route let the owner remove the Default Project's folder; the Service protects only the saved default folder, and the Web guard was client-only. | Yes | Fixed. Core refuses `remove` of a Project folder whose Project is the Default Project (`resolveRemovableFolder`), fails closed when the folder is unknown or the Default Project can't be read. Test added. |
| 3b | [P1] The dialog used each render's Binding target, so an open draft could be applied to a Computer the owner never reviewed. | Yes | Fixed. The Binding target is frozen when Folders opens; a change blocks writes and asks the owner to reopen. Test added. |
| 4 | [P2] Retrying after a failed Default Project clear repeated the local save (and its admission); the partial-failure text claimed more certainty than a lost response allows. | Yes | Fixed. A folder that is already the saved default skips the local write and only finishes the clear; the message says the clear couldn't be confirmed and how to finish. Test added. |
| 5a | [P2] Open Rename, Remove-confirm and Add controls could still submit after the list turned read-only. | Yes | Fixed. Those controls take the same read-only guard. |
| 5b | [P2] A slower earlier GET could overwrite the list a change just returned, in the dialog and the composer. | Yes | Fixed. A change cancels in-flight reads and keeps the higher folder revision. |
| 5c | "Continue in another folder" unreachable. | — | None found. |

Nothing was rejected.

## Follow-up review: sensitive-operation gate (2026-10-19)

Change: the folder route's Gateway entrypoint `manageAgentProfileFolders`
now runs through `runGatewaySensitiveOperation` as `working_folder_write`,
and the Gateway route passes the caller's `requestCredential`. Reviewed
diff `a8bc7da7c..0d72ab371` with Codex CLI (`gpt-6-astra`, `high`,
read-only).

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Folder writes that skip the gate. The folder route and the people-computer workspace variants are gated; the Center Agent runtime-settings path checks the human root and audits separately. One pre-existing path remains: replaying a completed Center Agent `create_configured_agent_profile` request re-applies its original working folder through `rpcSetCurrentAgentProfileWorkspace` without the gate (`agent-profile-creation-request-rpc.ts`, `applyConfiguredShimWorkspace`), which can undo a later folder choice. | Yes | Not changed here: it predates this route and belongs to the Center Agent creation shim. Recorded for the designer as a follow-up (gate it, or apply the folder only on the request's first completion). |
| 2 | A confirmation replayed for a different folder change. | — | None found: the digest covers the operation and its fields, and approvals are single-use. |
| 3 | `requestCredential` reaching the folder operation or logs. | — | None found. |
| 4 | Web dialog applying anything on a confirmation refusal. | — | None found; a test pins the shown message and that Default Project is not cleared. |

## Follow-up review: smoke round 2b (2026-10-19)

Fixes on `claude/map-p2-smoke-2b`:

- **R2B-08:** Core's folder policy read the requester's Profile with
  `organization_id = <message Organization>`. Human Profiles have no
  `organization_id`, so the owner's own folder choice was always stripped
  and the task ran in the default folder. A Human requester now proves
  Organization membership through `members`; an Agent requester through
  its Organization.
- **R2B-06:** the Session picker forked tasks that had no finished turn.
  Fork choices now list only tasks the Agent finished with a published
  final reply, and "Continue in another folder" is unavailable, with the
  reason, for a task without one.

Reviewed diff `e2d523c5b..8e1be9785` with Codex CLI (`gpt-6-astra`, `high`,
read-only).

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | A non-owner's folder surviving the new query (other member, removed member, inactive Profile, Center Agent, Phase 3 root). | — | None new. An Agent requester with the same owner still passes without a membership recheck; that predates this change and Phase 3's root requester replaces it when enforced. |
| 2 | Another place that drops the owner's `folderId` between composer submit and the Service resolution. | — | None found; Codex traced every hop. Tests: composer submit carries `folderId`; a PostgreSQL test drives it through the policy into the accepted snapshot (fails without the fix). |
| 3a | A live streaming reply counted as a final reply, so an unfinished task could be offered for forking. | Yes | Fixed: only a published reply (no stream state) counts. Test added. |
| 3b | Requiring a published reply hides Codex sources that Core can fork from a retained native conversation without a frozen checkpoint, and a reply alone doesn't prove a Claude checkpoint. | Yes, trade-off | Kept. Web has no evidence of a retained native conversation, and the smoke failure was exactly such a source without one. Resume stays available for every source. Follow-up: a Core projection of fork eligibility per source would make this exact. |
| 4 | Regression in resume choices. | — | None found. |

## Follow-up review: smoke round 3 (2026-10-19)

Fixes on `claude/map-p2-smoke-3`:

- **R3-01:** a folder choice for Claude Code in the owner's Direct Message
  was rejected with `space.execution_context.unsupported`. Direct Message
  members are added without a controller snapshot, so the selection check
  saw no harness. It now falls back to the Agent's primary Binding (same
  owner, enabled primary) when the snapshot is empty.
- **R3-04:** a plain message failed with `execution_context.selection_required`
  once a fork left a second Session in the scope. Scope associations record
  when a Wake last used them; an ordinary message without a selection
  continues the Session used last. An explicit "Automatic" choice still asks.
  `developing/product/agent-profiles.md` (Execution Context selection) now
  states this rule.
- **R3-02:** Continue previous lists only requests the Agent finished with a
  published reply.

Reviewed diff `1c0f7d7ac..9257d063e` with Codex CLI (`gpt-6-astra`, `high`,
read-only).

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Binding fallback accepting an unsupported harness or a foreign Binding, or blocking messages without a selection. | — | None found: the fallback reads only for targets of a selection, uses the member's recorded owner and the enabled primary Binding, and the harness check still applies. |
| 2a | The 50-association bound could exclude the latest Session (keys sort by context id). | Yes | Fixed: the implicit choice reads the whole scope. |
| 2b | An authorized recovery resume did not refresh recency, so the next ordinary message could pick an older Session. | Yes | Fixed: a resume refreshes its existing association's last use; a retired association is never recreated. |
| 3 | Associations written before `usedAtMs` fall back to their context's creation time, which can rank a resumed older Session below a newer one once. | Yes | Accepted: no stored last-use exists to migrate; the next Wake on either Session writes `usedAtMs`. Pre-launch data only. |
| 4 | The published-reply filter hides failed, stopped or interrupted requests that the backend could resume, or Codex could fork from retained history. | Yes, trade-off | Kept as requested by the smoke finding: such requests failed for users when chosen from the composer. Interrupted work keeps its Work Recovery actions. A Core projection of per-source continuation eligibility would make the composer exact. |
| 5 | The implicit policy conflicted with the owner document's "multiple retained branches require an explicit source choice". | Yes | Resolved by updating that owner-document rule in this change; flagged for the designer. |

## Follow-up review: smoke round 5 (2026-10-19)

Fix on `claude/map-p2-repair-continue`:

- **R5-01:** after Working folder repair made folder-one the default, the
  next message in the same chat failed with
  `execution_context.workspace_changed` and offered only a generic Hand off.
  A Session keeps its folder, so Core still resumes the old Session and the
  Service refuses it. The failure now maps to one owner action, "Continue in
  <default folder>". It posts a new message in the same chat (and the same
  thread) that replies to the failed request, selects a new Session without
  a folder id, and carries a short handoff. The Service starts that Session
  in the Agent's current default folder; later plain messages follow it as
  the Session used last (R3-04). Colleagues see only the explanation, since
  their requests already start fresh in the default folder.
- **Deviation from the request:** this is a new Session with a handoff
  message, not the native fork used by "Continue in another folder". That
  fork needs the source Session's folder and checkpoint, and here the folder
  is gone or no longer the Agent's.
- **Not done:** a pre-send notice in the composer.
- **End-to-end coverage** is a chain of tests, not one cross-process test:
  the Core authority test walks folder-two Session → repair → plain message
  resumes the old Session → `new` creates a Session without a folder id →
  the next plain message follows it; the Service test refuses the old
  Session in folder-one and starts the new one there; the Web tests cover
  the mapping (owner versus colleague), the drawer source and thread, the
  posted payload, and the owner-only button.

Reviewed the staged diff on top of `3bb1d283d` with Codex CLI
(`gpt-6-astra`, `high`, read-only), then a re-check of the fixes (`medium`).

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Owner gating, folder policy, error-code mapping, new-Session resolution. | — | None found: colleagues get no action, the server policy is unchanged, the mapping matches the Service error exactly and shadows nothing, and Core plus the Service start the new Session in the current default folder. |
| 2 | P1: in a thread, the action posted to the main timeline because the drawer read `threadContext`, which message details never request. The thread's next message would still resume the broken Session. | Yes | Fixed: the drawer passes the thread it opened in, as the existing Hand off does. Test added for main timeline and thread. |
| 3 | P2: the button and the handoff named a folder from a recorded projection that may be stale. | Yes | Fixed: the button names a folder only from a projection the Service just confirmed; the handoff names no folder. Test added. |
| 4 | P2: prepending the handoff to a maximum-length request exceeded the Space text limit. | Yes | Fixed: the request is shortened to fit, with a note that the full request is the message it replies to. Test added. |
| 5 | Test gaps: rapid double click, timeout and retry deduplication. | Partly | Double clicks are blocked by an in-flight guard; a retry reuses the deterministic client message id, which the Space authoring receipt deduplicates. No separate tests added. |

## Follow-up review: smoke round 6 (2026-10-19)

Fix on `claude/map-p2-repair-continue-2`:

- **R6-01 (R5-01 persists):** after the repair, the same-chat failure
  explained "continue in a new session", but the drawer offered only Hand
  off. Root cause: the Direct Message drawer shows the published
  `terminal_failure` notice, and for a notice it took actions only from
  the Agent recovery plans. The `session_folder` action from the round-5
  fix was reachable only through wake issue entries, which the real page
  does not produce for a settled failure. The edit context was not the
  cause: the drawer is inside `SpaceAgentProfileEditProvider`, as the
  working "Review working folder" button on the same page shows. The
  notice path now offers the folder continuation for
  `execution_context.workspace_changed`, after exact execution recovery
  reports unavailable. The action still renders only for the owner.
- **Copy:** the failure reads after "<Agent> couldn't reply:" and no
  longer names the Agent mid-sentence ("no longer This agent's working
  folder").
- **Test:** a new suite mounts the drawer as the Space page does, inside
  the real `SpaceAgentProfileEditProvider`, with the published failure
  notice and an execution-recovery handler. It fails without the fix.
- **Browser verification** on this branch's own dev-local lane (isolated
  Service `com.openmeld.openmeld-background-service.dev-local.97cef30c87ea5b87`,
  folders under `~/openmeld-smoke/r6fix`): baseline reply in folder-two;
  folder-two renamed on disk, the next request failed with Review working
  folder; folder-one made default; the next request in the same chat
  failed with `execution_context.workspace_changed`; the drawer showed
  **Continue in folder-one**; clicking it posted the handoff, Claude Code
  replied in the same chat, and a following plain message ran in the same
  chat with working directory `folder-one`. Screenshots:
  `dev-tmp/member-agent-smoke/round-6-fix/screenshots/` (local, not
  tracked).

Reviewed commit `a058e0552` with Codex CLI (`gpt-6-astra`, `high`,
read-only).

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Ownership, privacy, precedence (Agent recovery plan, then exact execution recovery, then the folder action) and shared copy consumers. | — | None found. |
| 2 | P2: when the failure notice itself is open (for example its request is outside loaded history), the source was rejected because only a human text message counts, so no action appeared. | Yes | Fixed: a failure notice continues the request it replies to, with the recorded reply preview as the handoff text, or a pointer to the replied message when there is none. Test added. |
| 3 | Test gap: the mounted test used a notice without a dispatch id, skipping exact recovery inspection. | Yes | Fixed: the notice carries a dispatch id and the drawer gets an execution-recovery handler that reports unavailable, as on the Space page. |
| 4 | Space Mesh: two tests expect older `workspace.missing` / `workspace.invalid` wording. | Yes, pre-existing | Same two failures on `fe6d239be`; not touched by this change. |
