# Slate React selection synchronization

`slate-react@0.126.4.patch` fixes an unchanged-render race in `Editable` for
both the ESM (Web/Desktop renderer) and CommonJS entry points. Plate 53.3.14
pins this Slate version; upgrading Plate alone still reproduces the race.

The browser moves its selection before Slate's debounced/throttled native
`selectionchange` handler updates `editor.selection`. An intervening React
commit restores the old Slate range, undoing the user's click, arrow movement,
or selection. No document edit or draft replacement is needed.

The patch reads a valid pending native selection in React's
`getSnapshotBeforeUpdate`, before text nodes can be changed. It adopts that
range through Slate's selection transform before `Editable`'s layout effect
runs, only if the committed document, selection and marks are unchanged.
An explicit model change wins, including one from a child layout effect.
The original DOM restoration then uses the current selection, preserving the
[upstream asynchronous decoration repair](https://github.com/ianstormtaylor/slate/pull/6033).
Composition, pending Android input, mark placeholders, explicit selection
transforms, missing DOM ranges, and selections outside the editor retain the
existing synchronization rules. No second selection listener or draft owner is
introduced, and live updates remain enabled.

Run `pnpm --filter openmeld-web test:editor:browser` after installing Playwright's
Chromium and WebKit browsers. The component fixtures use the actual Composer,
draft storage hook, document editor, and Plate stack; they replace only the SSR
RPC boundary. They are not authenticated Space/WebSocket or physical-device
acceptance. The controlled race fails on unpatched 0.126.4 (offset 6 becomes 25).
The suite also covers backward ranges, next-character placement, native clicks,
arrows, mention/paste, persistence, draft replacement, blur, composition via
Chromium CDP, decoration-induced DOM splits, and deleting or undoing an Agent
mention (Backspace, Delete, select all).

The adopted range depends on the editor's `white-space: break-spaces` style.
Without it, Chromium collapses a trailing space and reports the caret before
it, so the next character lands before the space. The fixture page sets the
same style as the app's editor class.

Remove this patch when a Plate-supported Slate release passes the same
regressions without it. Related to OpenMeld #1397 item 28; this patch does not
claim to explain every mobile or installed Desktop report.
