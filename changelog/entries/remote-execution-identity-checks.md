---
id: remote-execution-identity-checks
title: Keep cloud execution controls tied to the correct Agent
kind: fixed
areas: ["center-agent"]
audiences: ["users", "operators"]
---

Cloud execution stop and recovery now check that saved requests belong to the
same Agent and work item before contacting the runtime. Conflicting execution
records produce an explicit diagnostic failure instead of selecting one of the
conflicting conversations. Existing conversation history is preserved.
