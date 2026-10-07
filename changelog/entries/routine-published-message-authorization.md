---
id: routine-published-message-authorization
title: Check message access before exposing Routine publication references
kind: fixed
areas: ["routines"]
audiences: ["users"]
---

Routine diagnostics now verify that a published message still exists and is
readable before returning its reference. Deleted or expired messages no longer
expose a message ID; the historical record that publication occurred is retained.
