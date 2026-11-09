---- MODULE RuntimeCoordinatorLiveness ----
\* One workstation Wake after RuntimeCoordinator has accepted it.
\*
\* Code:
\*   services/core/src/runtime-transport/application/runtime-coordinator-authority.ts
\*     hasRuntimeCoordinatorLocalProgressStaleTerminalExpired
\*     RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS (5 minutes)
\*     RUNTIME_COORDINATOR_COMMUNICATION_RECOVERY_WINDOW_MS (30 minutes)
\*     settleRuntimeCoordinatorAuthorityForTerminalDecision
\*     settleRuntimeCoordinatorAuthorityForCancellationAccepted
\*   services/core/src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo.ts
\*     LOCKED_TERMINAL_STATUSES (reply_published, cancelled, failed_terminal)
\*
\* quiet is how many 5-minute ticks have passed since the last accepted local
\* progress. recovery means communicationRecoveryBaselineAtMs is that same
\* progress, so the stale window is 30 minutes. asking means an unanswered
\* agent question is open; the stale predicate returns false while it is.
\* A terminal outcome is written once. The first of reply, stop, or failure
\* sticks.
\*
\* Left out: pre-accept redelivery, token mismatch, and failed_retryable.

EXTENDS Naturals

VARIABLES phase, quiet, recovery, asking, outcome
vars == <<phase, quiet, recovery, asking, outcome>>

Phases == {"waiting", "working", "replied", "stopped", "failed"}
Outcomes == {"", "replied", "stopped", "failed"}
MaxQuiet == 6

Limit == IF recovery THEN MaxQuiet ELSE 1

Init ==
  /\ phase = "waiting"
  /\ quiet = 0
  /\ recovery = FALSE
  /\ asking = FALSE
  /\ outcome = ""

Accept ==
  /\ phase = "waiting"
  /\ outcome = ""
  /\ phase' = "working"
  /\ quiet' = 0
  /\ recovery' = FALSE
  /\ asking' = FALSE
  /\ UNCHANGED outcome

ReportProgress ==
  /\ phase = "working"
  /\ outcome = ""
  /\ quiet' = 0
  /\ recovery' = FALSE
  /\ UNCHANGED <<phase, asking, outcome>>

TimePasses ==
  /\ phase = "working"
  /\ outcome = ""
  /\ quiet < MaxQuiet
  /\ quiet' = quiet + 1
  /\ UNCHANGED <<phase, recovery, asking, outcome>>

ComputerDrops ==
  /\ phase = "working"
  /\ outcome = ""
  /\ ~recovery
  /\ recovery' = TRUE
  /\ UNCHANGED <<phase, quiet, asking, outcome>>

Watchdog ==
  /\ phase = "working"
  /\ outcome = ""
  /\ ~asking
  /\ quiet >= Limit
  /\ phase' = "failed"
  /\ outcome' = "failed"
  /\ UNCHANGED <<quiet, recovery, asking>>

YouStop ==
  /\ phase \in {"waiting", "working"}
  /\ outcome = ""
  /\ phase' = "stopped"
  /\ outcome' = "stopped"
  /\ UNCHANGED <<quiet, recovery, asking>>

Reply ==
  /\ phase = "working"
  /\ outcome = ""
  /\ phase' = "replied"
  /\ outcome' = "replied"
  /\ UNCHANGED <<quiet, recovery, asking>>

AgentAsks ==
  /\ phase = "working"
  /\ outcome = ""
  /\ ~asking
  /\ asking' = TRUE
  /\ UNCHANGED <<phase, quiet, recovery, outcome>>

YouAnswer ==
  /\ phase = "working"
  /\ asking
  /\ outcome = ""
  /\ asking' = FALSE
  /\ quiet' = 0
  /\ recovery' = FALSE
  /\ UNCHANGED <<phase, outcome>>

Done ==
  /\ outcome \in {"replied", "stopped", "failed"}
  /\ UNCHANGED vars

Next ==
  \/ Accept
  \/ ReportProgress
  \/ TimePasses
  \/ ComputerDrops
  \/ Watchdog
  \/ YouStop
  \/ Reply
  \/ AgentAsks
  \/ YouAnswer
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in Phases
  /\ quiet \in 0..MaxQuiet
  /\ recovery \in BOOLEAN
  /\ asking \in BOOLEAN
  /\ outcome \in Outcomes

\* The 5-minute or 30-minute stale watchdog is the only way to "failed",
\* and it does not fire while progress is inside the window or a question
\* is waiting for the user.
FreshProgressIsNotAFailure ==
  phase /= "failed"
    \/ (~asking /\ quiet >= (IF recovery THEN MaxQuiet ELSE 1))

\* The first terminal outcome is the only one.
OneOutcome ==
  outcome = "" \/ outcome = phase

====
