# Retained-result context evaluation

This fixture evaluates the proposed runtime policy that removes older tool-result
previews while the exact result remains recoverable. The Draft PR wires this
policy into the Hosted agent. It is not accepted for merge: completed live
comparisons show mixed cost benefit and output-contract failures. Flue remains the canonical history and
compaction owner; Core access and retained-result ownership are unchanged.

## Reproduce

Install the pinned workspace dependencies and build Remote Agent dependencies.
Run the deterministic boundary tests without credentials or supplier access:

```sh
pnpm --filter @openmeld/remote-agent exec vitest run tests/retained-context-evaluation.test.ts tests/retained-context-runtime.test.ts tests/working-context.test.ts tests/retained-tool-results.test.ts --maxWorkers=1
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

For the full single-execution Flue comparison, add
`OPENMELD_RETAINED_CONTEXT_MODE=runtime` to the same command. This mode allows
64 requests, with agent output capped at 1,024 tokens and summaries at 4,096.
It uses real Flue SQLite storage in that output directory and real inference.
Eight synthetic write calls precede eight cursor-dependent observation pages.
All result references and reads belong to the same execution. The observation
pages force summaries even when older retained previews can be removed.
Both variants must finish, preserve the final facts, recover the original code,
execute each write once, and complete at least two summaries. Cost includes
all recorded inference and summary requests. This synthetic task does not
measure real Core RPC latency or cloud storage cost.

In runtime mode, `OPENMELD_RETAINED_CONTEXT_PROBE=1` runs one small connection
probe instead of the task. `OPENMELD_RETAINED_CONTEXT_PAIR=1` runs baseline then
candidate; `OPENMELD_RETAINED_CONTEXT_PAIR=reverse` runs candidate then baseline.
The default remains all four variants. A probe is not task acceptance.

The test returns the original streaming response immediately. An independent
observer records response headers, first data, completion or transport error,
Gateway log ID, provider response ID and supplier usage. It saves synthetic
request bodies without credential headers so a failed request can be diagnosed
without repeating the full task. The earlier observer buffered the full body
before returning headers and could not distinguish connection from body failure.

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

## Runtime implementation and qualification

The branch now includes the Flue-owned preflight projection seam and uses the
production retained-result reader for eligibility. It reduces only when the
full context exceeds its budget. It protects the recent token tail and at
least two latest results. It preserves canonical originals and falls through
to normal compaction if preview reduction is insufficient. No provider wrapper
or second history store owns this decision.

The 35 focused tests passed after this implementation. Public Flue dispatch
tests prove that preview reduction can avoid the first summary, later growth
still triggers multiple summaries, canonical previews survive the temporary
reduction, and writes are not repeated. The deterministic multi-dispatch fixture
uses a static retention identity to isolate projection mechanics. It cannot
prove cross-execution production access or complete-task cost savings.
Remote Agent type checking and its Worker build also passed.

The paid qualifications on October 6 did not produce an accepted comparison:

| Attempt | Outcome | Recorded supplier USD | Exclusion reason |
| --- | --- | ---: | --- |
| Multi-dispatch qualification | Three completed variants; fourth failed | 0.025614050 | Static fixture retention identity spanned dispatches; invalid production cost comparison |
| Single execution, batch observations | All four variants failed | 0.008840725 | An indivisible batch exceeded the budget in both policies; other runs timed out |
| Single execution, cursor pages | All four variants failed | 0.013237755 | Summary timeouts or connection errors interrupted all variants |

These costs include only responses with recorded usage. Failed requests can
have unrecorded supplier charges. Failed runs are not treated as savings or
quality results. Local request and outcome files were preserved. The final
cursor-based experiment is the reproducible acceptance path. It uses a 20,000
token test budget to exercise repeated pressure; production uses 48,000.

These earlier interruptions are superseded by the completed comparisons below,
but remain part of the evidence record.

### Resumed streaming diagnosis and completed comparisons

The connection probe completed in 2,193 ms with HTTP 200 and correct text.
Headers arrived at 1,704 ms and first data at 1,877 ms. A subsequent candidate
run received headers at 876 ms and first data at 1,290 ms, then failed after
85,215 ms with `TypeError:UND_ERR_SOCKET`. It did not hit the test's 120-second
limit or Flue's context admission guard. This proves an interrupted response
stream, not which upstream component closed it. The inference credential received
403 from the Gateway log-detail API, so no server-side cause is asserted.
That interrupted candidate recorded USD 0.010000895 before failure; it is not
included in completed-task savings. Its companion baseline completed for
USD 0.012648990 but returned a string budget instead of the requested number.

Two later pairs completed every task without a transport interruption. Their
orders were candidate/baseline, then baseline/candidate. The production change
was unchanged from `3a221d656`; the branch was synced with main at `7ec66d882`.
The 20,000-token synthetic task used `openai/gpt-6-luna`, low reasoning, the
existing Gateway route with DEV credentials, and real Flue compaction.

| Run | Calls | Summaries | Input tokens | Output tokens | Cached input | Reported USD | Cumulative request ms | Strict output contract |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Candidate, reverse pair | 12 | 3 | 94,692 | 6,953 | 19,233 | 0.013100305 | 119,564 | Pass |
| Baseline, reverse pair | 15 | 5 | 105,651 | 7,995 | 36,973 | 0.012950855 | 145,109 | Fail: budget type |
| Baseline, confirmation pair | 15 | 5 | 106,537 | 9,337 | 37,438 | 0.013679130 | 144,346 | Fail: field names and budget type |
| Candidate, confirmation pair | 12 | 3 | 93,868 | 6,812 | 18,900 | 0.012965100 | 104,895 | Fail: budget type |

All four tasks returned the correct owner, USD amount, absence of deployment
permission, original archive code, observation codes and counts. Each executed
exactly eight writes and eight observation reads with no repeated write.
Original-code recovery can occur through a summary of canonical originals;
these outcomes do not imply that every candidate called the retained-result
read tool. The original reader remains covered separately.

Across these two pairs, the candidate made 20% fewer inference requests and
40% fewer summaries. Recorded cumulative request time was 22.5% lower. Cost
was 2.1% lower in aggregate, but 1.2% higher in one pair and 5.2% lower in the
other. The candidate had fewer cached input tokens, and fewer summaries did
not reduce summary output proportionally. These are two pairs of one synthetic
task, not statistically established production savings or a latency guarantee.
No real Core RPC latency or cloud storage cost is included.

Both strict comparison tests remain failed. Assertions were not loosened.
The baseline's first saved checkpoint omitted the requested numeric budget
type and exact JSON keys. Later checkpoints repeated that reduced contract.
The candidate also lost the budget type in one completed run. This is a
separate active-output-contract retention finding, not a transport failure
or proof that preview reduction introduced the defect.

Decision: retain PR #1541 as a Draft experiment. Do not enable this policy by
merging it on the strength of the earlier 67% continuation-only result. The
new evidence supports fewer summaries, but not a stable cost win or complete
output-contract acceptance. Preserve the strict failure and the canonical
checkpoint evidence for a focused investigation of active user constraints.
Do not change production timeouts or add retries to turn these runs green.

Local trace directories are `single-turn-1791298166592` (interrupted pair),
`single-turn-1791298700387` (completed reverse pair), and
`single-turn-1791299022980` (completed confirmation pair), under the ignored
output root. Raw synthetic requests and local SQLite histories are diagnostic
artifacts only; this document carries the durable result summary.

## Evidence boundaries

This replay bypasses Flue's working-context preflight and summarizer. It cannot
prove avoided summaries, repeated-compaction quality, whole-task savings,
restart durability, or browser-to-Worker behavior. It does prove that a narrow
receipt-only projection can recover exact evidence using the existing owner
and can reduce supplier cost for this synthetic continuation.

PR #1535 is merged, and this branch incorporates that main revision. Validate
multiple compactions, current corrections, original effect counts, cache
behavior and total task cost together before accepting the policy. Do not
add a second history store, retain every small response, extend retention, or
remove evidence solely because it is old.

Architecture check: Flue owns history and compaction. Existing retained-result
storage owns exact tool payloads and current authorization. The callback adds
no persistent state, cross-process contract or alternate runtime path. Existing
CLI, Service, Core and Web contracts remain unchanged. A draft Changelog entry
records the proposed Hosted behavior without claiming deployment.
