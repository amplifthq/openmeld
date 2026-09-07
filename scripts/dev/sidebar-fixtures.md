# Shared local product fixtures

Run from the isolated checkout:

```sh
pnpm dev:worktree
# In another terminal, after the Workers are ready:
pnpm dev:seed
pnpm dev:web:worktree
```

`dev:seed` discovers the current checkout's running `wt-*` lane and ports. It
creates a random fictional test account and Northstar Product Studio organization
on first use, then reuses them. It prints the local-only email/password and Web
URL, never session tokens. D1 and modified DM databases are backed up in
`dev-tmp/` before writes. No production or other worktree state is accepted.
On a new browser, choose **Not now** for notifications and **Skip setup** to go
straight to the fixture organization; these browser-local choices remain real UI.

Use `pnpm dev:seed --only people`, `--only spaces`, or `--only messages` to seed
one area and its directory dependencies. Repeat the command to restore unread
and preview scenarios. Existing sidebar arrangements are preserved; empty People
and Agents directories receive starter stars and custom groups. The fixtures are
shared source code, while each worktree owns its database and generated manifest.

See [the module contribution guide](fixtures/README.md) to add scenarios.

Use `pnpm dev:seed --account <email>` to refresh another test account already
saved in this lane. Generated visual scenarios are retained per Organization,
so switching between test accounts does not remove their state matrix.

Spaces include short discussions, Markdown, varied member combinations, and
timestamps from minutes to a month ago. Explorations stays empty; Billing
migration, Incident follow-up, and Security review include failure, stopped,
and policy-blocked system notices. The following cases use production components:

| Space | Scenario |
| --- | --- |
| Design feedback | Agent working status and elapsed time in the conversation |
| Release coordination | Plan review in the normal Pending Agent actions surface |
| Performance lab | Command permission in the normal Pending Agent actions surface |
| Billing migration | Sandbox failure system message |
| Incident follow-up | Stopped system message |
| Security review | Permission-blocked system message |

Transient cases use a development-only Space API response adapter, scoped to the
generated Space IDs and signed-in fixture profile on loopback. Real API reads
still check access first; real progress takes precedence. No JSX or separate UI
is added. Account-level discovery, closed Space rows, the conversation, and members
consume the same scenario state. Detail snapshots are available before the account
summary is published, so visiting a Space does not discover a new sorting priority.
Running scenarios refresh progress evidence on reads while retaining their start
time. Approvals validate through the shared interaction schema;
responses change only disposable browser-memory scenario data. No runtime state
is written and no command runs. Reload resets transient scenarios. These cases
validate production UI, not real Agent execution or cross-tab synchronization.

Synthetic conversations use stable IDs and backups; reruns
replace only these known fixture messages, preserving manually added messages.

Fixtures must only provide data to production UI and its normal interaction
entry points. Never add seed-only status rows, buttons, dialogs, or response
handlers to product components. Missing runtime scenarios must be supplied at
the data/protocol boundary, not recreated with a parallel UI.

Fictional members use deterministic DiceBear illustrations. This requires network
access to `api.dicebear.com`; the standard avatar fallback remains available.

## Prepare a login without sample data

Run `pnpm dev:account` after the local Workers are ready. It prints the product
login URL, a random `dev-…@example.com` email, and a simple eight-character password
(`dev` followed by five digits). Enter these credentials on the normal login page.
The command pre-verifies only the new fictional email in the isolated database;
password validation and browser authentication remain unchanged.

Repeat the command to retrieve the active account. Use `pnpm dev:account --new`
to create another account without removing previous accounts or their data.
Subsequent `pnpm dev:seed` runs populate the active account's organization.
For machine-readable output, use `pnpm --silent dev:account --json`.

Credentials are saved with owner-only permissions in the ignored lane-local
`dev-accounts.json`, beside its `v3` state directory. They are disposable local
test credentials, never production credentials. If the database was discarded,
the command prepares a fresh account. Each worktree keeps independent accounts.

The fixture adds 18 fictional members, 42 Agent identities (including two
disabled identities), multiple owner groups and 30 computer records. Bindings
cover Codex, Claude Code, OpenCode, Cursor, and a custom Gemini controller;
some Agents are unbound, have disabled historical bindings, or lack
Organization authorization. Activity timestamps span minutes to weeks.

It creates 28 real Spaces through the local Gateway/Core creation path and
sets six pins through the profile history API. Stable identity IDs and Space
purpose markers make reruns additive without duplicating fixtures. Existing
identity records are preserved; rerunning resets the fixture Spaces' pins.
Four long Space names exercise the full resize range. Space membership fixtures
cover one, two, three, and five members, including
people and Agents together. They use the Organization directory membership API,
so previews and total counts come from Space truth rather than UI overrides.

These are UI development fixtures, not working AI installations. No Service
process is impersonated and no online/Available state is fabricated. Core
continues to derive readiness from real transport and Service evidence.
Live connected, busy, and permission-prompt states require a local Service
or a protocol-level simulator. Database and API checks do not replace browser
or execution-path acceptance.

Seven DMs mix people and Agents with short, long, multiline, recent, older,
outgoing-only, and empty conversations. Their creation uses the DM API; synthetic preview
signals are written only to those fixture DMs' local databases.

The seed also creates four local Inbox unread records and writes the ignored
`clients/web/scripts/sidebar-preview/runtime-states.generated.json` for visual
fixtures. The product's Space sidebar does not consume synthetic Working or
needs-input summaries: its indicators come from the same API progress data
as the conversation. Use the standalone preview below for isolated row states.
Rerunning the seed restores unread records so clicking them does not exhaust the
test matrix permanently.

## Repeatable visual state matrix

For transient states that cannot honestly be seeded into runtime truth, run:

```sh
pnpm --dir clients/web exec vite --config scripts/sidebar-preview/vite.config.ts
```

Open `http://127.0.0.1:30180`. This loopback-only preview renders the same
Space, People, and Agent row components as the application. It does not
authenticate, call APIs, or write to the database. Pins and selections are
in-memory and reset on reload. It is outside the production route tree.

| Surface | Cases |
| --- | --- |
| Spaces | Idle, pinned, unread, pinned/unread, every Wake presentation kind alone and combined with pin/unread, newly joined, pin pending, multiple Agents with additional tasks, active tasks without loaded names |
| People | Every computer display state, current-user label, no identity vs Slack, no/one/six controllers including overflow, active/disabled, missing/recent activity, long names |
| Agents | Every shared availability phase, every operational indicator, queue count, initial checking, unchecked, request failure, refresh failure with previous result, own/teammate ownership, built-in/custom controllers |

Use the width slider, theme switch, hover, keyboard focus, and pin actions to
inspect layout. Lists use the production Fluid ScrollArea. Availability phases
come from the shared schema; Space kinds come from the presentation registry.

`clients/web/scripts/sidebar-preview/readiness.local.json` was captured from
the fictional local seed on September 6, 2026 and contains no credentials.
It is parsed with the shared response schema. Scenarios vary presentation
inputs on top of this capture; they do not prove real Agent execution.

## People connection previews

### Owner Computer detail state matrix

For a local account with an existing Computer report, an ignored
`clients/web/scripts/sidebar-preview/computer-preview.generated.json` can opt in
to the Computer detail matrix. Set `organizationSlug`, `anchorDeviceId`, and
`anchorComputerId` to that isolated account's existing identities. No credentials
belong in this file. Remove the file and reload to disable the matrix.

The adapter first reads the authenticated inventory. Only an inventory containing
the configured anchor receives seven additional, distinctly named `Preview`
Computers: current software, ordinary disconnection, optional update, another
account owning the connection, required update, failed status lookup, and no
installed local agents. The catalog shape comes from the existing report;
simulated fresh reports omit private account labels, paths, Skills, and Usage
data. These are hypothetical protocol responses, not real connections or proof
of Wake execution. The ordinary list and detail components render every case.

Automatic-update preferences change only browser memory and reset on reload.
The API foundation rejects preview target IDs before any network request, so
update, reconnect, Agent creation, and other actions cannot turn these fixtures
into real mutations. Real Computer records and the real routing preference are
unchanged. This adapter is development-only, requires a loopback host and the
configured Organization, and is excluded from production builds.

Ordinary disconnection and an account-ownership conflict intentionally retain
different protocol reason codes even if the current UI displays the same label.
Do not alter fixtures to conceal a missing product distinction.

The generated manifest also assigns the 42 fake Agents a mix of Available,
Checking, Offline, Connect, and Unavailable sidebar states. These are loopback,
development-only presentation fixtures for the seeded Organization and IDs.
Tooltips identify the simulation. They never alter Core readiness, Bindings,
permissions, the detail panel, or actual Wake eligibility. Production builds
remove the fixture path. The same display classification drives filter counts
and results, after hydration.

The seed manifest also includes connected, offline, never-connected, needs-attention
and unknown Computer states for the synthetic teammates. People applies these
only in development on loopback, for the exact seeded Organization and viewer.
The signed-in person's own Computer state is never overridden. Synthetic member
details explicitly identify the connection states as simulated. No heartbeat,
Service readiness, Binding or execution truth is written. Sidebar filtering and
the selected member's Computer cards use the same preview state.
