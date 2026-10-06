# Hosted harness recovery validation

## Agent Context

- Purpose: Record real compaction recovery and bounded supplier-cost evidence for PR #1535.
- Read this when: Reviewing the shared hosted harness changes or their cost claims.
- Update this when: The candidate or the scoped evidence changes.
- Do not use this for: Production savings forecasts, broad quality guarantees, or release authorization.
- Source of truth: The source identities, observed boundaries, and limitations below.

Status: Draft validation. No merge or deployment. Remove after delivery and
assessment; Git history and PR #1535 retain the evidence.

## Source identity

- Baseline: `bc2a254fe`, Flue 2.1.0 patch SHA-256 `949b369b083c7dcc8e4163f0a296a83583fd97968155e5c601c928601f75b179`.
- Initial candidate: `eab7bedb8`, patch `f0a766507751298a69598183a3c208b1c0ea29014db7e83f49ccfc1962068716`.
- Scope-note correction: patch `d55cec9f75fb795a86ace44ad38305d8cba6d4d28ffb3e9cec30359134c607f8`.

The cost experiment resolves each exact installed Flue package independently.
It uses the same provider adapter, model, reasoning level, fixture and tool
implementation. It changes the runtime patch and the candidate's headroom
setting. It does not compare different models or replay cached model answers.

## Browser recovery through real compaction

The isolated PostgreSQL lane was `wt-bc1de81408f8`. A fictional member signed
in through the normal Chrome login and sent the task through Center Agent chat.
The selected real model was `anthropic/claude-opus-5.5`. The temporary working
limit was 36,000; the normal 48,000 source value was restored afterward.

The one Computer command printed two 28,501-character blocks separated by
15 seconds, waited another 60 seconds, then printed `COMPACTION_RECOVERY_OK`.
The user prompt requested start once, list, poll, list after the second block,
and poll to completion. It requested no large-output echo.

- Submission: `918af6c8-4a2a-4f10-a1a4-3b213ab552ae`.
- Command: `173c252e-67f1-49fa-bcf5-4cb8ac3e6a34`, key `compact-live-2`.
- Observed order: one start, list, poll, compaction completed, list, poll, poll completed.
- Compaction: fixed estimate 24,394, before 40,310, after 32,509, target 28,000, hard limit 36,000.
- Result: exit code 0, final marker received, same command ID throughout.
- The browser displayed `Conversation compacted` and the final result.

This proves actual browser-to-Worker-to-Computer continuation across model
compaction. It does not prove that the original key was absent from every
summary. The deterministic Flue test deliberately omits the key and covers
that stronger recovery boundary for both Center and personal Remote roles.
The browser run predates the small scope-note correction; the later live
supplier checks and 44 focused regression tests cover that correction.

An earlier 32,000-limit calibration correctly failed admission: the required
current tool pair plus fixed context and summary still measured 32,749 after
compaction. This was not counted as a successful smoke. Its failed outcome was
visible, and command cleanup was requested. Lowering a test threshold below
irreducible context is not a valid way to test continuation.

## Small live cost comparison

The measured model was `openai/gpt-6-luna`, low reasoning, maximum output 4,096.
Each run used a separate SQLite conversation. Fictional history was seeded
through public Flue dispatch with a faux provider; measured decisions,
summaries, and answers used real Gateway inference. Only cloud usage-ledger
persistence was replaced for the Node experiment.

History established Cedar, owner Maya, USD 420, ticket CED-73, and no deployment
permission. Four equal archived-note batches followed. The last correction
set owner Nora and budget USD 390, preserving ticket and prohibition.
The task then requested ten sequential `read_batch` calls. Each returned its
number, a verified code, and 250 repetitions of the same non-actionable note.
The fixture rejected duplicate or out-of-order reads. Final answers had to
preserve current owner, budget, ticket, permission, first/last verified codes,
and ten completed batches. These are bounded factual checks, not a general
answer-quality score.

Both variants used a 20,000 working limit, 8,000 recent tail, 4,096 summary cap,
and 8,192 reserve. The candidate additionally used 8,000 headroom. These reduced
working limits make the experiment inexpensive; they are not production policy.
Each run allowed at most 32 provider requests and 300 KB per request.

The initial order was before, after, after, before. Supplier `usage.cost` includes
summary calls and is reported in USD. Total tokens include cached prompt tokens.

| Run | Model calls | Summary calls | Total tokens | Reported USD | Wall seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before 1 | 15 | 4 | 95,001 | 0.007840715 | 62.096 |
| After 1 | 12 | 1 | 106,035 | 0.005091465 | 35.609 |
| After 2 | 12 | 1 | 107,528 | 0.005606800 | 43.985 |
| Before 2 | 15 | 4 | 94,336 | 0.007562710 | 53.966 |

Across these two pairs, reported cost decreased about 30.5%, while total tokens
increased about 12.3%. Fewer summaries and more cached input explain why token
volume and dollars moved in opposite directions. This is a small controlled
example, not a prediction for production Pro tasks or customer margins.

All runs completed ten distinct reads and retained the required final facts.
However, After 2 added a false statement that batches 4–6 had been read twice.
There were ten successful reads, eleven agent model calls and no extra tool
execution. The checkpoint already counted six reads while original messages
for some of those reads remained in the tail. This is evidence of a reporting
error, not duplicate execution.

The initial automated permission matcher also failed to recognize the valid
wording `Deployment authorized: No`; manual inspection separated that matcher
error from the actual false-duplicate claim. The failed run remains in the table.

## Scope-note correction and follow-up

Canonical evidence now explicitly says its counts include retained original
messages. It tells the reader not to add those counts again or infer duplicate
execution from seeing both representations. The note is inside the existing
bounded evidence allowance. It adds no model call or separate history store.
The existing repeated-compaction test verifies the scope and unchanged counts.

Two additional live runs used that correction and the same inputs:

| Run | Model calls | Summary calls | Total tokens | Reported USD | Wall seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scope note 1 | 12 | 1 | 99,941 | 0.005161555 | 42.147 |
| Scope note 2 | 12 | 1 | 99,789 | 0.005092560 | 35.505 |

Both completed ten distinct reads, preserved all required facts, and did not
claim duplicate reads. These are follow-up checks, not extra cross-ordered
pairs or proof that every model will avoid this mistake. The original four-run
comparison remains unchanged rather than replacing its unfavorable answer.

An earlier calibration with a 1,024-token summary cap failed because the old
runtime's summary exhausted that cap. Formal runs used the production 4,096
summary cap on both sides. The calibration is excluded from savings calculations.

## Acceptance boundary

No production execution was stopped or retried. Test thresholds were restored,
and the owned localhost stack was stopped. Runtime ownership and cross-process
contracts remain as documented in the PR. This follow-up only clarifies the
existing canonical evidence projection; it introduces no new authority.
