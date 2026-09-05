---
id: space-profile-recency-scope
title: Clarify Space activity times and historical profiles
kind: fixed
areas: ["people", "spaces", "web"]
audiences: ["users"]
publishedAt: 2026-09-05
evidence: ["pr:668", "commit:c1ee150e627e974dbb541cd6b8c3db6b673ce73f", "workflow:33953073945"]
---

Space member lists and profile popovers now say "Here 2d ago" to distinguish
activity in that Space from activity elsewhere in the app. Live status is
unchanged.

Profiles opened from older messages stay compact when current member details
are unavailable, without falling back to a table of technical IDs or implying
an online status.
