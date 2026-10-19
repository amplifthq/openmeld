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
