---- MODULE WakeProgress ----
\* Space wake progress banner for one wake.
\*
\* Code, one signal at a time:
\*   packages/space/src/wake-progress/wake-progress-projection.ts
\*     applyWakeProgressSignals
\*     clearWakeProgressItemsForSignal
\*     mergeWakeProgressItems
\*     shouldReplaceWakeProgressItem
\*     createWakeProgressItem
\*
\* A terminal signal clears the matching row and then a stop or failure notice
\* inserts its own row. A final reply clears the row and inserts nothing.
\* A non-terminal signal is merged. shouldReplaceWakeProgressItem refuses it
\* when the current row is already terminal.
\*
\* Phases are the banner the reader sees, collapsed only where the copy is the
\* same kind of waiting: request_sent, queued, connecting, and retrying are
\* "waiting". running, writing, and publishing are "working".

VARIABLES banner, closed, sawStop
vars == <<banner, closed, sawStop>>

Banners == {
  "nothing",
  "sending",
  "waiting",
  "working",
  "couldnt_confirm",
  "couldnt_reply",
  "stopped",
  "replied"
}

Open == {"nothing", "sending", "waiting", "working"}

Init ==
  /\ banner = "nothing"
  /\ closed = FALSE
  /\ sawStop = FALSE

YouSend ==
  /\ banner = "nothing"
  /\ ~closed
  /\ banner' = "sending"
  /\ UNCHANGED <<closed, sawStop>>

ShowWaiting ==
  /\ ~closed
  /\ banner \in {"nothing", "sending"}
  /\ banner' = "waiting"
  /\ UNCHANGED <<closed, sawStop>>

ShowWorking ==
  /\ ~closed
  /\ banner \in {"nothing", "sending", "waiting"}
  /\ banner' = "working"
  /\ UNCHANGED <<closed, sawStop>>

Retry ==
  /\ ~closed
  /\ banner = "working"
  /\ banner' = "waiting"
  /\ UNCHANGED <<closed, sawStop>>

CouldntConfirm ==
  /\ banner \in {"nothing", "sending", "waiting", "working", "couldnt_reply", "stopped"}
  /\ banner' = "couldnt_confirm"
  /\ closed' = TRUE
  /\ UNCHANGED sawStop

CouldntReply ==
  /\ banner \in {"nothing", "sending", "waiting", "working", "couldnt_confirm", "stopped"}
  /\ banner' = "couldnt_reply"
  /\ closed' = TRUE
  /\ UNCHANGED sawStop

YouStop ==
  /\ banner \in {"nothing", "sending", "waiting", "working", "couldnt_confirm", "couldnt_reply"}
  /\ banner' = "stopped"
  /\ closed' = TRUE
  /\ sawStop' = TRUE

ReplyArrives ==
  /\ banner \in {"sending", "waiting", "working", "couldnt_confirm", "couldnt_reply", "stopped"}
  /\ banner' = "replied"
  /\ closed' = TRUE
  /\ UNCHANGED sawStop

Done ==
  /\ banner = "replied"
  /\ UNCHANGED vars

Next ==
  \/ YouSend
  \/ ShowWaiting
  \/ ShowWorking
  \/ Retry
  \/ CouldntConfirm
  \/ CouldntReply
  \/ YouStop
  \/ ReplyArrives
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ banner \in Banners
  /\ closed \in BOOLEAN
  /\ sawStop \in BOOLEAN

\* A later "sending", "waiting", or "working" update never reopens a closed row.
ClosedRowStaysClosed ==
  closed => banner \notin Open

\* Once the banner says the wake was stopped, a later notice does not show a
\* failure or an unconfirmed reply in its place.
StopIsNotShownAsFailure ==
  ~(sawStop /\ banner \in {"couldnt_reply", "couldnt_confirm"})

\* Once the banner says the wake was stopped, a final reply does not clear it.
StopIsNotClearedByAReply ==
  ~(sawStop /\ banner = "replied")

====
