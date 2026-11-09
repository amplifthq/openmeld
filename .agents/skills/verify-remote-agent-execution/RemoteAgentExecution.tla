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

VARIABLES status, stopWon
vars == <<status, stopWon>>

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

YouStopFirst ==
  /\ status = "absent"
  /\ ~stopWon
  /\ stopWon' = TRUE
  /\ UNCHANGED status

Admit ==
  /\ status = "absent"
  /\ ~stopWon
  /\ status' = "pending"
  /\ UNCHANGED stopWon

Progress ==
  /\ status \in {"pending", "running"}
  /\ ~stopWon
  /\ status' = "running"
  /\ UNCHANGED stopWon

YouStop ==
  /\ status \in {"pending", "running"}
  /\ status' = "cancellation_requested"
  /\ stopWon' = TRUE

CompleteSuccess ==
  /\ status \in {"pending", "running"}
  /\ ~stopWon
  /\ status' = "completed"
  /\ UNCHANGED stopWon

CompleteFail ==
  /\ status \in {"pending", "running"}
  /\ ~stopWon
  /\ status' = "failed"
  /\ UNCHANGED stopWon

SettleStop ==
  /\ status = "cancellation_requested"
  /\ status' = "aborted"
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

\* After you stop, the submission is not waiting, working, or a stored reply.
AStopIsNotAReplyOrMoreWork ==
  ~(stopWon /\ status \in {"pending", "running", "completed"})

\* Stopping and stopped are reached only by a stop that won.
StoppedOnlyAfterYouStop ==
  status \in {"cancellation_requested", "aborted"} => stopWon

====
