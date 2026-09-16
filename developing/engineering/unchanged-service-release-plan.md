# Retaining an unchanged Service across CLI releases

## Agent Context

- Purpose: Preserve the narrowed outcome and investigation for issue #988.
- Read this when: Taking over the lower-priority Service release optimization PR.
- Update this when: Release selection, installed-artifact behavior, or fresh implementation evidence changes.
- Do not use this for: A second updater, Desktop-owned Service lifecycle, hot-loaded code, production release commands, or blanket Service version freezes.
- Source of truth: This is a temporary handoff; existing release selection, local Service lifecycle, and artifact-integrity owners retain authority.

Status: DRAFT — lower-priority future optimization approved for PR handoff on 2026-09-16. Remove when the optimization is implemented and durable conclusions are incorporated into the relevant owners, before merging the implementation PR. Do not merge this handoff alone as completed functionality.

## Accepted outcome and stage

Updating only the CLI should not unnecessarily replace a healthy unchanged compatible Service process or its connection. A genuine Service change must still use the existing safe update path, preserve active-work handling and explicit Stop, and retain supported installation/recovery behavior.

Felix requested a linked PR now with comprehensive directional advice, not immediate implementation or a prescribed algorithm. This PR is initially research-only. The receiving Agent resolves fresh main and the then-current release contracts before deciding how to implement on this same branch. No runtime tests, release, production modification, or real-machine validation are claimed by the initial commit.

## What is already accepted

The [latest scope comment on #988](https://github.com/amplifthq/openmeld/issues/988#issuecomment-5685326222) accepts #989's safety work: installed integrity is checked against the installed Service's own bytes/fingerprint, active executable retention is protected, and the older maintenance carrier no longer substitutes its version for the actual managed CLI. That comment also records successful staging split-target, active-work, fresh-installation, and interrupted-download checks. These are historical scoped results, not evidence that the default production release path now retains an unchanged Service.

Do not reimplement the accepted integrity and retention fixes. Do not present the remaining issue as proven task loss, immediate disconnection, or unsafe forced replacement.

## Source evidence

Inspected main: `42ee500ef2af9244c5cb985ec3d09e624302a9a8`.

- [Release facts](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/scripts/release/local-components.mjs#L149) still assign `service.bundleVersion = packageVersion` and derive the Service bundle hash from the packaged CLI distribution tree.
- [Upgrade reconciliation](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/openmeld-cli/src/commands/upgrade.ts#L994) uses the separately published Service artifact when available in the binary release; otherwise the reconciliation target comes from the existing daemon-version path.
- [Alignment policy](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/openmeld-cli/src/local-service/lifecycle/daemon-service-alignment-target.ts#L195) treats a newer requested version as needing full alignment.

Together these identify a release-selection opportunity, not a reason to weaken the alignment policy or bypass the update coordinator. A successful opt-in retain-Service staging path is not the same as the ordinary release behavior requested here. Source verification is not a new production smoke.

## Recommended direction and tradeoffs

Prefer making the normal published selection retain an unchanged compatible Service target through the existing artifact-selection and maintenance machinery. The final mechanism might be smaller than the original lifecycle-decoupling proposal; decide from current evidence rather than requiring a broad packaging redesign.

“Unchanged” needs trustworthy release and compatibility evidence. A label saying CLI-only, unchanged directory name, or equality of version strings is not enough. Conversely, incidental shared-schema or packaging inputs may currently change the computed bundle fingerprint without intentionally changing Service behavior. The implementing Agent should adjudicate the actual artifact inputs and dependency boundary rather than freezing all Service updates or suppressing validation to achieve a stable PID.

Keep immutable acquisition, checksum/signature verification, repair, executable retention, and compatibility floors intact. Existing installs, fresh installs, interrupted downloads, and supported mixed-version readers can need different evidence. Evaluate the actually supported distribution paths instead of assuming the inspected binary-only branch proves npm behavior. A retained target must remain obtainable for repair and must not be garbage-collected with an unrelated CLI rollback slot.

Reuse the established coordinator for real Service updates and preserve authorization, active-work drainage, user Stop, and uncertainty handling. Do not add another permanent process, updater, lifecycle authority, or Desktop-specific Service owner. #1098's Desktop public download and in-app updater is independent; this optimization is not a prerequisite for that work and should not enlarge it.

## Proportionate completion evidence

The decisive case is an ordinary eligible CLI-only release/update selecting the same healthy Service target and retaining its process/connection, with a control case where a real Service change still takes the existing safe path. Match fresh-installation, repair, interruption, and mixed-version checks to changed surfaces; reuse #989's accepted evidence where unchanged instead of repeating an unrelated full test matrix. Separate repository tests, isolated/staging machine evidence, and production delivery claims.

Relevant owners are `developing/architecture/local-openmeld-service.md`, `developing/engineering/cli-binary-release.md`, `developing/engineering/agent-native-delivery.md`, `developing/engineering/production-release.md`, and `developing/architecture/shared-contracts.md`. Update durable contracts and the user-visible Changelog when the implementation warrants it. Keep #988 open during planning and link closure only to the actual accepted repair.
