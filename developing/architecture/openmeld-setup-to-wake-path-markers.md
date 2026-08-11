# OpenMeld Setup To Wake Path Markers

## Agent Context

- Purpose: Record Phase 1 `OPENMELD_SETUP_TO_WAKE_PATH` marker meanings for setup to
  Wake path follow-up work.
- Read this when: You are investigating existing `OPENMELD_SETUP_TO_WAKE_PATH`
  markers or planning the next cleanup pass for setup-to-Wake facts.
- Update this when: Marker names, marker meanings, or the highlighted
  setup-to-Wake marker path changes.
- Do not use this for: Product contracts, architecture authority, AGENTS.md
  routing, implementation tutorials, migration plans, or final setup/readiness
  semantics.
- Source of truth: This file owns only the temporary marker vocabulary used by
  the Phase 1 setup-to-Wake path notes.

This is a Phase 1 marker note. It is not a replacement architecture manual and
does not change the product contract.

Marker prefix:

```text
OPENMELD_SETUP_TO_WAKE_PATH
```

Marker kinds:

```text
RECOMMENDED_ENTRY
HIGHEST_FACT
GAP
```

`RECOMMENDED_ENTRY` marks a convenient product surface. It is not the
canonical start of the system. The real path starts when a human or agent runs
the setup command locally.

`HIGHEST_FACT` marks the fact node Phase 2 should route real data through. It
does not mean the current implementation is already clean or complete.

`GAP` marks a missing or misnamed piece that belongs on this path. Phase 1 does
not fix it; Phase 2 should.

Highlighted path:

```text
Web private prompt / generated command
-> shared local setup command entry
-> local auth from one-time token
-> setup session attachment
-> service session identity
-> runtime agent controller report
-> default human profile
-> user-confirmed Agent Profile
-> Agent Profile Binding
-> Space creation or selection
-> Space membership
-> RuntimeCoordinator Wake execution head
-> OpenMeld Service local execution
-> dispatch-scoped Space Action
-> RuntimeCoordinator finalization
-> visible Space outcome
```

Important product constraints:

```text
Humans and agents must be able to use the same command path.
Web Agent Interface is the recommended entry, not the only entry.
The user may enter the Space UI, ask the Setup Agent to continue, or start a new session.
Runtime discovery must not auto-create Agent Profiles.
Only the default human profile may be automatically ensured.
Agent Profiles come from user intent or user-approved Setup Agent guidance.
Do not introduce new table requirements in Phase 1.
Do not use "Ready" as a new product term.
Use explicit terms such as detected local agents, reported capabilities, added
to Space, available for Wake, or blocked from Wake at the layer that actually
owns that fact. Setup owns detected/reported local capability facts, not final
Wake availability.
```
