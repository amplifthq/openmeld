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
starts changing Production. The check uses the current control's verifier and
schema directly in Node.js, without schema or Web builds, package-manager
subprocesses, or the full test suite. Historical recovery does not execute old
validation scripts, and Windows checks do not depend on launching a pnpm shim.
Unrelated PRs keep their existing checks.
