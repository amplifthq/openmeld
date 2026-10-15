---
id: website-guide-redirect-release-health
title: Accept permanent guide redirects in Website release checks
kind: fixed
areas: ["website", "releases"]
audiences: ["operators"]
publishedAt: 2026-10-14
evidence: ["pr:1732", "workflow:38591154751"]
---

Website release checks now accept the permanent redirects from legacy local-agent
guide URLs to their exact Docs pages. They still verify the Website deployment's
source and build identity on its rendered pages.
