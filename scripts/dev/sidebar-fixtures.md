# Local sidebar fixtures

Run from the isolated checkout:

```sh
python3 scripts/dev/seed-sidebar.py \
  --lane wt-3adcea1ef678 \
  --organization northstar-product-studio-eddhvg \
  --gateway-port 30177 \
  --viewer-email maya.chen@example.com
```

Use the current checkout's lane and ports. The script only accepts an existing
`wt-*` local database. It requires an existing Organization and a signed-in
fixture viewer, never prints session credentials, and backs up D1 into
`dev-tmp/` before writes.

The fixture adds 18 fictional members, 42 Agent identities (including two
disabled identities), multiple owner groups and 30 computer records. Bindings
cover Codex, Claude Code, OpenCode, Cursor, and a custom Gemini controller;
some Agents are unbound, have disabled historical bindings, or lack
Organization authorization. Activity timestamps span minutes to weeks.

It creates 24 real Spaces through the local Gateway/Core creation path and
sets six pins through the profile history API. Stable identity IDs and Space
purpose markers make reruns additive without duplicating fixtures. Existing
identity records are preserved; rerunning resets the fixture Spaces' pins.

These are UI development fixtures, not working AI installations. No Service
process is impersonated and no online/Available state is fabricated. Core
continues to derive readiness from real transport and Service evidence.
Live connected, busy, and permission-prompt states require a local Service
or a protocol-level simulator. Database and API checks do not replace browser
or execution-path acceptance.

The seed also creates four local Inbox unread records and writes
`clients/web/scripts/sidebar-preview/runtime-states.local.json` with six visual
Working / needs-input scenarios. The full local app consumes that manifest only
in a development build on loopback, for its exact fixture Organization and viewer.
It includes pinned and unpinned Working, unread, combined, and needs-input rows.
Real runtime summaries take precedence. The visual manifest never writes runtime
execution, transport liveness, or readiness records, and is disabled in production.
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
