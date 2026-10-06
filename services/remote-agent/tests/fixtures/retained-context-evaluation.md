# Retained-result context evaluation

This fixture evaluates whether older tool-result previews can be removed while
the exact result remains recoverable. It does not enable a product optimization.
No runtime imports the helper. Flue remains the canonical history and compaction
owner; Core access and retained-result ownership are unchanged.

## Reproduce

Install the pinned workspace dependencies and build Remote Agent dependencies.
Run the deterministic boundary tests without credentials or supplier access:

```sh
pnpm --filter @openmeld/remote-agent exec vitest run tests/retained-context-evaluation.test.ts --maxWorkers=1
```

The separate paid DEV experiment is opt-in and excluded from normal CI execution:

```sh
node scripts/dev/doppler-environment.mjs component remote-agent -- \
  env OPENMELD_LIVE_RETAINED_CONTEXT_EVAL=1 \
  pnpm --filter @openmeld/remote-agent exec vitest run \
  tests/live-retained-context-evaluation.test.ts --maxWorkers=1
```

It uses only fictional records, in-memory result storage and the DEV Gateway
inference route. It does not use an installed Service, production conversation,
cloud Computer, database, browser session or another worktree. The current Core
access response is modeled by the existing schema-validated fixture. Actual
provider inference and the retained-result implementation are exercised; cloud
usage-ledger persistence is replaced with local measurements. No end-to-end
authorization claim follows from the modeled Core response.

The experiment permits at most 24 supplier requests, each with at most 180 KB
of request data and 1,024 output tokens. Each variant permits six model rounds.
Output is stored under this worktree's ignored `dev-tmp/retained-context-evaluation/`.
That directory is an output destination, never an input dependency.

## Compared behavior

Eight synthetic completed write receipts carry large logs through the real
`prepareRemoteAgentToolResult` owner. The baseline retains the normal previews.
The candidate clones the model projection and removes only the first six
previews, preserving all small receipt fields, references, the latest two
results, user messages and tool-call/result identities. It uses the actual
`openmeld_read_tool_result` listing to establish eligibility. Expired,
unretained, running and failed results are not reduced. Access denial fails
the experiment rather than inventing eligibility.

The model must preserve a late owner/budget correction and the absence of
deployment authorization, recover an exact code removed from the candidate,
and count eight completed writes. Only the existing result-read tool can run;
an attempted new write fails the case. These are seeded receipts, not eight
real external writes. Deterministic cases prove non-mutation, original-detail
recovery and expired/revoked access boundaries.

The live order is baseline, candidate, candidate, baseline. Each variant uses
a distinct session affinity key. Report every request's supplier usage,
including additional reads, and preserve failed outcomes. Token totals,
cached tokens, cache writes and dollars are separate fields.

## October 6, 2026 observation

Base: PR #1535 at `db26251f65d8a9254ea120aa3fedcde3be52af8a`.
Its existing working-context and retained-result baseline passed 27 tests.
The unchanged opt-in `live-context-cost.test.ts` also passed with
`OPENMELD_LIVE_COST_CASES=long-bounded`: six real supplier calls, one actual
Flue summary, correct latest owner/budget/permission and original archive
recall, reported cost USD 0.03168167. That separate baseline validates the
existing compression path; it does not validate the new projection inside it.

Model: `openai/gpt-6-luna`, low reasoning. Four runs of one continuation,
not four independent tasks. Original/projection serialized context was about
110 KB / 37 KB. All four final answers retained every requested fact and
reported exactly eight completed writes. No final-pass tool errors occurred.

| Variant | Model calls | Result reads | Total tokens | Cached input tokens | Reported USD | Supplier wall ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline 1 | 2 | 1 | 41,797 | 20,726 | 0.002879610 | 4,646 |
| Candidate 1 | 2 | 1 | 13,843 | 6,749 | 0.000992715 | 4,011 |
| Candidate 2 | 2 | 1 | 13,843 | 6,749 | 0.000992715 | 3,705 |
| Baseline 2 | 3 | 2 | 62,927 | 41,618 | 0.003143705 | 6,380 |

Candidate supplier cost was 67.0% lower across these two pairs, including
result-read continuation requests. The baseline's extra read contributes to
the difference. There is no statistical or multi-model quality claim.

The initial calibration is excluded from this comparison: its hand-written
tool schema omitted the result-ID format and its unspecified budget field
accepted human-readable USD strings while the assertion required a number.
Both candidate answers contained the correct facts but failed that assertion;
both baselines attempted invalid IDs and the initial runner stopped instead
of returning normal tool errors. The final fixture derives the real tool
schema, explicitly requests numeric USD, and allows bounded tool-error
recovery. Local calibration evidence was preserved, not replaced by passes.

## Fixed prompt measurement

The same run rendered the actual system-prompt builder with fictional input.
Byte counts below describe a shared text prefix, not supplier cache hits or
the complete inference request (tool definitions are separate).

| Role and change | System bytes | Shared prefix bytes | Bytes after first change |
| --- | ---: | ---: | ---: |
| Center, unchanged | 77,871 | 77,871 | 0 |
| Center, knowledge index | 77,871 | 74,241 | 3,630 |
| Center, Organization Brief | 77,871 | 23,198 | 54,673 |
| Personal, unchanged | 9,227 | 9,227 | 0 |
| Personal, knowledge index | 9,227 | 1,822 | 7,405 |
| Personal, Organization Brief | 9,227 | 9,227 | 0 |

An Organization Brief change puts a substantial Center suffix after the first
changed byte, but its real change frequency is unknown. A personal knowledge
index changes earlier in its prompt. These are candidates for a cache test,
not evidence that the existing cache is broken. No prompt was reordered.

## Acceptance and next decision

This replay bypasses Flue's working-context preflight and summarizer. It cannot
prove avoided summaries, repeated-compaction quality, whole-task savings,
restart durability, or browser-to-Worker behavior. It does prove that a narrow
receipt-only projection can recover exact evidence using the existing owner
and can reduce supplier cost for this synthetic continuation.

Keep this PR separate from #1535's recovery delivery. After that owner settles,
the next production decision needs a Flue-owned preflight projection seam,
not a provider wrapper that reduces data after compaction has already run.
Validate multiple compactions, current corrections, original effect counts,
cache behavior and total task cost together before enabling a policy. Do not
add a second history store, retain every small response, extend retention, or
remove evidence solely because it is old.

Architecture check: this test-only change introduces no product state,
authority, cross-process contract or alternate runtime path. No product
Changelog entry is needed.
