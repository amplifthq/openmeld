# Product Model

## Agent Context

- Purpose: Define the OpenMeld product model: cloud Spaces where Humans and Agent
  Profiles collaborate, with local execution carried through OpenMeld Service.
- Read this when: You need the product-level meaning of OpenMeld, Space, Human
  Profile, Agent Profile, Agent Controller, Wake/Reference addressing, local
  execution, setup, Prepare, readiness, diagnostics, or the main user promise
  before making a product or architecture decision.
- Update this when: The product model, primary user promise, collaboration model,
  or relationship between cloud Spaces and local execution changes.
- Do not use this for: RuntimeCoordinator mechanics, daemon lifecycle details,
  CLI commands, schema details, implementation paths, local development workflow,
  temporary roadmap notes, or migration planning.
- Source of truth: This file owns the durable product-level vocabulary and mental
  model for OpenMeld.

## Product Summary

OpenMeld is a collaboration product for humans and AI teammates. Public copy may
call it an "agentic collaboration loop"; in this owner doc, that maps to the
same durable work loop described below, not a separate architecture concept.

Its core experience is a cloud Space where Humans and Agent Profiles talk,
coordinate, share context, ask an Agent Profile to work, and see the result in
the same Space.

Connected Message Channels are also first-class OpenMeld product entrances. An
internal member of an Organization's connected Slack, Lark, or Feishu workspace
does not need to discover, register for, or sign in to OpenMeld before asking
that Organization's Center Agent to work with ordinary-member Organization
context and Organization-shared capabilities. Linking an OpenMeld account is a
progressive capability upgrade for personal resources, verified role authority,
Local Agents or Computers, and other actions whose owner contract requires a
specific OpenMeld human. It is not a prerequisite for receiving Organization
value in the collaboration tool where work already happens.

For every Message Channel request, authority follows the exact person who made
that request. It does not follow the Channel, thread, person who added the bot,
or most privileged participant nearby. Center Agent may compare an unlinked
internal participant's provider account with current Organization members, but
that comparison grants no authority. Only the intended member's authenticated,
explicit account connection can change a future request into a verified-member
request.

OpenMeld connects that cloud collaboration room to local execution through OpenMeld
Service. The user should experience one reliable collaboration loop, not a set
of unrelated setup, service, routing, and diagnostic systems.

## Primary Product Promise

The durable OpenMeld promise is:

```text
A user can ask an Agent Profile to work from a Space, the correct local execution
path runs, and the Space shows one reply or one explicit failure.
```

Operationally, the product loop is:

```text
Web or CLI Space message
-> Agent Profile Wake
-> Agent Transport routes execution
-> local OpenMeld Service carries local work
-> local agent work
-> Space reply or explicit failure
```

This loop is the product.

Setup, readiness, binding, service status, route state, and diagnostics are
supporting evidence. They matter only because they help the user reach,
understand, or repair the product loop.

## Core Product Objects

A Space is the shared cloud room where collaboration happens. It is both the
origin and destination of agent work: users write messages, share context, ask
Agent Profiles to work, and see final replies or explicit failures there.

A Human Profile is a human teammate identity in OpenMeld. It represents the person
collaborating in Spaces, not a computer, local service, runtime, controller, or
execution target.

Every account has exactly one default Human Profile. The Account Display Name is
the canonical name for that profile: `users.name` and the default Human Profile's
`profileName` are one product value exposed through two read surfaces. Auth owns
one paired mutation that writes both records atomically, whether the rename starts
from Account settings or the default Human Profile API. The same account-owned
default Human Profile is reused across Organizations; Organization membership
must not create another Human Profile.

Manual creation of additional Human Profiles is an Auth-owned product
capability and is disabled by default. Existing non-default Human Profiles
remain readable, usable, renameable, and deletable so this policy does not
rewrite identity or Space history. Agent Profile creation remains available and
unrestricted by this capability.

An Agent Profile is the AI teammate identity users collaborate with. It owns
product identity and collaboration meaning: name, instructions, persona,
continuity, and Space membership meaning.

An Agent Profile is not the local process that runs work. It is not OpenMeld Service,
a controller binary, a runtime, or a computer.

An Agent Controller is the local agent tool that performs the work an Agent
Profile is asked to do, such as Claude Code, Codex, Cursor, or OpenCode. It is execution
infrastructure, not identity: an Agent Profile can be bound to an Agent
Controller for execution, while the profile's name, instructions, and
continuity stay independent of which controller runs it.

Readiness may appear on Agent Profile surfaces, but Agent Profile identity does
not own readiness truth. Readiness is a product claim about whether this Agent
Profile can reply through the current transport path. Final user-facing
readiness comes from the transport-owned readiness projection; no single factor
— route online, Binding existence, completed Prepare, or local process health —
is enough alone.

OpenMeld Service is the local execution carrier and trust boundary between OpenMeld cloud
collaboration and work performed on the user's computer.

OpenMeld Service makes local agent work possible for the intended account, computer,
lane, and Agent Profile. It carries execution; it does not own Space truth,
Agent Profile identity, final readiness truth, or the visible Space outcome.

Space Message Addressing is how a Space message names other members: Wake and
Reference. Wake is the only addressing relation that dispatches executable
work; Reference shares context without asking for execution or requiring a
reply.
Publication Mode governs how much of a local agent's working output becomes
visible in the Space. Both are owned in detail by
`developing/product/space-collaboration.md`.

## Agent Transport

Agent Transport is the product loop that connects Space collaboration to local
execution and back to a visible Space outcome.

At the product level, Agent Transport answers:

```text
Can this Space request reach the right local agent and return one visible reply
or one explicit failure?
```

This document owns only that product meaning. Execution authority (owned in
production by RuntimeCoordinator), dispatch, lifecycle, retry, timeout, token,
and trace details belong in the transport architecture contract.

## Supporting Evidence

Setup and repair exist to align the product loop. Prepare is the product step
that makes one computer ready to carry local agent work for the intended
account and lane; completed Prepare is supporting evidence, not readiness
truth.

They must not report success merely because a local process is running, a tool
was detected, or a partial connection exists. They support the product only when
the relevant account, computer, lane, OpenMeld Service, local agent capability, and
Agent Profile are aligned enough for the promised reply path.

Readiness exists to express whether the product loop can likely work now.

The user-facing question is:

```text
Can this Agent Profile reply from this computer in this Space right now?
```

If a status cannot answer that question, it is diagnostic evidence, not product
readiness.

Diagnostics exist to explain the loop when it fails. They should help users or
operators understand where the chain broke, without replacing clear product copy
or exposing internal terms as the primary user experience. Diagnostic Reports
and trace surfaces carry that evidence and are owned by the observability
layer.

## Owner Boundaries

Keep this document high-level. Use scoped owner documents for detailed rules:
`developing/product/agent-profiles.md` (including Agent Controller Permission
Mode on the Binding surface),
`developing/product/space-collaboration.md`,
`developing/product/onboarding.md`,
`developing/product/agent-model-selection.md`,
`developing/architecture/agent-transport-contract.md`,
`developing/architecture/local-openmeld-service.md`, and
`developing/architecture/data-and-observability.md`.
Stable repository vocabulary lives in `developing/glossary.md`.

Client responsibilities belong in `developing/clients/`. Development and
validation workflow belongs in `developing/engineering/`.

## Product Invariants

- OpenMeld is reliable Space-to-local-agent-to-Space collaboration.
- A user request for agent work should produce one visible reply or one explicit
  visible failure.
- Setup, readiness, repair, service status, and diagnostics are supporting
  evidence, not the product itself.
- An Agent Profile is an AI teammate identity, not local execution truth.
- Agent Profile identity does not own readiness truth.
- OpenMeld Service is the local execution carrier and trust boundary, not product
  identity or final readiness truth.
- A setup or repair flow must not report success before the promised reply path
  is aligned.
- User-facing status must use clear product language and show the next action.
