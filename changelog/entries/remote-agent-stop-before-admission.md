---
id: remote-agent-stop-before-admission
title: Stop Remote Agent work before it starts
kind: fixed
areas: ["center-agent", "wake"]
audiences: ["users"]
---

Remote Agent now remembers Stop even when the original request has not yet
created an execution record. A late request cannot start model or tool work
under that stopped request's identity. Stop still waits for the existing
execution and cleanup records before reporting that running work has ended.
Pending admission recovery also forwards Stop when the Space already shows a
stopped outcome, so that visible notice does not skip cancellation of a request
whose acknowledgement was lost.
Stopping a parent task also forwards Stop to a pending continuation whose
acknowledgement has not arrived, instead of merely recording the request in Core.
