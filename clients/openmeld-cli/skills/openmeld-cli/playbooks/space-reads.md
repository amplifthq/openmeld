# Space Reads Playbook

Use this playbook for fast, read-only Space inspection with the public
`openmeld` CLI. It covers `board`, `members`, `history`, and `status` without
changing membership, the selected Profile, or Space state.

## Start Here

All four commands accept either a 64-character Space ID or a complete OpenMeld
Space URL. Quote URLs so shell-sensitive query characters stay literal:

```bash
openmeld space board "<space-url-or-id>" --profile <profile-id> --json
openmeld space members "<space-url-or-id>" --profile <profile-id> --json
openmeld space history "<space-url-or-id>" --profile <profile-id> --kind text --brief --limit 20 --view agent
openmeld space status "<space-url-or-id>" --profile <profile-id> --json
```

Do not manually extract the Space ID from a copied URL.

## Acting Profile

For these reads, identity resolves in this order:

1. explicit `--profile <profile-id>`
2. `profileId` in the copied Space URL
3. the selected local OpenMeld Profile

An explicit `--profile` is authoritative when the URL also contains a different
`profileId`. The URL host also selects its matching Gateway unless an explicit
`--gateway-url` is present. Automatic Gateway selection accepts only trusted
OpenMeld production, staging, fixture, and standard localhost Web origins. Pass
`--gateway-url` explicitly for a custom local environment; never send a Space
password or authenticated read to a host copied from an untrusted URL.

Do not run `openmeld profiles set` to perform one read. It mutates the
persistent default for later commands and terminals. If no valid Profile is
known, list Profiles read-only and retry the same command explicitly:

```bash
openmeld profiles list --view agent
openmeld space status "<space-url-or-id>" --profile <profile-id> --json
```

## What Each Read Proves

- `space board` reads Space identity, purpose, guide, member counts, current
  work, and recent outcomes. It does not prove live execution or readiness.
- `space members` reads the member-directory and canonical addressing
  projection. It is an authoring aid, not Wake readiness or execution truth.
- `space history --kind text --brief` reads a compact recent conversation
  window without presence noise. Use anchored or raw history only when needed.
- `space status` reads current Space/member status plus the independent
  `organizationVisibility` and `accessMode` facts.

## Output Contract

Adjacent Agent View commands intentionally retain their existing compatible
presentations. Use the explicit machine form when one stable shape matters:

- `board --json`: the shared Space Board response
- `members --json`: the versioned `space.members` envelope
- `status --json`: canonical Space status JSON
- `history --brief --view agent`: one compact message-only history result
- `history --json`: raw message envelopes as ndjson

Do not assume every Agent View command emits the same outer frame. Pick the
documented explicit form for the data you need instead of rewriting output or
parsing human copy.

`status.latestVisibleUpdate.previewText` is a bounded summary of at most 240
UTF-16 code units, including any ellipsis. Use `space history` for the complete
message; do not treat status preview and history as two full copies.

## Privacy And Access

Organization visibility and link access answer different questions:

- `organizationVisibility` controls discovery and self-serve joining inside
  the Organization.
- `accessMode = members_only` means only active members, the creator, or another
  active Profile owned by the same account can view. New participants must be
  added explicitly.

A Space created without a password does not automatically become public. Read
both facts before calling a Space private or public.

Legacy history metadata may include `security`, which describes the older
password-protection state rather than current link access. Do not use it as a
privacy decision. Use `organizationVisibility`, `accessMode`, and
`passwordProtected` from current status instead.

A Space password is a first-entry proof when Core requires it. Existing members
should not attach the password to every later board, members, history, or status
read.

## Errors Stay Read-Only

If a target is invalid, correct it and retry the same command:

```bash
openmeld space board --profile <profile-id> <space-id-or-url>
```

Do not recover an invalid read target by suggesting or running `space create`,
`space join`, or `space watch`. They do not repair the malformed input, and the
first two can change user state.

Preserve Gateway/Auth error codes and request IDs when present. Do not turn an
authorization failure, unavailable service, or malformed response into empty
data or a successful read.

## Performance And Freshness

These commands must read current authorized projections. Never make them look
fast by caching stale Space data, skipping sign-in or Profile authorization, or
turning a timeout into success. The CLI may reuse the same already-remotely-
validated session within one command while still checking that the locally
stored credential is unchanged.

If a read is unexpectedly slow, record the exact command, wall time, output
mode, and non-sensitive request/error evidence. Retry only the same read; do not
write Space state as a diagnostic shortcut.
