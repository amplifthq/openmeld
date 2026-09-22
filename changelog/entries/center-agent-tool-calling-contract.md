---
id: center-agent-tool-calling-contract
title: Keep Center Agent tool instructions consistent
kind: fixed
areas: ["center-agent"]
audiences: ["members"]
---

Fixes conflicting tool instructions that could make Center Agent promise to
start work without executing it, or display malformed tool-call text. Existing
conversations retain their history while using the current authorized tools.
