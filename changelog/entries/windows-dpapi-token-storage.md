---
id: windows-dpapi-token-storage
title: Restore secure Windows CLI sign-in
kind: fixed
areas: ["cli", "authentication"]
audiences: ["users"]
evidence: ["pr:1125"]
---

The Windows CLI now loads the system encryption component before saving or
reading sign-in credentials. Credential-storage failures report a clear reason
and error code without exposing tokens or repeating the same error.
