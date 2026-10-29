# Team key-projects design preview

A local, interactive design proposal for the Team homepage. It is not connected
to a production route or live Organization data. All project updates, people,
Agent contributions and Space destinations are illustrative.

## Run

From the repository root, after installing the normal workspace dependencies:

```sh
pnpm -C clients/web exec vite --config previews/key-projects/vite.config.ts
```

Open http://127.0.0.1:30184/. The server listens only on loopback.
No credentials, OpenMeld Service, account or cloud infrastructure are required.

Build the preview with:

```sh
pnpm -C clients/web exec vite build --config previews/key-projects/vite.config.ts
```

The build writes disposable output under the repository's ignored dev-tmp
directory; no tracked source depends on that directory.

## Review scope

- Follow selected key projects, with one concise outcome and one shared-source
  entry per project. Small fixes and routine maintenance stay out of the overview.
- Show a separate action only when the viewer needs to make a decision.
- Hover or click an Agent for a short, explicitly shared contribution.
- Unfollow removes a project from this viewer's homepage, not from the team.
  Undo and Manage following restore it. Preview preferences persist only in this
  browser, using the namespaced key
  `openmeld-key-projects-design-preview-following-v1`.
- Open Space navigates to a clearly labeled local illustrative Space. Browser
  Back and the explicit return link return to the project overview.
- Empty selections stay empty. Unselected and small-fix records do not fill gaps.
- No Agent Wake, periodic interrogation, model call, live API read, private
  session inspection or publication occurs.

## Before production integration

Reuse canonical Project IDs. Define the owner and server-authorized persistence
for a member's followed projects and explicitly published milestone updates.
A project is not important merely because it has recent tasks; do not infer
importance from title keywords or promote minor fixes into homepage updates.

Attach each update to a real source and accessible Space. Recheck source and
Space visibility, revocation and current Organization membership. Do not expose
private session content, local diffs or private memories. Project selection must
not grant access to its related resources.

Use account-scoped preferences for real following. The local preview storage is
not a production subscription store. Do not confuse Unfollow with project
archive, completion, deletion, Space membership, or notification settings.

Loading, failures, stale updates, multiple associated Spaces and unavailable
sources need real-data handling before this can replace the Team homepage.

## Validation and delivery

The local design was checked in a browser at desktop and 390px widths, including
Unfollow across reload, Undo, refollowing, empty selection, Agent catch-up and
illustrative Space navigation. These are prototype checks, not live-account or
installed Desktop acceptance.

This draft requires user review. Do not mark ready, merge, publish or update the
client without the user's explicit approval. No architecture owner rule is
changed: this proposal creates no production state, authorization or execution
authority. There is no shipped product change to announce in the Changelog.
