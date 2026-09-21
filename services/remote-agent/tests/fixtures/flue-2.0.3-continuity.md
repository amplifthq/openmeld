# Flue 2.0.3 continuity fixture

`flue-2.0.3-continuity.json` is a SQLite snapshot produced by the actual
OpenMeld-patched Flue 2.0.3 runtime, before installing 2.1.0. All content is
synthetic. It contains a recorded tool shortlist, thirteen completed
submissions, one interrupted submission awaiting its provider, one queued
independent submission, and a real format-2 fold checkpoint.

The fixture records the source revision, patch digest, and capture time. Its
schema and rows came from SQLite; they were not invented to fit the new reader.
`flue-version-continuity.test.ts` restores those rows and lets the upgraded
runtime recover the accepted submissions with the same identities. The old
tool is deliberately unavailable, so the test cannot hide a lost result by
executing it again.

To recapture deliberately, use a disposable checkout of the recorded
`openmeldSource` revision with its frozen 2.0.3 installation, copy
`scripts/capture-flue-upgrade-fixture.mjs` there, and run it from the Remote
Agent package. The script rejects other runtime versions and deletes only its
own temporary database. Do not regenerate this historical fixture under 2.1.0
or rewrite its schema to make a failing compatibility test pass.

This synthetic local fixture is not production data or proof of staging
deployment continuity, Computer survival, or hosted rollback.
