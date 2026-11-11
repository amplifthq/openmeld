---
name: verify-wake-progress
description: Check whether Web keeps late progress hidden after observing the published outcome of a Space Wake. Use when changing the Space progress presentation cache, signal projection, or publication matching.
---

# Verify Space Wake progress

Run from the repository root after `pnpm install`, with Java 11 or newer. The check runs the Web presentation tests and TLC 1.7.4 using `WakeProgress.cfg`.

```sh
node .agents/skills/verify-wake-progress/check.mjs
```

The model follows one dispatch in one viewer's Space presentation cache. A final reply or notice clears matching progress. Subsequent transient updates and summaries can still arrive. Web retains the publication and filters those rows before displaying them. Other dispatches stay visible. The Web suite also exercises remounts and viewer isolation, outside the single-dispatch model.

- `clients/web/src/query/spaces/active-wake-progress.ts` owns retained publication evidence and the visible rows. `PublishedProgressStaysHidden` checks the row after each delivery. `FirstPublicationSticks` checks that a later observation cannot change the first recorded publication for that dispatch.
- `packages/space/src/wake-progress/wake-progress-projection.ts` processes individual signals. Calling it alone with a final reply followed by late progress can recreate a running row. The Web check replays that ordering through the presentation cache.
- Space elects the durable outcome. Injecting conflicting terminal signals into a projection exercises defensive presentation behavior. It does not establish that Space can publish two outcomes. Core's `publication_unknown` summary is separate from a published Space notice.

If late progress becomes visible, inspect publication matching and filtering in the Web cache. If TLC fails, use its event trace to replay the same order at that boundary. The state labels in `view.mjs` describe visible progress and observed publications.
