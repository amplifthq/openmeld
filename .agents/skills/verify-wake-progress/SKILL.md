---
name: verify-wake-progress
description: "Check the Space wake progress banner. A closed banner must not reopen as working, and a stop must not be replaced by a later failure or reply. Use when changing applyWakeProgressSignals, mergeWakeProgressItems, shouldReplaceWakeProgressItem, or createWakeProgressItem."
---

# Verify the wake progress banner

A later working update never reopens a banner that already says the wake stopped, failed, or could not be confirmed. Harm: the Space looks like the agent is still working after the wake already ended.

Two rules do not hold in the current projection. A failure or unconfirmed notice applied after a stop replaces "Wake was stopped". A final reply clears that banner. Harm: after you stop a wake, the Space can change the story to a failure or show a reply.

The question is whether signals can arrive in an order the banner handles badly. That is a model check, so the spec is TLA+ and the checker is TLC 1.7.4 (jar sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`). The code check calls `applyWakeProgressSignals` directly. Java 11 or newer must be on `PATH`. The check downloads the jar into `~/.cache/openmeld-tlc/` on first run.

## When this applies

Run it when a change touches any of these:

- `packages/space/src/wake-progress/wake-progress-projection.ts`
  - `applyWakeProgressSignals`
  - `clearWakeProgressItemsForSignal`
  - `mergeWakeProgressItems`
  - `shouldReplaceWakeProgressItem`
  - `createWakeProgressItem`

Confirmed against commit `965d9eb3219fa2c35789f9ab9a2206ab8699de9b`. Move that commit forward only after you have confirmed that `WakeProgress.tla` and `check.test.ts` still describe the code at the new commit.

## Run

From the repository root, after `pnpm install`:

```sh
node .agents/skills/verify-wake-progress/check.mjs
```

Exit 0 means the closed-banner rule holds and the two recorded findings are still the only failures. Any other result needs a look before you treat the banner as safe.

Read every TLC result with `/statechart`. The user-facing labels are in `view.mjs` next to the spec. When the check passes its recorded verdict, `/statechart` draws how the banner moves, including the two states that break a rule.

## What a failure means

- `does not reopen a stopped banner` failed: a non-terminal update replaced a terminal row. That is a product bug unless you intentionally removed the terminal guard in `shouldReplaceWakeProgressItem`.
- `StopIsNotShownAsFailure` or `StopIsNotClearedByAReply` stopped failing: the projection now keeps a stop. Update the spec, the view, and this skill, then say so. Do not delete the rule to make TLC quiet if the banner can still change story.
- A new TLC error, or `ClosedRowStaysClosed` failing: the model and the code disagree, or a new transition reopens a closed row. Compare one signal in `applyWakeProgressSignals` with the action of the same name before changing the rule.

The counterexample for the recorded findings, in the code's words: the banner is empty, you stop the wake, then a `terminal_failure` or `publication_unknown` notice is applied and the banner no longer says stopped. Or a final reply signal is applied and the banner is removed. The code check applies an older failure notice after a newer stop and still gets `failed`, because a terminal signal clears the row before the merge.

## Scope

One wake and one banner. `request_sent`, `queued`, `connecting`, and `retrying` are one waiting state. `running`, `writing`, and `publishing` are one working state. Expiry of an old banner is not in the model. The chart hides jumps that skip the main story, such as a failure before anything else is shown. It keeps both bug paths.

## After a change that skipped this skill

Use `/maintain-formal-verification-skill` to bring this check back in line.
