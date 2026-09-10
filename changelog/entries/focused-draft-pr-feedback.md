---
id: focused-draft-pr-feedback
title: Focused draft feedback with required validation before merge
kind: improved
areas: ["development"]
audiences: ["contributors"]
---

Draft pull requests receive focused code and test feedback while work is still
changing. Marking a pull request ready starts the affected checks required
before merge, with broader integration coverage for shared and runtime changes.
Unchanged trusted test inputs can reuse earlier results, while missing or
failed checks continue to block the final validation status.

Local validation starts from an isolated current-main snapshot, avoiding a full
history download while retaining the candidate's complete history and identity
checks.
