# OpenMeld Changelog

## Agent Context

- Purpose: Define the Git-backed OpenMeld Changelog source, entry lifecycle,
  validation, historical backfill, generated projections, and GitHub
  release-note handoff.
- Read this when: Recording, publishing, validating, querying, or historically
  backfilling OpenMeld changes, or preparing official release notes.
- Update this when: The entry contract, publication evidence rule, generated
  output, validation command, or GitHub handoff changes.
- Do not use this for: Product Changelog UI, Center Agent tools, proactive
  notifications, release authorization, deployment execution, or production
  smoke procedures.
- Source of truth: This file owns the OpenMeld Changelog maintenance contract;
  `changelog/entries/*.md` owns the actual change records.

## Boundary

The Changelog is a small Git-native record, not a service. It has no database,
runtime, daemon, package, or separately published CLI.

Coding agents and humans author ordinary Markdown files. Two repository scripts
validate those files and produce deterministic read models. Future Web and
Center Agent integrations must consume the generated machine-readable index or
an equivalent projection of the same entries; they must not create another
Changelog authority.

## Repository layout

```text
.agents/skills/openmeld-changelog/SKILL.md  portable agent workflow
.claude/skills/openmeld-changelog/SKILL.md  thin Claude Code adapter
changelog/entries/*.md                      authored source of truth
changelog/index.json                        generated public machine index
changelog/releases/*.md                     generated GitHub release notes
CHANGELOG.md                                 generated repository view
scripts/changelog/                           internal validation and build code
```

`.agents/skills/openmeld-changelog/SKILL.md` uses the portable Agent Skills
core: `name`, `description`, Markdown instructions, and ordinary repository
commands. It must not require one coding agent's tool names, argument syntax,
permission model, or context variables.

## Entry contract

Each entry is one Markdown file with flat YAML frontmatter and a Markdown body:

```markdown
---
id: slack-channel-invitations
title: Invite teammates from Slack
kind: new
areas: ["channels", "center-agent"]
audiences: ["admins"]
publishedAt: 2026-08-17
release: v0.3.60
evidence: ["pr:72", "commit:1d5254d", "workflow:123456789"]
---

Organization admins can invite a teammate while working with the Center Agent
in Slack, without switching to a separate setup flow.
```

The filename must be `<id>.md`. Fields are intentionally small:

- `id`: stable lowercase slug and filename identity.
- `title`: short user-facing English title.
- `kind`: one of `new`, `improved`, `fixed`, `security`, `breaking`,
  `deprecated`, or `removed`.
- `areas`: non-empty lowercase slugs used for product relevance and future
  filtering. Values stay open so the Changelog does not become a second product
  taxonomy registry.
- `audiences`: non-empty lowercase slugs describing who benefits or must react.
- `publishedAt`: optional real availability date in `YYYY-MM-DD` form.
- `release`: optional Git tag or release identity. It is valid only with
  `publishedAt`; continuously delivered work can omit it.
- `evidence`: durable repository or delivery references. It is required for a
  published entry and optional while the entry is a draft.
- Markdown body: concise public explanation of the outcome and practical value.

To keep every human and agent consumer bounded, `id` and list values are at
most 120 characters, `title` is at most 240 characters, the body is at most
4,000 characters, evidence values are at most 240 characters, and each entry
list contains at most 10 items. These authoring limits are the same limits used
to validate the generated machine index at runtime.

Arrays use JSON string-array syntax. The frontmatter stays flat on purpose: it
is easy for humans and agents to edit, straightforward to validate with the
mature `yaml` parser, and portable to ordinary Markdown tooling.

## Lifecycle

Publication is derived from evidence instead of a manually maintained status:

- An entry without `publishedAt` is a draft. It can travel with the feature PR
  and does not appear in public generated output.
- An entry with `publishedAt` is published. It must contain non-empty
  `evidence`.
- `release` groups published entries into a generated release-notes file. It
  does not prove that a tag, GitHub Release, deployment, or smoke exists.

Keep these claims separate:

```text
implemented -> merged -> tagged -> deployed -> smoke-verified -> published
```

The applicable release and product owner documents decide which delivery and
smoke evidence is required. Changelog publication records the proven result; it
does not weaken those gates.

## Normal authoring flow

1. Inspect the implementation, tests, pull request, and affected users.
2. Add one draft entry when the work creates a user-, operator-, integrator-,
   or contributor-visible outcome.
3. Let internal refactors, test-only work, and invisible maintenance ship
   without an entry.
4. When delivery evidence exists, add `publishedAt`, optional `release`, and
   `evidence`.
5. Run `pnpm changelog:build` and review the generated diff.
6. Run `pnpm changelog:check` before handoff.

The coding agent can use its own Git, GitHub, search, and file tools. The
repository scripts are deterministic checks and builders, not a required
authoring interface.

## Historical backfill

Historical entries use the same contract as new entries. Backfill does not
create a second archive format or a special history database.

For each candidate change:

1. Establish the user-visible outcome from code and durable history.
2. Locate the strongest available evidence: immutable tag, commit, merged pull
   request, test, deployment record, release artifact, or documented smoke.
3. Use the original availability date in `publishedAt`, even though the entry
   is being committed later.
4. Set `release` only when the historical release identity is known.
5. Leave the entry as a draft when the date or delivery claim cannot be proven.

Generated views sort by `publishedAt`, not filesystem order, commit time, or
backfill time. A later backfill therefore appears in the correct historical
position.

Backfill may be performed in small reviewed batches. One agent can investigate
one bounded tag or date range, while the same validator protects the final
combined record from duplicate IDs, invalid fields, and inconsistent release
dates.

## Generated projections

`pnpm changelog:build` writes:

- `CHANGELOG.md` for GitHub visitors and repository readers;
- `changelog/index.json` as a stable, versioned machine projection for future
  Web, Center Agent, Channel, and App consumers; and
- one `changelog/releases/<encoded-release>.md` file for each release identity.
  For example, `web/v0.8.0` becomes `web%2Fv0.8.0.md` instead of creating a
  nested directory.

Only published entries appear in these projections. The builder emits no
current timestamp, so identical source produces byte-identical output.

`pnpm changelog:check` validates every source entry and fails when a generated
file is missing, stale, or unexpected. `pnpm verify:changelog` also runs the
behavior tests and is part of Fast PR.

Generated files are read models. Edit the entry and rebuild instead of editing
a projection by hand.

## GitHub handoff

A generated release file is suitable as the body of a GitHub Release for its
matching tag. This foundation deliberately does not call GitHub APIs, create
tags, create Releases, deploy components, or send notifications. An authorized
release workflow can consume the file later without changing the entry model.

Historical GitHub Releases can be created for existing tags, but GitHub records
the time the Release object is created rather than the original historical
delivery time. The Changelog keeps the original `publishedAt` truth. Any future
backfill that creates GitHub Release objects must disclose this distinction and
consider subscriber notifications before writing external state.

## Center Agent reader

The Center Agent reads the committed `changelog/index.json` from the canonical
GitHub repository's `main` branch through a private Core RPC. Core validates the
shared schema and keeps only a 60-second in-isolate cache to avoid repeated
GitHub reads. It does not copy Changelog entries into D1, KV, R2, prompts, or
Organization memory. A failed or invalid GitHub response fails visibly instead
of being replaced with guessed or silently stale update data.

The model-visible `openmeld_read_changelog` tool returns only published entries
and supports bounded filters for publication date, area, audience, kind, and
release plus newest-first offset pagination. It is read-only and uses the same verified speaker and designated
Center Agent admission path in Web, Slack, and every other supported Channel.
No additional Slack scope is required because the tool neither reads Slack data
nor creates a new publication path.

The GitHub contents request may use Core's existing repository token while the
repository is private and works without authentication once the source is
public. Git merge makes a published index discoverable without a Core deploy;
the short cache means an already-warm isolate may take up to one minute to see
the new commit.

## Consumers and next extension

This foundation keeps later integration small:

- Center Agent searches entries by date, area, audience, kind, or release;
- a Web Changelog page can render the same `changelog/index.json` next;
- Channel and App experiences can reuse the same read projection;
- relevance and notification preferences can be layered on without changing
  historical entries; and
- another project can reuse the Skill, entry contract, and scripts without an
  OpenMeld database.

Proactive notifications and preference controls remain out of scope until the
passive authoring, Center Agent, and Web reading paths have enough real use to
prove the contract is comfortable.
