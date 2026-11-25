# Organization Dashboards

## Agent Context

- Purpose: Define dashboard creation, source access, and the shared dashboard collection.
- Read this when: Changing dashboard types, source links, access, or Center Agent drafts.
- Update this when: The dashboard contract, permissions, or source behavior changes.
- Do not use this for: Provider-side issue mutations, analytics collection, or artifact hosting.
- Source of truth: Core owns dashboard configuration; each source owns and authorizes its own data.

Dashboard is a workspace collection, not a single preset report. Current
human members can create and view Dashboards. A creator, owner, or admin can
edit or archive one. The collection owns names and source configuration,
not the state of issues or other live source data. An archived dashboard
does not delete, close, or reassign anything in a source system.

- **GitHub Issues** reads a selected repository through the viewer's verified
  personal GitHub connection. The saved name and repository identifier are
  shared in the Organization; issue titles and assignees are not saved or
  shared by the dashboard. The reader cannot borrow the creator's credential.
  Apply assignment or acceptance changes in the linked source issue on GitHub,
  then refresh OpenMeld to read the current state.
- **UGC** and **Traffic** can be configured without a source. They indicate
  when no data source is configured. An already built HTML dashboard can be
  attached using a native OpenMeld File Preview link; only the Space, file
  and immutable revision are saved. The creator and every reader need current
  source access, and the existing static preview disables scripts and external
  resources. Linking a revision does not change its visibility or upload it.
- **Center Agent** can prepare a typed Dashboard draft link with only the kind,
  name, explicitly supplied repository or explicitly supplied native artifact
  reference. Opening that link prefills the same form as direct creation. It
  does not grant access, publish, connect a provider, or mutate the workspace.
  The member must review the scope and choose Create.

Organization membership is rechecked per read and write. Each request carries
the expected Organization so an account or workspace switch cannot
silently write to another workspace. The list returns only dashboard metadata.
The selected native artifact reference is revealed only after a current,
viewer-scoped authorization check.

## Verify in Web

1. In an isolated Organization with test data, open **Dashboard** from the left
   navigation. Create a named UGC dashboard with no upload. It appears after
   refresh and indicates no configured source.
2. Attach an existing native HTML artifact revision to a Traffic dashboard.
   Before Create, open the existing preview and check the workspace scope.
   Verify a member with Space access can open the sandboxed static preview;
   a colleague without access receives no artifact reference or content.
   Verify the artifact pinned in the dashboard does not advance to a newer revision.
3. Ask Center Agent to create a named Dashboard. Open the resulting draft link,
   verify the prefilled values, and close before Create. The list must not change.
   Open it again, submit explicitly, and verify the saved record.
4. Create a GitHub Issues dashboard for a test repo. Verify the issue data
   from each member's own connection, including a viewer without repository
   access. Transfer a test issue on GitHub, then refresh Dashboard and Inbox.
   Do not use live production assignments as test fixtures.
