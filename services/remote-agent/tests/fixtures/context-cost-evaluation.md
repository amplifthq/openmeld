# Context cost evaluation — 2026-10-02 UTC

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
