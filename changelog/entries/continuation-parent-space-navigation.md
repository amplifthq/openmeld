---
id: continuation-parent-space-navigation
title: Keep follow-up work linked to the original conversation
publishedAt: 2026-10-02
release: v0.3.236
evidence: ["pr:1443","commit:7eba5b84b75cd655b508a8f3cf5959281a11eab3","workflow:37023562187","workflow:37025217534"]
kind: fixed
areas: ["spaces", "center-agent"]
audiences: ["members"]
---

When an Agent resumes after a delegated task finishes in another Space, its
activity link stays with the original request. The conversation can also show
the ongoing work before that request's older messages have loaded.
