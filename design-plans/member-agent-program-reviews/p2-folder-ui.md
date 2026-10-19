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
