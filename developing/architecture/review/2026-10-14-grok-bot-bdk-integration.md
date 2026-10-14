# Existing Grok Bot integration through BDK

## Agent Context

- Purpose: Record provider evidence and acceptance boundaries for the initial Grok Bot integration.
- Read this when: Reviewing or validating the Grok Bot connection PR.
- Update this when: Acceptance evidence or the reviewed contract changes.
- Do not use this for: Production delivery claims or general Agent Profile semantics.
- Source of truth: The cited provider contract and recorded real-user validation own this review evidence.

Remove this review document after the integration is delivered and its lasting contract is covered by the Agent Profile owner documentation.

Status: Draft implementation. The owner accepted shared-conversation semantics.
This is not an isolated provider turn and is not a deployment claim.

## Provider evidence

Official sources inspected on 2026-10-14:

- [Grok Bot agents extension](https://cursor.com/docs/bdk/guides/grokbot-agents)
- [BDK CLI](https://cursor.com/docs/bdk/reference/cli)
- Published `@cursor/bdk` 0.2.24, especially the extension backend and
  conversation modules.

The authorized real test used an existing personal Bot. Sending a message,
reading its delivered reply, interrupting ongoing work, waiting for idle, and
sending a subsequent message worked in the same native conversation. The new
OpenMeld adapter also returned the exact verification reply and returned
`runtime.turn.cancelled` only after the provider settled following Stop.
The isolated OpenMeld Web smoke subsequently created a normal Agent Profile,
received `OPENMELD_TALI_PROFILE_OK` in its DM, used the existing Stop button,
observed `(Request stopped)`, and received `OPENMELD_TALI_AFTER_STOP_OK` on the
next message. No connection Dialog appeared during these messages.

Follow-up acceptance on the isolated PostgreSQL lane, after merging main
`4be1efd25`, used the development Doppler smoke key through AI usage settings.
The UI confirmed BYOK. Center Agent returned a three-item launch checklist and
Tali returned a calculation and safety check in the same Space, each attached to
its originating message. New message selected Tali and opened its existing DM.
Stop reached a persisted `visible_stopped` outcome, then the same conversation
returned `NEW_MESSAGE_AFTER_STOP_OK`.

New Agent creation returned immediately to the picker with pending progress.
The user could select another Agent while it completed. The created Codex
Profile appeared selected at the top, and both Agents joined a newly created
Space. Selected rows retained keyboard focus when moving into or out of the
top group. These checks use product UI and real providers, not mock replies.
Screenshots are local acceptance artifacts; they are not publication evidence.

| Operation | Official API used by BDK | Scope |
| --- | --- | --- |
| Resolve name | `POST /v0/grokbot/sessions` | Get or create; deliberately not used |
| Read | `GET /v0/grokbot/sessions/:id/entries` | Cursor and conversation-wide busy/idle state |
| Send | `POST /v0/grokbot/sessions/:id/messages` | Client message ID, accepted or duplicate receipt |
| Stop | `POST /v0/grokbot/sessions/:id/interrupt` | Whole current conversation |

Read responses contain `entries`, `latestUpdatedSeq`, and `turn`. Turn fields
are `idle`, `inFlight`, and `queued`. No reliable task-specific reply attribution
or conditional turn-stop input was found. Native-app messages and routines can
share the same work. This is an accepted product boundary, not a pending request
for a second user decision.

`scripts/research/grok-bot-bdk-probe.mjs` is a read-only, fixed-host reproduction
that prints field names/counts rather than transcript text or credentials. Its
sanitized capture supplies the adapter contract test shape. Credentials stay
outside the repository and come from the previously authorized `bdk login`.

## Ownership and reuse

The connection uses an ordinary Agent Profile, Core Binding, local Service,
RuntimeCoordinator, and dispatch-owned reply writer. The new optional
`account_shared` conversation capability selects the connection fields and
one-time Dialog. The Profile stores the exact existing conversation ID through
its Binding. No native Bot or separate OpenMeld Bot object is created.

| Parent surface | Decision |
| --- | --- |
| Profile identity, rename, ownership, membership | Keep existing behavior |
| DM, Space Wake, queue, Stop, trace | Keep shared execution path |
| Connection | Existing ID and explicit shared-control acknowledgment |
| Model, reasoning, permissions, tools, workspace | Provider-owned; hide creation controls and reject configuration |
| Activity resume/import, fork, independent contexts | Unsupported; reject |
| Delivery-only repair | Reject; never repeat business work automatically |
| Old history and internal reasoning | Never publish |
| New delivered replies | Propose through the authorized dispatch reply action |
| Concurrent native-app work | Shared; no task-isolation promise |

The short Dialog says: "Shares your Grok Bot conversation. Stopping here stops
the bot’s current work." Buttons are **Connect bot** and **Cancel**. Ordinary
messages do not repeat it.

## Contract impact audit

Changes are additive to creation configuration and Binding requests, with a new
controller capability and adapter. Existing controllers retain their contracts.
Old local Services cannot advertise Grok Bot; selecting it requires a new
Service inventory. Existing setup, Wake, action, trace and repair commands stay
compatible. Old Core does not understand shared connection acknowledgment, so
Core/Gateway receivers must be present before exposing the new Web/CLI creation
flow. A mixed-version connection failure must stay explicit; it must never
silently connect a fresh Bot. No database migration is required because creation
configuration is already stored as JSON and Binding already owns native IDs.

Local component changes should be stamped available: existing controller work
does not require a forced update. The feature requires the new Service for its
new controller. RuntimeCoordinator remains execution authority. Provider status
is evidence, and an interrupt receipt is not a terminal outcome.

## Verification boundary

- Read-only provider probe: passed.
- New adapter real send/read and stop/settle against the existing Bot: passed.
- Focused adapter tests cover history exclusion, delivered replies, busy refusal,
  missing identity, repair rejection and stop-before-settlement behavior.
- Shared creation schema rejects missing acknowledgment and provider-owned
  settings; existing Binding and creation tests pass.
- Chrome user-entry smoke: normal creation, one-time Dialog, DM reply, Stop,
  and subsequent reply passed in isolated lane `wt-78fe822d8c58`.
- Successful reply dispatch: `c3372a02-2463-48b6-a4c3-a9358321e2b3`.
  Stop dispatch: `75e86d87-e23c-43ee-8178-2e0a3f74a563`; Service returned
  `runtime.turn.cancelled` after provider settlement and the UI showed stopped.
  Supported `openmeld-dev service trace` reported `visible_reply` and
  `visible_stopped`, respectively, with `next_action=none`.
- The smoke caught and corrected preparation/continuation declarations. BDK
  requires no provider workspace preparation and uses standard continuation.
- Core typecheck has an unchanged base error in
  `space-signal-service.test.ts:1506` (an object used as a computed key).
  This is not a passing Core typecheck claim.
- Packaged release readiness and final candidate status are recorded in the PR.
  This remains a Draft, without merge or deployment.
