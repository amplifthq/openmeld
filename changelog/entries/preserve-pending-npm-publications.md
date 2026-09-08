---
id: preserve-pending-npm-publications
title: Resume releases while npm finishes processing
kind: fixed
areas: ["releases"]
audiences: ["operators", "contributors"]
---

CLI releases wait longer for npm to make a submitted version available and
distinguish pending verification from a failed upload. Recovery preserves the
original submission across runners instead of publishing again when npm
temporarily returns a missing version. Completed release stages stay intact.
