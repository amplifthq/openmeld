# Space-memory candidate: October 30, 2026

This is local implementation and development-provider evidence for #340. It is
not merge, deployment, historical backfill, or closure of the full memory design.
The initial five-case baseline remains unchanged in `RESULTS.md`.

## Implemented boundaries

- Completed, verified member-attributed messages to Center Agent can enter a
  separate Space subject. Core reopens the original message and preserves its
  version and author. Generated replies are not rewritten as human statements.
- Capture and recall use the existing Organization enabled policy. Space recall
  is restricted to the current authorized Space and rechecks supporting source
  versions and author kinds. Member and Organization subjects remain separate.
- Explicit OpenMeld saves require a current source reference and an exact excerpt;
  the original author and source-version time replace attribution to the later
  save request. A stale rewritten summary is rejected before provider ingestion.
- Whole facts share the existing 1,600-character budget. Oversized facts are
  omitted with a visible omission flag; conditions and negations are not clipped.
- Superseded matches retain structured validity information. Verified later
  supporting messages can accompany the historical facts, and mixed speakers
  receive source grounding. These excerpts and speaker identities come from the
  owning Space and remain historical evidence, not an adopted rule or permission.
- Permanent Space purge fences new captures and erases the provider graph before
  clearing source storage. A controlled late write is cleaned up; account erasure
  recognizes Space subjects. Ordinary Space deletion follows retained-history
  policy and is distinct from permanent purge.

## Six-case provider run

Run: `memory-baseline-559cc5b9-0309-4333-a45b-b5b576e16d15`.
The first five case texts and expected answers match the initial baseline. A
sixth independent control checks that unrelated remembered work does not replace
the canonical current goal. Each cell is one observation.

| Case | No memory | Candidate pipeline | Verified context |
| --- | --- | --- | --- |
| Confirmed identity | Target missing | Correct | Correct |
| Corrected build rule | Target missing | Builder missing | Correct |
| Repository continuation probe | Target missing | Correct | Correct |
| Current Task over history | Correct | Correct | Correct |
| Bounded search is not absence | Correct | Correct | Correct |
| Current goal over unrelated memory | Correct | Correct | Correct |

The comparable five-case pipeline result improved from 2/5 to 4/5. This is a
diagnostic sample, not a production accuracy estimate. Capture now submitted
the identity, all three rule statements, and both repository statements to their
Space subjects. The reconstructed stale explicit save returned
`source_excerpt_mismatch` without an Organization-memory write.

All 18 model calls completed. Reported inference cost was USD 0.01193615.
Eight isolated graphs and fourteen episodes were used, and all eight graph
deletions were acknowledged. Zep billing is not exposed by this adapter.

## Remaining rule case and source-grounding replay

The provider returned a superseded handoff fact whose provenance included the
latest original message. Core fetched that message to verify its version but
discarded its text. The top-six semantic facts did not identify the new builder.
The model correctly returned `builder=unknown` from that incomplete context.

`fixtures/superseded-rule-search.json` contains the actual synthetic provider
response and episode records from that run. A deterministic regression now
replays them through the real adapter and Core assembly, proving that the later
source text reaches the model without increasing the context budget. No new
provider query or altered retrieval result is needed for this intervention.

A two-call inference comparison was attempted. Its original runner mistakenly
used Vitest's default 5-second timeout: the old-context result was saved, while
the second request may have been sent but its result was not recorded. It was
treated as possibly consumed, not silently retried. The runner now has a
150-second outer deadline and records a request-start marker before each call.
The user separately authorized one replacement for the new context, using the
same system prompt as the completed control and the already-prepared input.

| Field | Old context | Source-grounded context | Existing expected value |
| --- | --- | --- | --- |
| builder | unknown | center_agent | center_agent |
| needsBuildDecision | false | true | false |
| createIssueFirst | true | true | true |
| humanReview | true | true | true |

The original rule rubric therefore **still does not fully pass**. Do not report
this as a six-case green result or change the expected value after observing it.
The latest rule and its conditions are now present, and the builder is recovered.
The remaining flag needs an evaluation that explicitly separates knowledge of
the recorded rule from present execution permission. Its current ambiguity is a
hypothesis to investigate, not proof that the model answer is correct. No prompt
or authorization policy was weakened to force the flag to false.

The replay's verified sender originally omitted the public `profileId`, although
the source messages carried it. This simplified fixture cannot establish the
model's interpretation of the source author's current authority as faithfully as
a normal admitted envelope. Subsequent local fixtures now share one profile ID
between requester and source author. No further live inference was run after that
fixture correction, and none of the recorded outcomes above is regraded as a pass.

Confirmed additional inference costs: USD 0.00267045 for the completed old-context
control and USD 0.00262860 for the authorized replacement. The interrupted call's
cost is unknown. Confirmed cost for this implementation phase totals
USD 0.01723520, excluding that unknown call and Zep processing.

## Evidence limits and next work

Local verification completed:

- 48 focused Core cases; the opt-in inference replay is skipped in that ordinary run.
- 9 Space-memory cases and 12 source-origin cases against disposable PostgreSQL.
- 14 existing native-delivery memory cases.
- 115 Remote Agent submission/prompt cases and the exact source-reference forwarding case.
- Core and Remote type checks, 58 affected build/static-check tasks, database
  migration checks, Changelog validation, and whitespace checks.

The release-readiness command built 23 local-component tasks successfully and
reported that CLI and Service artifacts change transitively. Version `0.3.281`
is already published; a releasing PR must bump it and record the CLI/Service
update decisions in `release/local-components-policy.json`. This is a release
integration requirement, not evidence of publication. These observations were
recorded before PR preparation. Current commit and review status belongs to the
owning Draft PR; no production migration, deployment, or published Changelog
entry is evidenced by this report.

The local replay models source access; it is not a production Agent/tool-loop
smoke. Separate temporary-PostgreSQL regressions exercise the subject registry,
scope isolation, policy changes and late-write erasure. Production source and
provider data were not read or changed. Existing historical mistakes are not
automatically backfilled or erased.

The data-path changes are available for review. Full rule adoption, semantic
applicability, repeated confirmations, large-corpus retrieval, and reliable model
use remain separate #340 work. The unresolved rule metric and lack of a production
rollout must remain visible in delivery reports. Do not infer authority from a
remembered statement or automatically promote every message into a Space Guide.

Local ignored evidence paths:

- `dev-tmp/memory-baseline/memory-baseline-559cc5b9-0309-4333-a45b-b5b576e16d15/report.json`
- `dev-tmp/memory-grounding/1793370647369/report.json` (completed control)
- `dev-tmp/memory-grounding/resume-source-grounded-request.json`
- `dev-tmp/memory-grounding/resume-source-grounded-result.json`

Tracked tests use the captured synthetic fixture, never these temporary outputs.
