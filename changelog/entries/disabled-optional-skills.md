---
id: disabled-optional-skills
title: Keep disabled optional Skills from blocking Center Agent
kind: fixed
areas: ["center-agent", "skills"]
audiences: ["agent-users"]
---

If a shared Skill is disabled while a request is waiting to start, Center Agent
can continue without that optional Skill. A Skill explicitly selected for the
request still needs to be available, and OpenMeld explains how to recover when
it is not.
