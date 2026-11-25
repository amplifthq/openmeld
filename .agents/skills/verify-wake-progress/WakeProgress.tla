---- MODULE WakeProgress ----
\* Web presentation for one viewer, Space, and dispatch. Space owns publication.
\* recordSpaceWakeProgressEvidence retains the first matching publication.
\* setSpaceWakeProgressPresentationItems filters each subsequent progress write.
VARIABLES publication, row
vars == <<publication, row>>

Outcomes == {"reply", "stop", "failure"}
Progress == {"waiting", "working"}

Init ==
  /\ publication = "none"
  /\ row = "hidden"

\* A candidate row can arrive even after a final reply removed the old row.
ReceiveProgress(candidate) ==
  /\ row' = IF publication = "none" THEN candidate ELSE "hidden"
  /\ UNCHANGED publication

ObservePublication(kind) ==
  /\ publication' = IF publication = "none" THEN kind ELSE publication
  /\ row' = "hidden"

Next ==
  \/ \E candidate \in Progress : ReceiveProgress(candidate)
  \/ \E kind \in Outcomes : ObservePublication(kind)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ publication \in Outcomes \cup {"none"}
  /\ row \in Progress \cup {"hidden"}

PublishedProgressStaysHidden == publication \in Outcomes => row = "hidden"
FirstPublicationSticks == [][(publication \in Outcomes) => (publication' = publication)]_vars

====
