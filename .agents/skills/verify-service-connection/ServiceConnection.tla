---- MODULE ServiceConnection ----
\* Local OpenMeld Service cloud-connection loop for one process.
\*
\* Code:
\*   clients/openmeld-cli/src/local-service/state/service-connection-state.ts
\*     createServiceConnectionStateTracker starts at "starting"
\*     toHealthProjection
\*   clients/openmeld-cli/src/local-service/carrier/service-runner.ts
\*     the run loop sets "connecting", then "online" only after a heartbeat
\*     noteAuthenticationRequiredState
\*     noteReconnectFailureState
\*     markStopping sets "stopping" and stopRequested ends the loop
\*
\* One step is one connection-state write in that loop, or the health read
\* that reports "stopping" while the process is draining.
\* "sign_in_unavailable" is degraded reason auth_unavailable. It is not the
\* authentication_required state.

VARIABLES phase, quit
vars == <<phase, quit>>

Phases == {
  "starting",
  "connecting",
  "connected",
  "sign_in",
  "sign_in_unavailable",
  "reconnecting_network",
  "reconnecting_internal",
  "stopping"
}

Init ==
  /\ phase = "starting"
  /\ quit = FALSE

BeginConnect ==
  /\ ~quit
  /\ phase \in {
       "starting",
       "sign_in",
       "sign_in_unavailable",
       "reconnecting_network",
       "reconnecting_internal"
     }
  /\ phase' = "connecting"
  /\ UNCHANGED quit

Heartbeat ==
  /\ ~quit
  /\ phase = "connecting"
  /\ phase' = "connected"
  /\ UNCHANGED quit

NeedSignIn ==
  /\ ~quit
  /\ phase \in {"connecting", "connected"}
  /\ phase' = "sign_in"
  /\ UNCHANGED quit

CredentialsUnusable ==
  /\ ~quit
  /\ phase = "connecting"
  /\ phase' = "sign_in_unavailable"
  /\ UNCHANGED quit

NetworkDrops ==
  /\ ~quit
  /\ phase \in {"connecting", "connected"}
  /\ phase' = "reconnecting_network"
  /\ UNCHANGED quit

InternalFailure ==
  /\ ~quit
  /\ phase \in {"connecting", "connected"}
  /\ phase' = "reconnecting_internal"
  /\ UNCHANGED quit

YouQuit ==
  /\ ~quit
  /\ phase' = "stopping"
  /\ quit' = TRUE

Done ==
  /\ phase = "stopping"
  /\ UNCHANGED vars

Next ==
  \/ BeginConnect
  \/ Heartbeat
  \/ NeedSignIn
  \/ CredentialsUnusable
  \/ NetworkDrops
  \/ InternalFailure
  \/ YouQuit
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in Phases
  /\ quit \in BOOLEAN

\* markStopping sets stopRequested. The run loop does not open another session.
NoReconnectAfterQuit ==
  quit => phase = "stopping"

\* toHealthProjection says ok only for "online", idle only for "stopping",
\* and authentication_required keeps its own reason code.
Health ==
  IF phase = "connected" THEN "ready"
  ELSE IF phase = "stopping" THEN "idle"
  ELSE IF phase = "sign_in" THEN "sign_in"
  ELSE "trouble"

ShownHonestly ==
  /\ (phase = "connected") <=> (Health = "ready")
  /\ (phase = "stopping") => (Health = "idle")
  /\ (phase = "sign_in") => (Health = "sign_in")
  /\ (phase = "sign_in_unavailable") => (Health = "trouble")

====
