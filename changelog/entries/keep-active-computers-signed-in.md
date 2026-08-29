---
id: keep-active-computers-signed-in
title: Keep active Computers signed in
kind: fixed
areas: ["authentication", "cli", "computers"]
audiences: ["members"]
---

Active OpenMeld CLI and Computer connections now save the server's renewed
sign-in expiration instead of stopping at the original seven-day date. A
temporary sign-in status failure also no longer prevents the existing
credential from reaching the service that can authoritatively accept or reject
it.
