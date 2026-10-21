# Phase 4 · Answer an Agent's question in Inbox — review

Finding: R3-03 from smoke round 3 (§4.6 of
[the MemberAgent program](../member-agent-program.md)). Branch
`claude/map-4-inbox-answer`, cut from the program head `1c0f7d7ac`.

## What changed

- **Core:**
  - The Inbox item for an Agent's native question (permission, plan review
    or question) is filed under Needs action for every kind, not Awaiting
    review. Only the Binding owner can answer, and the Agent waits until
    they do.
  - An item written earlier as a review moves to Needs action on its own
    source replay. Nothing else about the item may differ.
- **Web:**
  - An `agent_interaction` item opens its Inbox detail, as Plugin action
    requests already do.
  - The detail renders the existing `SpaceAgentInteractionCard` with the
    harness's own options, plus Open conversation, which keeps the exact
    Space focus.
  - The answer goes through the same Space endpoint, so answering anywhere
    closes the question everywhere. Core still shows the options only to
    the Binding owner, observers included.
  - While the question is open, the detail refreshes every 5 s.
  - If the question was answered or has ended, the detail says so and keeps
    Open conversation, so the user is never left at a dead end.

## Review run

2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`),
diff `1c0f7d7ac..e6c1c3046`. It found three P2s, all fixed:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | An answer given elsewhere left the options showing until focus or remount. | Fixed. The detail refreshes while the question is open. Test: the options go away once the question ends. |
| 2 | Items already filed as a review stayed there, and their replay hit a source conflict. | Fixed. A narrow repair changes only the category on the item's own replay. Test: an item filed as a review is moved to action on replay. |
| 3 | When a Space had more than 25 active Wakes, a question beyond them showed as ended. | Fixed. If the list is cut short and the question is not in it, the detail asks the user to answer in the conversation. Test covers it. |

Codex found these fine:
- several human Profiles and observers who own the Agent;
- non-owners never get the options;
- an exact retry is idempotent and a conflicting answer is rejected;
- notification clicks keep the item's identity.

## Checks

- **Typecheck:** `services/core` and `clients/web` pass.
- **Core:**
  - Interaction Inbox producer: 20 passed. Inbox item service: 7 passed.
  - Inbox feed, item, service, email and producer suites: 89 passed.
- **Web:**
  - `inbox-agent-interaction.test.tsx`: 4 passed.
  - `inbox-page`, `inbox-notification-listener` and the new test: 73 passed.
  - `source-target.test.ts`: 19 passed. The one failure (organization
    document route) also fails on the clean base.
- **Not run:** a browser smoke of answering from Inbox.
