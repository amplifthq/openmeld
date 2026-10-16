---
id: fork-ci-isolation
title: Run contributor checks without production credentials
kind: fixed
areas: ["development"]
audiences: ["developers"]
---

Fork pull requests run validation with read-only GitHub permissions. A separate
trusted workflow checks the exact commit and test evidence before reporting the
final result. Pull request approvals and production release controls stay separate.
CodeQL security scans also run on fork pull requests, so external contributors
can complete the required checks.
