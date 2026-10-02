---
id: remote-agent-rolling-upgrade-compatibility
title: Keep Remote Agent work running during service upgrades
kind: fixed
areas: ["remote-agent", "releases", "ai-usage"]
audiences: ["users", "operators"]
---

Release checks require Core to upgrade before Remote Agent, keeping ongoing
work compatible during the transition. New model calls stop if usage admission
is unavailable, so upgrades cannot bypass an Organization's allowance. Existing
usage records remain available for delivery without repeating model calls.
