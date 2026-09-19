# @tanstack/history 1.162.1: cancel the actual history traversal

PR #1101's real Router and UnsavedChangesGuard regression reproduced a mismatch:
canceling Forward kept the editor mounted but left the address bar on the next
page. The installed browser history implementation always undid a blocked POP
with `history.go(1)`, which only reverses a single Back action.

This version-bound patch reverses the already computed traversal delta instead.
It changes that one expression in the TypeScript source and both distributed
entrypoints. It does not bypass blockers, change their decision, remount editors,
or upgrade the router. The existing source maps remain upstream build artifacts.

`unsaved-changes-guard.test.tsx` covers cancellation and subsequent discard for
single-step and multi-step traversal in both directions through the installed
dependency and browser history. The Skills route tests additionally exercise the
real Team route, editor, and shared guard. These are jsdom integration tests, not
evidence of native Desktop or manual browser acceptance.

Remove this patch when upgrading to an upstream version that correctly reverses
blocked history traversal. Keep the behavior regressions during that upgrade.
