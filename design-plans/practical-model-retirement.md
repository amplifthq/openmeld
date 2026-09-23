# Practical model retirement

Status: implementation in progress. This plan records the agreed scope, not a
claim that every integration below has shipped.

## User outcome

A user knows that their model is going away, can open that Agent's model
settings from a failure or Inbox item, and changes the model themselves.
OpenMeld never silently substitutes a model, deletes conversation history, or
rewrites the user's manual enabled/disabled preference.

## Three separate decisions

1. The existing model-catalog Action collects evidence for already supported
   models as well as new candidates. Missing sources, hidden inventory entries,
   404s and discovery dates are not retirement proof.
2. A reviewed notice records the official date, exact controller/provider/login
   scope and source. Dates are advisory, including dates that have passed.
3. A maintainer rechecks the source in a PR and explicitly confirms withdrawal
   or postponement. Only confirmed withdrawal blocks the affected selection.
   Retain the catalog record so existing selections have a name and explanation;
   remove it from new choices rather than deleting historical identity.

There is no date-triggered shutdown job, lifecycle platform, automatic model
migration, generic LLM error classifier, or automatic rerun after recovery.

## Implementation boundaries

- Keep reviewed metadata in the Git-authored catalog. Preserve strict legacy
  catalog readers with an explicit compatible projection.
- One shared pure interpretation of notice/scope/withdrawal. Unknown login scope
  is not proof of retirement. Same-name models on other providers remain usable.
- Reject unavailable explicit selections without falling back to a default.
  Preserve native Codex resume semantics when no model was explicitly selected.
- Reuse Core-owned Unavailable/Wake admission and existing execution checks;
  never represent model retirement as Computer Offline or mutate Profile status.
- Only trusted provider failures with confirmed retirement meaning receive the
  retirement classification. Generic model-not-found, auth, quota and network
  errors keep honest, separate explanations.
- Use short English copy and one Change model action targeting the exact Profile.
  A viewer without edit rights is directed to the owner, not a dead-end editor.
- Reuse Inbox source identity/upsert/resolve. Repeated failures do not create
  duplicate action items. A valid model change clears only this model blocker,
  preserves manual disabling and history, and never restarts old work.

## Validation and delivery

Extend the closest behavioral tests for advisory dates, exact scope, explicit
selection preservation, rejection before provider execution, conservative error
classification, recovery navigation and Inbox lifecycle. Include legacy-reader
compatibility and the existing old-session path. Use isolated OpenMeld state.

This work is delivered incrementally on one Draft PR. The PR must distinguish
implemented integrations, actual test results, remaining acceptance, contract
impact and release requirements. No merge, Ready transition or deployment is
authorized by this task.
