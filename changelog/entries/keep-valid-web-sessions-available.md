---
id: keep-valid-web-sessions-available
title: Keep valid Web sessions available
kind: fixed
areas: ["authentication", "web"]
audiences: ["members"]
---

OpenMeld Web now keeps a valid signed-in session available when the saved
Organization entry preference is temporarily unavailable or the Auth service
receives simultaneous requests while starting. Authentication errors also
preserve session-cleanup cookies and request IDs, so a stale cookie can be
cleared and the same failure can be traced without trapping someone in a
repeated sign-in error.
