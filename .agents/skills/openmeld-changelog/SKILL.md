---
name: openmeld-changelog
description: Maintain the official OpenMeld Changelog from repository evidence. Use when deciding whether a change needs a Changelog entry, writing or publishing an entry, preparing release notes, validating generated Changelog files, or historically backfilling missing changes.
---

# OpenMeld Changelog

Keep `changelog/entries/*.md` as the human- and agent-authored source of truth.
Treat `CHANGELOG.md`, `changelog/index.json`, and `changelog/releases/*.md` as
generated projections. Read `developing/engineering/changelog.md` before
editing either source or projections.

## Choose the job

- **Record a change:** inspect the implementation and add one concise draft
  entry when users or contributors gain, lose, or materially experience a
  capability.
- **Publish a change:** add `publishedAt`, optional `release`, and concrete
  `evidence` only after the delivery claim is proven.
- **Backfill history:** reconstruct an omitted entry from tags, commits, pull
  requests, tests, deployment records, or other durable evidence. Use the
  original availability date, not today's date.
- **Prepare release notes:** publish the applicable entries, rebuild the
  projections, and hand the generated release file to the authorized release
  workflow. A notes file is not release authorization.

## Gather evidence

Use the coding agent's native file, Git, GitHub, test, and search tools. No
custom Changelog command is required for investigation or writing.

Establish these facts separately:

1. what behavior changed;
2. who can notice or use it;
3. which code, pull request, or commit contains it;
4. whether it was merged;
5. whether the relevant component was delivered; and
6. whether any required real-user smoke produced the visible outcome.

Merge, tag, deployment, and smoke are different claims. Keep an entry draft
when the evidence proves only an earlier claim.

## Decide whether to record it

Record changes that affect users, operators, integrators, or contributors:

- new or removed capabilities;
- material workflow or behavior improvements;
- user-visible fixes and security changes;
- breaking behavior and deprecations; or
- developer-facing changes that alter supported integration or contribution
  work.

Skip internal refactors, test-only changes, routine dependency maintenance, and
documentation cleanup when they do not change an external workflow. Combine
several implementation commits into one user-meaningful entry when they deliver
one outcome.

## Write the entry

Use a unique lowercase slug for both the filename and `id`. Write native-level
English for OpenMeld's North American audience. Lead with what is now possible
or what changed, not implementation details.

```markdown
---
id: slack-channel-invitations
title: Invite teammates from Slack
kind: new
areas: ["channels", "center-agent"]
audiences: ["admins"]
---

Organization admins can invite a teammate while working with the Center Agent
in Slack, without switching to a separate setup flow.
```

That entry is a draft. Publish it only after delivery is proven:

```yaml
publishedAt: 2026-08-17
release: v0.3.60
evidence: ["pr:72", "commit:1d5254d", "workflow:123456789"]
```

`release` is optional for continuously delivered changes. Every published entry
requires durable `evidence`. Keep uncertain historical work as a draft rather
than inventing a date, scope, or release.

## Rebuild and verify

Run:

```sh
pnpm changelog:build
pnpm changelog:check
```

Review the resulting diff. A complete change has valid source entries,
up-to-date deterministic projections, and no unsupported publication claim.

For a historical backfill, also confirm that adding the older entry placed it
by `publishedAt` rather than by the date of the backfill commit.
