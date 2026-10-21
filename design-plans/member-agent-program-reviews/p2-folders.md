# Phase 2 · Folders — external review

Package: Phase 2 (2a envelope, 2b projection, 2c selection) of
[the MemberAgent program](../member-agent-program.md).
Branch: `claude/map-p2-folders-a050d0`, reviewed diff `f415ebabe..af54e0d2e`.

## Review run

- 2026-10-18, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: any path that reaches Core; any way a non-owner's `folderId`
  survives; any envelope read or write that breaks an older Service; lock and
  projection concurrency; any unknown folder id that resolves to a substitute
  path.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1a | A selected custom folder that became unusable produced a dispatch failure whose text contained the absolute path (`profile-workspace/folders.ts`, `describeProfileWorkspacePathValidationFailure`), and dispatch failures reach Core. | Yes | Fixed. Selected-folder failure text is path-free (reason enum only); the managed-folder preparation failure no longer forwards the filesystem error message. Folder-operation receipts already replaced path failures with fixed text (`carrier/manage-profile-folders.ts`). |
| 1b | The existing dispatch result pipeline reports `effectiveRuntimeWorkingDirectory` to Core (`send-dispatch-result.ts`), so "no path ever reaches the cloud" does not hold for the Service as a whole. | Yes, pre-existing | Not changed in Phase 2: it predates folders and applies to the default folder too. Recorded as a program correction: §4.4 should say the folder projection and folder operations carry no path, and the dispatch-result path field needs its own decision. |
| 2 | Non-owner `folderId` surviving into an assignment. | — | None found. |
| 3 | Older-Service envelope compatibility. | — | None found. |
| 4 | A `list` receipt read before a concurrent folder save can arrive after that save's receipt; Core replaced the projection unconditionally, restoring an obsolete list with a newer timestamp. | Yes | Fixed. The envelope carries a Service-local `foldersRevision` bumped by every folder save; the projection reports it as `revision`, and Core keeps the record with the highest revision (`profile-folder-projection-store.ts`, read and write under the Durable Object input gate). Test: "keeps the newest folder list when an older receipt arrives late". |
| 4b | Lock and read-modify-write in `mutateProfileFolderListForAccount`. | — | None found. The lock is fail-fast (existing behavior): a concurrent writer is refused, never lost. |
| 5 | Unknown folder id resolving to a substitute path. | — | None found. |

Nothing was rejected.
