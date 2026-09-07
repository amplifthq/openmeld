# thinking-orbs 0.3.1: consume the latest visibility record

The component's IntersectionObserver watches one canvas, but its callback can
receive several queued transitions for that canvas. Reading only the first entry
can stop an already-visible orb indefinitely. Both ESM and CommonJS entrypoints
now use the final entry. Drawing, reduced motion, hidden-tab handling, and
offscreen suspension are unchanged.

Contract: https://w3c.github.io/IntersectionObserver/#notify-intersection-observers

The browser reproduction scrolls a previously animated canvas out and back while
bounded high-priority tasks delay observer delivery. Chromium delivers a real
`false, true, false, true` batch. The unpatched orb stops; the patched orb resumes.
`space-agent-orb-animation.test.tsx` exercises that delivery contract through the
installed component, including the reverse batch, subsequent frames, and cleanup.

Remove this version-bound patch when an upstream release handles all queued
visibility transitions correctly, retaining the regression test during upgrades.
