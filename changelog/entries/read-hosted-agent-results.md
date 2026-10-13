---
id: read-hosted-agent-results
title: Read hosted Agent results with the same CLI command
kind: fixed
areas: ["cli", "agents", "spaces"]
audiences: ["users", "developers"]
---

`openmeld space result --dispatch` can read a hosted Agent's published reply
without a local execution archive. It returns the original message and clearly
distinguishes a reply, failure notice, or stopped task. Existing archived results
and `--result-ref` keep their previous behavior.
