---
id: early-pr-test-feedback
title: Catch affected test failures earlier in pull requests
kind: improved
areas: ["development"]
audiences: ["contributors"]
---

Pull requests, including drafts, run affected checks and unit tests with shared
package consumers included. Documentation-only changes avoid product test
runs, and newer commits cancel superseded feedback. Coding agents can use the
same repository-pinned PostHog test guidance without a separate installation.
