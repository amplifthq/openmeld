# Initial memory baseline: October 30, 2026

Issue: [#340](https://github.com/amplifthq/openmeld/issues/340).
Runtime source: `409b7d48d3c6f210247a78f61a78cc0ef4a83b32`, with new local
evaluation files only. Production behavior was not changed or reverified.

## Experiment

Five sanitized cases, three model arms per case, one observation per arm.
The real model was `z-ai/glm-5.3-flash` through the development OpenRouter smoke
key. No fallback model was used. The same system message and question were used
within each comparison; only the memory/reference intervention changed.
See `README.md` for the exact boundaries and reproduction commands.

| Case | No memory | Current pipeline | Verified context |
| --- | --- | --- | --- |
| Confirmed external identity | Unknown; target not recovered | Unknown; target not recovered | Correct mapping |
| Stale explicit rule save | Target not recovered | Old pending decision retained | Correct latest rule |
| Terse repository continuation | Unknown; target not recovered | Unknown; target not recovered | Correct repository |
| Current Task versus historical failure | Correct current state | Correct current state | Correct current state |
| Bounded search versus absence | Correct limitation | Correct limitation | Correct limitation |

This is target attainment in a bounded factual probe, not a production success
rate. Honest unknown answers in an information-deprived arm are not evidence of
bad model reasoning. The boolean fields in the rule probe do not offer an unknown
value; use the whole answer and evidence when interpreting that case. The experiment
does not measure actual repeated clarification turns, tool choice, or task completion.

## Attribution supported by this run

**Capture is a demonstrated information gap in the replay.** The identity and
repository corrections produced zero provider writes under the existing shared
conversation policy. The three corrected rule turns likewise produced no writes;
only the separately reconstructed stale explicit summary was submitted. These are
current-code observations, not historical production ingestion receipts.

**The content selected for storage matters before Zep runs.** On the stale-summary
input, Zep returned the supplied “build decision pending” fact. The current model
answer preserved that outdated conclusion. The raw historical write payload is
unavailable, so this supports the upstream-input mechanism without proving that
the original production save had exactly this payload.

**Zep successfully extracted and retrieved useful facts from complete sources.**
In separate source-intervention graphs, it returned the confirmed identity and
the corrected repository. For the rule sequence, the original question returned
the latest self-build rule; older handoff facts carried invalidation/supersession
timestamps. These interventions bypassed capture policy only in the experiment.
Their results were inspected at the provider/adapter boundary; they were not a
fourth model arm or an end-to-end success claim.

**Query improvement is not established by this sample.** The one-word continuation
still retrieved the repository correction from its very small intervention graph.
For the rule sequence, the manually focused query returned six facts but omitted
the latest builder fact that appeared for the original question. This is a concrete
ranking/selection limitation to investigate with a larger controlled corpus, not
evidence that every richer query helps or that the fact was absent from Zep.

**No filtering or budget loss was observed on the live retrieved candidates.**
Eight searches returned 34 raw facts and 34 adapter items. The two populated
baseline memory envelopes were 672 and 423 characters, both untruncated. Search
plus provenance reads completed below the normal 3-second recall deadline.
This does not clear unexercised access-revocation, source-limit, large-corpus, or
contention cases.

**A separate context-budget control demonstrates a possible loss mechanism.**
A supplied long fact included a late exception qualifier before projection;
the qualifier was absent after the real envelope budget was applied. This was a
constructed boundary intervention. It was not the cause of the live baseline
misses and establishes neither incidence nor benefit from simply raising limits.

**The model could use the manually verified evidence in all five bounded probes.**
That supports investigating missing/wrong input before assuming an intrinsic
model-use failure. One observation per arm does not establish reliability, and
the real Agent's tool-selection and continuation behavior remain unmeasured.

## Resources and cleanup

- 15 model requests completed without provider errors.
- Provider-reported inference cost: **USD 0.01014196**; all 15 responses supplied cost.
- Token usage: 250,078 prompt tokens and 449 completion tokens. Cache effects are
  included in provider billing; token counts are not a cost estimate.
- Five isolated Zep graphs were created and eight episodes submitted. All eight
  possible run-owned graph targets received successful idempotent deletion responses,
  including the three baseline subjects never created because capture was empty.
- Zep processing cost is unavailable from the adapter and is not included above.
- No production memory, installed Service state, real messages, issues, or Tasks
  were read or modified by the experiment.

The ignored local run directory retains `report.json`, `analysis.json`, and
`run-source-manifest.json`. The raw report is preserved. Its initial processing
summary labeled an empty receipt list as processed with zero polls; `analysis.json`
explicitly treats those rows as **not applicable**, and the runner was corrected
for future reports. Adapter warning collection was also retained for future runs.
Those reporting corrections did not trigger further external calls.

## Next decision

Prioritize the contract for capturing and updating confirmed knowledge from shared
collaboration, including the provenance of a summary chosen for an explicit save.
Keep current authoritative rules, identity, work targets, and Task records with
their owners. Evaluate task-aware retrieval and semantic projection next using
contrastive cases and realistic distractors. This run provides no basis for an
immediate provider migration, blanket automatic organization capture, a higher
global context limit, or a production prompt change.

The first evaluation baseline is available; the broader design and acceptance
scope of #340 remains open.
