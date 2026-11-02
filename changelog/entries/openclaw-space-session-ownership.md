---
id: openclaw-space-session-ownership
title: Keep OpenClaw Space sessions tied to their own Space
kind: fixed
areas: ["cli", "spaces"]
audiences: ["members", "operators"]
---

OpenClaw-backed Spaces now key and recognize their Agent Controller sessions
by a versioned key carrying a lossless encoding of the complete Space id
instead of an eight-character prefix, so a Wake can no longer resume a
different Space's session when two Space ids begin alike, differ only in
separators or letter case, or are short — and a key minted by an earlier
builder can never be mistaken for the current form, whatever its characters
spell. A session stored under an earlier key form is treated as legacy, so
each Space derives its own session key on its next Wake.
