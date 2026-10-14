# Existing Grok Bot integration through BDK

Status: Draft investigation. Product integration is blocked on the provider
execution contract below. This document does not enable a controller or change
the existing Agent Profile, Wake, Stop, or publication contracts.

## Requested outcome

Connect a member's existing Grok Bot as an ordinary Agent Profile. Reuse the
current creation, directory, DM, Space membership, Wake, queue, Stop, settings,
and diagnostics surfaces. Do not introduce a separate Grok Bot collaboration
surface or represent it as an OpenMeld-hosted Remote Agent.

## Verified provider evidence

Official sources inspected on 2026-10-14:

- [Grok Bot agents extension](https://cursor.com/docs/bdk/guides/grokbot-agents)
- [BDK CLI](https://cursor.com/docs/bdk/reference/cli)
- Published `@cursor/bdk` version `0.2.24`, especially
  `dist/extensions/cursor-grokbot-agents/lib/backend.js` and `conversation.js`.

An account owner authorized a real test against an existing personal Bot:

1. Official `bdk login` created a separately revocable test credential.
2. `grokbot__ask` returned the exact requested reply; the native app showed the
   message in the original conversation, next to prior messages.
3. A second task acknowledged STARTED and requested a 120-second foreground
   sleep. The tool reported `running` and the app showed Working.
4. `grokbot__interrupt` returned `interrupted: true`.
5. `grokbot__check` returned `finished`. A subsequent task completed in the
   same conversation. A check after the original delay found no late completion
   reply from the interrupted task.

These observations prove single-controller conversation control. They do not
prove isolation from native-app messages, routines, other BDK hosts, or other
OpenMeld profiles. They are not an OpenMeld product smoke test.

The official extension implements the following wire operations:

| Operation | Public API | Semantics observed in BDK 0.2.24 |
| --- | --- | --- |
| Resolve name | `POST /v0/grokbot/sessions` | Gets or creates a Bot; not a read-only existence check |
| Send | `POST /v0/grokbot/sessions/:id/messages` | Supplies a client `messageId`; validates accepted/duplicate delivery |
| Read | `GET /v0/grokbot/sessions/:id/entries` | Transcript cursor plus conversation-wide busy/idle state |
| Interrupt | `POST /v0/grokbot/sessions/:id/interrupt` | Body contains a reason, with no expected task/turn identity |

A fresh authenticated read against the same existing Bot returned exactly these
top-level fields: `entries`, `latestUpdatedSeq`, `turn`. The turn fields were
`idle`, `inFlight`, and `queued`. Entry fields included `seq`, `updatedSeq`,
`kind`, `role`, `text`, and `createdAtMs`; no task/turn correlation was exposed.
The checked extension also has no conditional turn-stop input. This finding is
bounded to the documented extension and inspected API; it is not proof that the
vendor has no other unpublished capability.

`scripts/research/grok-bot-bdk-probe.mjs` reproduces the read-only wire-shape
observation. It cannot create, message, or interrupt a Bot. It prints field names,
counts, cursor, and busy/idle flags, never transcript text or credentials:

```sh
GROK_BOT_BDK_CREDENTIALS_FILE=/absolute/path/to/bdk/credentials.json \
  node scripts/research/grok-bot-bdk-probe.mjs EXISTING_SESSION_ID KNOWN_CURSOR
node --test scripts/research/grok-bot-bdk-probe.test.mjs
```

Use the credential file produced by an explicitly authorized `bdk login`, not
desktop cookies or private app credentials. The probe uses a fixed official host
and refuses redirects and credentials minted for a different backend.

## Reuse map

| Owner | Existing seam | Required extension |
| --- | --- | --- |
| Agent Profile | Identity, owner, Space membership, Binding | Bind an explicitly verified existing provider identity |
| `config/agents/registry.json` | Controller catalog and capability declarations | Declare shared conversation and provider-managed settings without claiming unsupported capabilities |
| CLI controller definitions and inventory | Installation, auth, interface observations | Official BDK auth and verified connection observations; never infer readiness from app presence |
| Runtime adapter | Dispatch/control and provider events | Carry correlated admission, replies, and terminal evidence |
| Profile Work Coordinator | Serial admission for unsupported independent contexts | Serialize all OpenMeld uses of the same external Bot, not merely one profile |
| RuntimeCoordinator | Concrete Wake lifecycle and final outcome | Retain ownership; provider busy state is evidence, not a second execution authority |
| Dispatch Space tools | Authorized final-action proposal | Establish an explicit provider-delivery contract instead of treating arbitrary transcript text as an authorized action |
| Web and CLI | Shared creation and settings | Capability-based fields and eligibility, with server-side enforcement |

Relevant current source entrypoints include
`clients/openmeld-cli/src/agents/builtin-agent-controller-definitions.ts`,
`clients/openmeld-cli/src/local-service/inventory/agent-controller-interface.ts`,
`runtime/local-service/src/adapters/installers/list-installers.ts`,
`runtime/adapters/core/src/index.ts`, and
`clients/web/src/components/profiles/create-profile-dialog.tsx`.

## Parent-surface decisions

These are proposed acceptance requirements, not implemented behavior:

| Surface | Decision |
| --- | --- |
| Create, reconnect, rebind | Keep shared entrypoints; require verified existing identity and current owner authorization |
| Directory, details, rename, avatar | Keep ordinary Profile identity; local rename must not retarget the external Bot |
| DM and Space membership | Keep shared entrypoints; disclose shared context and provider-owned tools before authorizing shared use |
| Space requiring isolated context | Hide incompatible selection and reject server-side |
| Team Wake and delegation | Keep existing permissions; do not infer access to a member's external account from discoverability |
| Queue and duplicate binding | Serialize by verified provider account/Bot identity across profiles and devices |
| Independent context, fork, model, permission settings | Hide unsupported controls and reject writes server-side |
| Stop | Preserve task-scoped safety; do not silently replace it with stop-whatever-is-current |
| Conversation history | Return only attributable output; do not publish earlier private unread messages into a Space |
| Files, Projects, local working folder | Do not imply local filesystem access for a provider-hosted Bot |
| Offline, lost credentials, failed provider reads | Expose explicit unavailable/unknown evidence and recovery; never fabricate completion |
| Remove Profile or disconnect | Remove OpenMeld association only; do not delete the external Bot |
| Desktop, Web, CLI, agent tools | Consume the same schema and policy, not per-surface provider exceptions |

## Blocker: shared conversation is not task ownership

Consider this valid ordering:

1. OpenMeld sends task A and observes the Bot working.
2. Task A ends; the user starts task B from the native app.
3. OpenMeld's delayed Stop for A calls the conversation interrupt endpoint.
4. Task B is interrupted.

A local lock, a profile queue, an immediate pre-stop GET, a prompt nonce, or a
second busy check cannot make steps 2 and 3 atomic. The same ambiguity can mix
unrelated delivered replies into A's result. The official BDK helper's process
lock serializes calls inside that helper, not all writers to the account's Bot.
Separate caller read cursors also do not isolate the underlying conversation.

This prevents a truthful implementation of the agreed ordinary task-scoped Stop
and result attribution contract. Enterprise telemetry may contain turn IDs, but
telemetry is not a conditional control API and cannot close this race.

The missing evidence is a supported provider contract for attributable accepted
work and conditional stop: for example, a stable turn ID linked to the submitted
message and an interrupt that refuses a different current turn. A documented
exclusive ownership mechanism could be another solution. Neither was established
by this investigation. Do not guess endpoint parameters or use private app APIs.

An explicit conversation-wide control product would have different semantics and
would need a product decision. This draft does not silently make that change.

## Other required acceptance work

- Resolve identity without get-or-create. A stable existing ID can avoid name
  creation, but the product still needs a supported discovery/verification flow.
- Define the single owner for shared-Bot admission across multiple bindings.
- Keep credentials on the chosen carrier and support reconnect/revocation.
- Establish provider-owned tool permission and shared-context authorization;
  adding a Bot to a Space must not pretend to isolate its existing memory.
- Define an explicit final-result bridge through current authorized Space Action
  publication. Native delivered text must not silently bypass this boundary.
- Implement and verify the unified surface matrix only after the execution
  contract is established. A raw BDK CLI test cannot replace this validation.

## Architecture and delivery audit

No production schemas, adapter registration, readiness, state, routing, Service
lifecycle, or UI were changed. Current architecture invariants remain intact.
This is a research probe and Draft evidence, not a partial enabled integration.
No release manifest stamp or local-component release is required for these files.
No user-facing Changelog claim is appropriate before a supported integration
exists. The complete product implementation and real OpenMeld Wake acceptance
remain outstanding; the Draft must not be marked Ready on this evidence.
