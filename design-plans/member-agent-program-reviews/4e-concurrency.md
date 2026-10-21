# Phase 4e · Folder-scoped concurrency — external review

Package 4e of [the MemberAgent program](../member-agent-program.md)
(§4.4, §4.9, §10 Phase 4, scope as rescoped on 2026-10-19).
Branch: `claude/map-4e-concurrency-1cb0c4`, reviewed diff `349837738..742edf674`
(the `feat(core): [4e]` and `feat(service): [4e]` commits before the fixes
below).

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: a conflict that is wrongly dropped (two writers on one folder
  with a stale or mismatched `folderKey`); a notice, prompt, diagnostic or
  error that leaks an absolute path to a non-owner; a non-owner task that
  gets a direct-edit workspace on a git folder, or an owner task that loses
  direct edit. Then any other correctness bug in the diff.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | The run checked the admitted `folderKey` and then kept the original path. Preparation resolves that path again, so a parent symlink that changes after the check moves the writer into another folder that the slots consider separate. | Yes (`prepareExecutionContextWorkspace` calls `canonicalDirectory` on the original path) | Fixed. `assertExecutionContextAdmittedFolder` returns the canonical folder it checked, and the run continues in that folder. Test: "reports a vanished folder without its path and continues in the canonical folder". |
| 2 | If the folder disappears after admission, `realpath` throws `ENOENT … '<absolute path>'`. That message reaches the Core-bound failure payload through the generic error conversion. | Yes (`task-execution-error.ts` keeps the message) | Fixed. A folder that cannot be read fails as `execution_context.folder_changed_while_queued` with fixed text and no path. Same test. |
| 3 | If the folder could not be resolved at admission, the hint was dropped and the task kept `current` with no key. When the folder resolved later in the run, a non-owner edited the original repository directly. | Yes | Fixed. A pending `isolated_if_git` with an unresolved folder stays undecided (`workspaceChosen: true`, no key), and the run fails closed instead of using direct edit. Test: "keeps a pending default undecided when the folder is unresolved, so the run fails closed". |
| 4 | Any failure in the git check (no first commit, damaged metadata, timeout) chose direct edit. | Yes | Fixed. The Service now tests for a git repository root (a `.git` entry). Unreadable state counts as git. A repository whose isolated copy then cannot be made fails visibly (for example `execution_context.project_commit_required`). It never falls back to direct edit. Test: "isolates a git repository even when an isolated copy cannot be made yet". |
| 5 | Folder resolution before admission formed an unbounded queue in front of the bounded slot queue. One stalled filesystem read held later deliveries, and drain did not see them. | Partly | Mitigated. Admission resolution now times out after 10 s and the task is admitted with an unknown folder (machine-wide rule; a pending default fails closed in the run). A delivery admitted after drain begins is deferred by the slots as before (`service.draining`), so Core redelivers it. Not changed: drain does not wait for an in-flight admission. That work never reached `accepted_local`, so redelivery covers it. |
| 6 | The shared-folder prompt listed other Sessions' Execution Context ids for any requester. Context ids are owner-only (agent-transport-contract.md, task-context diagnostics). | Yes | Fixed. Session ids appear only when Core verified that the owner requested the Wake (`requesterIsAgentOwner`). Other requesters see the Agent label and "this Space" or "another Space". Test extended. |
| — | Core marking: owner work, explicit workspace, fork, resume and auto continuation, redelivery after the workspace is recorded. | — | None found. |
| — | Services below `executionContextVersion` 7 keep `current`. | — | Documented compatibility (§4.9): an older Service runs the assigned workspace until it updates. |
| — | Absolute paths in the shared-folder prompt, folder labels, run lines or the completion `workspace` field. | — | None found. |
