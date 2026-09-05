# Official CLI Skill delivery

## Agent Context

- Purpose: Define independent delivery and installation of the official OpenMeld CLI Skill.
- Read this when: Changing the public guide, signed channel, local cache, or Agent installation.
- Update this when: Publication, compatibility, installation ownership, or maintenance behavior changes.
- Do not use this for: Organization Skills, CLI command implementation, or Wake execution policy.
- Source of truth: This file owns the official CLI Skill content delivery contract.

## Scope

OpenMeld's own CLI guide is separate from Organization Skills. It contains
Markdown only. There is no remote executable, Agent configuration, permission,
or command implementation in this channel.

## Content and publication

Author the current guide in `release/openmeld-cli-skill/`. Keep `SKILL.md` a
small entry with relative links; put task details in playbooks and references.
Increment `release.json.revision` for every published change. Increase
`minimumCliVersion` when instructions require a newer command implementation.
An incompatible Skill contract requires a bridge CLI release, not just a
content update.

Run `node scripts/release/cli-skill.mjs build` after building
`@openmeld/schemas`. It signs the exact payload with Ed25519 and generates
`clients/web/public/skills/openmeld-cli/`: the public Markdown entry, topic
files, immutable revision folders, and the bounded signed channel. The channel
keeps the latest release for each supported compatibility floor.
Commit the authoring files and generated public files together.
`node scripts/release/cli-skill.mjs check` requires no private key and also
runs before every Web build. Ordinary content-only changes select Web delivery,
without changing CLI or Service bytes.

The signing private key is never tracked or deployed to Web. Local publication
uses `~/.config/openmeld-release/cli-skill-signing.pem` (owner-only access), or
an explicitly supplied `OPENMELD_CLI_SKILL_SIGNING_KEY_FILE`. The initial key
was created on Felix's release workstation. Back up/provision this same key
through the team's secret manager before moving publication to another host.
Never generate a replacement key under the existing public identity.
Public verification needs only the pinned key in `@openmeld/schemas`.

The stable no-login entry is
`https://openmeld.ai/skills/openmeld-cli/SKILL.md`. Each revision also has an
entry at `/skills/openmeld-cli/releases/<revision>/SKILL.md`; relative links
stay in that revision. These are ordinary Web static assets, not authenticated
Organization Skill routes.

## Local behavior

The CLI's `skills/` directory remains the offline baseline shipped with that
executable. Do not edit it for routine guide publication. Local selection uses
the newest cached, signature-verified, compatible release; otherwise it uses
the baseline. Installation, `openmeld prompt --raw`, and local component
status share that selection. The baseline never overwrites a compatible
cached release.

The existing independent maintenance worker checks the signed channel under
the existing automatic-update preference. It bounds download size/time,
rejects invalid signatures and paths, and never downloads executable files.
A network failure keeps the last good cache and still permits local repair.
Content-only maintenance does not restart Service.

Store and target updates share the existing install lock. Prepare a sibling
directory or link before replacing a working install. A temporary backup
recovers a process exit between directory renames on the next pass. Windows
uses an absolute junction target; denied link creation falls back to copying.
This is recoverable directory replacement, not a claim of an uninterrupted
multi-file read across an update.

Keep unowned paths and locally edited copies. Before a dispatch, check only
the selected controller's Skill locally, and provide its exact installed entry
path plus the public fallback in native/fallback instructions. A failed repair
does not grant execution authority or bypass dispatch-scoped publication.
Installation proves files exist; native discovery and actual guide use must
be tested separately. Already loaded Agent context may need a new turn/session.

## Compatibility and release order

The bridge adds optional `skills.contentRelease` to local component reports.
Core accepts a different content hash only for an independently maintained
release whose Skill contract and minimum CLI version are compatible; local
missing/conflicting target errors remain errors. Legacy reports retain the
existing bundle policy.

Deploy updated report receivers (Core/Gateway and other selected schema
consumers), then Web, before publishing the bridge CLI/Service. Older strict
receivers do not accept the new optional field. Do not roll receivers back
past this support while independently maintained Services are reporting.
Old CLI/Service installations keep working with the new receivers. There is
no database migration and no change to Wake ownership or Space Actions.
After the bridge is installed, normal Skill updates require only Web delivery.

## Validation

Use a fresh `OPENMELD_HOME` and explicit Agent target directories.
An isolated lane can fetch only an explicitly configured loopback
`OPENMELD_CLI_SKILL_CHANNEL_URL`; production always uses the official HTTPS
endpoint and ignores that override.
Verify public unauthenticated reads, local installation and native discovery,
tampering, incompatible versions, offline preservation, interrupted replacement,
user conflicts, and repeated setup without a downgrade. Windows native smoke
remains required before claiming Windows real-device coverage.
