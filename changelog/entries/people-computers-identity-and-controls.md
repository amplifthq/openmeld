---
id: people-computers-identity-and-controls
title: Clearer computer status and precise computer controls
kind: fixed
areas: ["computers", "agents", "center-agent", "cli"]
audiences: ["users", "developers"]
---

Computer status distinguishes a live connection, a normal disconnection, and a
status that could not be checked. Saved computer records no longer count as proof
that a local agent can run.

Computer settings and CLI diagnostics target the selected computer and
environment. The Center Agent looks up the requesting teammate's local agents
instead of assuming the Organization owner's computer is the target.

CLI integrations must update for the new `computer list --view agent` payload:
`computers` includes explicit connection evidence and `isThisComputer` identifies
the local installation. This replaces the old routing-preference interpretation.
