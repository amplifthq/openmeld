---- MODULE RemoteAgentExecution ----
\* Remote Agent native execution for one submission.
\*
\* Code, one successful compare-and-set in:
\*   services/remote-agent/agent-core/execution-state.ts
\*     initializeRemoteAgentExecutionState
\*     markRemoteAgentExecutionProgress
\*     requestRemoteAgentExecutionCancellation
\*     completeRemoteAgentExecutionState
\*     resolveSettledExecutionStatus
\*
\* A stop intent written before the row exists makes initialization throw.
\* Progress does not leave cancellation_requested. Completion of a
\* cancellation_requested row settles aborted, including when the caller
\* asked to store a successful answer.
\*
\* Left out: repairRemoteAgentCompletedExecutionWithoutAnswer, which turns a
\* completed row that has no stored answer into failed.

VARIABLES status, stopWon, hasAnswer
vars == <<status, stopWon, hasAnswer>>

Statuses == {
  "absent",
  "pending",
  "running",
  "cancellation_requested",
  "completed",
  "failed",
  "aborted"
}

Init ==
  /\ status = "absent"
  /\ stopWon = FALSE
  /\ hasAnswer = FALSE

YouStopFirst ==
  /\ status = "absent"
  /\ ~stopWon
  /\ stopWon' = TRUE
  /\ UNCHANGED <<status, hasAnswer>>

Admit ==
  /\ status = "absent"
  /\ ~stopWon
  /\ status' = "pending"
  /\ UNCHANGED <<stopWon, hasAnswer>>

Progress ==
  /\ status \in {"pending", "running"}
  /\ ~stopWon
  /\ status' = "running"
  /\ UNCHANGED <<stopWon, hasAnswer>>

YouStop ==
  /\ status \in {"pending", "running"}
  /\ status' = "cancellation_requested"
  /\ stopWon' = TRUE
  /\ UNCHANGED hasAnswer

CompleteSuccess ==
  /\ status \in {"pending", "running"}
  /\ ~stopWon
  /\ status' = "completed"
  /\ hasAnswer' = TRUE
  /\ UNCHANGED stopWon

CompleteFail ==
  /\ status \in {"pending", "running"}
  /\ ~stopWon
  /\ status' = "failed"
  /\ UNCHANGED <<stopWon, hasAnswer>>

SettleStop ==
  /\ status = "cancellation_requested"
  /\ status' = "aborted"
  /\ hasAnswer' = FALSE
  /\ UNCHANGED stopWon

Done ==
  /\ \/ status \in {"completed", "failed", "aborted"}
     \/ (status = "absent" /\ stopWon)
  /\ UNCHANGED vars

Next ==
  \/ YouStopFirst
  \/ Admit
  \/ Progress
  \/ YouStop
  \/ CompleteSuccess
  \/ CompleteFail
  \/ SettleStop
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ status \in Statuses
  /\ stopWon \in BOOLEAN
  /\ hasAnswer \in BOOLEAN

\* After you stop, the submission is not waiting, working, or a stored reply.
AStopIsNotAReplyOrMoreWork ==
  stopWon => (~hasAnswer /\ status \notin {"pending", "running", "completed"})

\* Stopping and stopped are reached only by a stop that won.
StoppedOnlyAfterYouStop ==
  status \in {"cancellation_requested", "aborted"} => stopWon

====
