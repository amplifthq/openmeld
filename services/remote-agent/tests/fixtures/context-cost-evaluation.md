# Context cost evaluations

## 2026-10-04: admission before inference and recoverable originals

The candidate bounds the active request before inference, including calls
after tool results. The visible chat and canonical original messages remain.
It uses a 48,000 estimated-token working budget, an 8,000-token recent tail,
and a 4,096-token cap per summary completion. The estimate is UTF-8 serialized
text bytes divided by four, not a vendor tokenizer or a monetary reservation.
Image blocks use Flue's existing 1,200-token heuristic instead of counting
Base64 file bytes as text. This changes only measurement: original images and
the final physical-capacity/media guards remain intact. The paid matrix below
is text-only; the image boundary is separately covered with the public runtime.

The controlled matrix uses the real OpenMeld Gateway adapter, pinned Flue
2.1.0, and `openai/gpt-6-luna`, with low actor reasoning and an 8,192 output cap.
Only initial fictional history is seeded by a faux provider. All measured
answers, summary requests and tool decisions are paid supplier calls. The
baseline reproduces main's existing price-aware reserve and 8,000-token tail;
the candidate adds preflight admission, bounded summaries and original recall.
Unique early run identifiers avoid reusing another case's full history cache.
Within-case cache reads and writes remain enabled and are included in costs.

Each case answers the same four prompts: current handoff, exact old parcel
code, permission despite a misleading old log, and a final handoff. History
contains a correction from Maya/USD 420 to Nora/USD 390. Deployment remains
unauthorized. There are 25 archive batches in the long case and 95 in the
near-window case. The latter measures 911,756 input tokens before compaction:
98.9% of the endpoint's 922,000-token input limit, although the model advertises
a combined 1,050,000-token context window.

### Actual supplier cost for the four-question sequence

| Case | Calls including maintenance | Total input tokens | Total output tokens | Total USD | Summary USD | Last answer input tokens | Last answer USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fresh, candidate | 5 | 3,539 | 282 | 0.00049490 | 0 | 899 | 0.00010740 |
| Long, baseline | 5 | 521,599 | 1,550 | 0.061353915 | 0.028180175 | 20,204 | 0.000236360 |
| Long, candidate | 6 | 325,515 | 1,217 | 0.031756910 | 0.028091050 | 21,569 | 0.000238975 |
| Near-window, baseline | 5 | 1,864,102 | 2,094 | 0.455446335 | 0.224395100 | 20,026 | 0.000228815 |
| Near-window, candidate | 6 | 994,744 | 1,922 | 0.227856370 | 0.224268100 | 20,785 | 0.000243020 |

Observed total savings are **48.24%** for long history and **49.97%** near the
input limit. These totals include the initial summary and retrieval calls.
The candidate avoids paying once for a huge actor prompt and again for its
summary. Both variants eventually compact, so their later small answers have
similar costs. This is not a tenfold savings claim for every request.

The candidate's last two ordinary answers average $0.000241565 with long history
and $0.0002440025 near the input limit, versus $0.00011305 in the minimal fresh
fixture. Long and near-window histories converge, but neither has exactly the
fresh fixture's cost. An existing near-full archive still incurs an initial
$0.22426810 summary. This one-time migration cost must not be hidden inside a
claim of immediately constant cost. This fixture has a small system prompt;
the full product carries additional authoritative context, as measured below.

### Quality and repeated growth

All five cases retained the corrected owner/budget, ticket, and deployment
restriction. The baseline retained the old P-17 code in its summary but could
not cite a retrieved original. Each candidate retrieved the original code and
returned its canonical entry ID. A public-runtime regression deliberately
omits the code from the summary and proves retrieval after SQLite restart.

The additional real-provider run reopened the near-window SQLite conversation,
checked P-5 and P-173, checked an absent P-9999, added three large new telemetry
messages, triggered another summary, and retrieved both old codes again. It
preserved Nora, USD 390, and the prohibition on deployment. The absent code
was not invented. This run cost **$0.02718289** for ten requests, including
**$0.011868425** for the second summary. The earlier restart attempt also
retrieved both sources correctly; its assertion mistakenly rejected the valid
word "absent". That vocabulary check was corrected and the full run repeated;
the earlier $0.001194695 is retained in the evidence.

The growth run reached **87,282 actual prompt tokens** at 182,702 serialized
bytes before the next compaction. This is expected for the artificial
one-letter-token padding: bytes/4 undercounts that text. The largest candidate
actor request remained below the 192,000-byte working budget. After compaction,
the actor used 33,405–34,792 input tokens. The claimed bound is on this measured
working projection, not exactly 48,000 supplier tokens.

Public-runtime regressions additionally cover source pagination, entry pages,
hidden-reasoning exclusion, cross-conversation refusal, empty/truncated summary
failure without replacing history, tool-call/result pairing during preflight,
inflated supplier usage without redundant post-response compaction, and refusal
of an irreducible current input before any supplier call.

### Real local product smoke

The isolated `wt-29683e8667b3` stack used a disposable account and ordinary Web
login, model settings and Center Agent chat. It made real Gateway calls and
persisted supplier receipts through Core. Two visible "Conversation compacted"
events occurred in the same chat. After the second, the final answer cited the
original P-17 entry, returned ALDER-9281, retained Nora/USD 390 and no deployment
authorization, and reported no P-9999 code.

The Web run recorded **13 supplier calls, $0.178376785**: one initial default
Opus call cost $0.152371, followed by 12 Luna calls costing $0.026005785. The
final retrieval used three actor calls, totaling $0.00166855, with
35,867–38,763 input tokens. Both summaries and all cache charges are included.
The first synthetic padding prompt received an unhelpful "How can I help?";
subsequent fixture messages placed the acknowledgment instruction after the
telemetry and succeeded. This is disclosed rather than treating every model
response as a quality pass. The final build's repeated-compaction and recall
path passed through Web, Core, Remote Agent and Gateway.

No production chat, service, database or deployment was changed. Source and
local smoke results do not establish production rollout.

Validation completed: the Remote Agent Node suite passed 1,324 tests (two paid
tests skipped); the subsequent image-estimation change passed 147 focused
model, submission, compaction and working-context tests, including seven
working-context boundary cases. The workerd suite passed 11 tests, the built
Core-to-Remote capability RPC test passed, and package lint/typecheck, the
Worker build, changelog validation and diff checks passed. The final text-only
paid matrix and the restarted/repeated-compaction run both passed. The later
image measurement adjustment does not alter the text-only request projection.
These checks are development evidence, not Final Candidate or release approval.

### Evidence, reproduction and limits

The sanitized [supplier receipts and answers](context-cost-2026-10-04.json)
contain request IDs, input/output/cache usage, reported costs and payload sizes.
The final matrix is run `1791086727351`; the complete restarted run is
`recall-1791086981677`. Raw SQLite databases, full stream captures, logs and the
Web screenshot remain under ignored `dev-tmp/`. No secret is included.

```sh
pnpm dev:run -- node scripts/dev/doppler-environment.mjs component remote-agent -- \
  env OPENMELD_LIVE_COST_EVAL=1 pnpm --filter @openmeld/remote-agent exec \
  vitest run tests/live-context-cost.test.ts --maxWorkers=1 --no-file-parallelism
```

For restart/growth validation, set `OPENMELD_LIVE_RECALL_DIR` to the absolute
directory of a completed matrix. It reopens and appends to that disposable
fixture database. Both paid tests are skipped by normal CI. Each process has
a 60-request / $3 conservative estimated-spend guard. Paid test wrappers only
replace Cloudflare ledger persistence; the Web smoke verifies the real ledger.

All exploratory Node experiments reported **$1.65773144**, including failed
and superseded runs. Together with Web, known reported spend was
**$1.836108225**. Eight rejected supplier requests had no cost receipt; their
cost remains unknown, not zero. Initial 100-batch trials exceeded the endpoint's
actual input maximum; the final 95-batch test stayed below it. The existing
combined-window metadata is not proof that every provider accepts that many
input tokens. Preflight does not make an already inadmissible summary free or
guarantee recovery from an archive beyond the provider's maximum input.

These are synthetic, bounded quality checks on one inexpensive model, not a
general semantic benchmark or proof of equal quality on all models and tasks.
Cache state, task difficulty, output length and retrieval work still affect
cost. The runtime recall tool performs literal search in the current canonical
generation only; cross-generation product history, Files and memory retain
their existing authorization and retention contracts. Unlimited exact recall,
semantic archive search and atomic monetary enforcement are not certified here.
The latter remains the separate billing work in PR #1475; product evidence
contracts remain with PR #1465. No parallel transcript or billing owner is added.

### Design sources and compatibility

The implementation combines bounded working history, non-destructive original
retention, on-demand reads and a recent verbatim tail. Primary references are
[Codex compaction](https://github.com/openai/codex/blob/dde5f8c5ae9b644c6882b3a48581ac317255d597/codex-rs/core/src/compact.rs),
[Aider's separate history budget](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L355-L358),
[Deep Agents' recoverable context](https://docs.langchain.com/oss/python/deepagents/context-engineering),
and [OpenCode's context preparation](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/session/compaction.ts).
These sources inform the design; their product costs or quality claims are not
OpenMeld test results. A full new harness or summary graph is unnecessary for
this bounded change. Flue 2.2.2 was inspected and still performs its threshold
check after the response; upgrading alone does not supply this preflight policy.

Flue remains the canonical history/checkpoint writer; Pi's public
`transformContext` hook is the admission seam. The maintained Flue adaptation
is documented in the adapter README and covered at its public runtime boundary.
No Core authority, database schema, HTTP/RPC/WebSocket contract, CLI or Service
protocol changed. Existing persisted checkpoints remain readable. Rollback
loses early admission and runtime recall, but does not require rewriting data.
Current permissions continue to come from Core. No scoped architecture owner
rule is violated and no local-component version or coordinated deploy order
is introduced. This Draft PR has not been merged or deployed.

## 2026-10-02 UTC: earlier price-aware threshold experiment

Real paid DEV calls through the production adapter and pinned Flue 2.1.0
compactor, using `openai/gpt-6.1-sol-pro` at the same reasoning setting in both
variants. Cloudflare-specific usage persistence is replaced by a local receipt
capture in this Node evaluation; isolated Web smoke separately covered the
normal login, Center Agent dispatch, real inference, and visible reply path.

Run the opt-in command in `../live-context-cost.test.ts`. It never runs paid
inference in normal CI. Synthetic telemetry and five fictional settled facts
are used, never production conversation data. Both variants answer the same
four prompts. The baseline uses the pre-change capacity reserve; the candidate
uses the actual route policy. Model, prompt, output cap, and recent-tail budget
are unchanged. Requests and provider-reported usage are written under ignored
`dev-tmp/cost-control/` for local inspection.

| Observation | Before | After |
| --- | ---: | ---: |
| Provider calls, including compaction | 4 | 5 |
| Total reported USD | 6.8219916 | 6.2921397 |
| Compaction reported USD | 0 | 2.4237478 |
| Last two answers, reported USD | 2.7282684 | 0.0683067 |
| Last request serialized bytes | 1,340,860 | 51,735 |
| Settled facts retained | 5/5 | 5/5 |

Observed total savings: **7.77%**, including the summary. The candidate's first
request benefited from a warmer cache: it avoided $0.285132 of cache writes.
Charging that difference to the candidate leaves **3.59%** savings in this short
sequence; this adjustment is an illustration, not a randomized cold-cache
experiment. Do not advertise the 97.5% drop in the final two requests as an
overall or production savings rate. Long continuations amortize compaction;
short conversations may not. The provider's billed prompt tokens include
internal Pro work and must not be presented as physical context length.

The initial no-cut-point control kept all older content inside one giant user
message with a short tail: Flue did not compact and no policy benefit was
demonstrated. The evaluated sequence adds subsequent history beyond the 8,000
token retained tail so there is a safe message boundary. This documents a real
limitation rather than treating the configured threshold as a hard guarantee.

All final answers retained Cedar, Maya, USD 420, CED-73, and deployment NOT
authorized. This is a bounded factual-retention check, not a general semantic
quality evaluation or a seven-day production cost prediction. Tool preview
savings are not included in this measurement; separate regression tests cover
middle-content retrieval, Unicode pages, write receipts, and Code Mode's full
internal transport budget.
