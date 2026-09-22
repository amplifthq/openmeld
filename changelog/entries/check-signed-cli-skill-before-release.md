---
id: check-signed-cli-skill-before-release
title: Catch unsigned CLI guide changes before release
kind: fixed
areas: ["engineering", "ci"]
audiences: ["contributors"]
---

Changes to the official CLI guide and its signed artifacts now run the existing
signature and source consistency check during PR validation and Final Candidate.
Release preflight also catches stale guide revisions before a delivery train
starts changing Production. The check reuses cached schema builds and does not
build Web or run the full test suite; unrelated PRs keep their existing checks.
