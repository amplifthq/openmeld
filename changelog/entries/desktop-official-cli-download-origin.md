---
id: desktop-official-cli-download-origin
title: Update local tools from Desktop after the App domain move
kind: fixed
areas: ["desktop", "computers"]
audiences: ["users"]
publishedAt: 2026-10-17
evidence: ["pr:222", "commit:abd564aba7c9333ca84da4a4eb0925c181269e2b", "desktop-candidate:58682f1bf10aa0b62f01b178f5e6eb0fdbef28c7dba4f7446cdf39e2bc8c5237", "https://github.com/amplifthq/openmeld/pull/222#issuecomment-6223773790"]
---

Desktop 0.1.38 uses the official CLI download address when connecting or updating this
computer. The move to app.openmeld.ai no longer causes Desktop to reject the
official installation package. Download integrity and signing checks remain
required.
