# Core dependency watch

## Agent Context

- Purpose: Find newer stable releases of a small explicit set of core dependencies.
- Read this when: Reviewing scheduled dependency reports or changing the watchlist.
- Update this when: Scan cadence, report ownership or version-selection rules change.
- Do not use this for: Security advisories, compatibility approval or automatic upgrades.
- Source of truth: `packages.json` owns scope; workspace importers in `pnpm-lock.yaml` own installed versions.

The workflow scans every Tuesday and Friday at approximately 02:41 UTC
(10:41 Asia/Taipei), with alternating three- and four-day gaps. Manual dispatch
scans immediately. GitHub schedules can be delayed or skipped; this is a
maintenance reminder, not an exact-time guarantee.
Schedules become active only after the workflow reaches the default branch.

The scan compares actual direct resolutions, including multiple workspace
versions, with npm's stable `latest` tag. It does not scan every transitive
package or use prereleases. A failed registry request, missing watched package,
or unsupported lockfile/version format fails the run without changing the issue.

One bot-owned issue contains the pending upgrade list, affected workspaces,
major/minor/patch changes and review notes. A registered pnpm patch is flagged.
The issue changes only when its content changes. Closing it acknowledges the
current snapshot; a changed list can reopen it. Once no updates remain, the bot
closes an open report. No duplicate comments, dependency edits, merges or releases
are made. Existing dependency security alerts remain separate.

The workflow uses only repository read and issue write permissions. Dependency
installation uses the frozen lockfile with lifecycle scripts disabled. The scan
reads public npm metadata and never downloads or executes candidate releases.

Local verification (read-only; no issue publication):

```sh
node --test scripts/dependency-watch/scan.test.mjs
node scripts/dependency-watch/scan.mjs
```

The report is written to `dev-tmp/core-dependency-watch/report.md` and
`updates.json`. Only the main-branch workflow passes `--publish`.
