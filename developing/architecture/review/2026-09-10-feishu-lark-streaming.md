# Feishu and Lark live-answer streaming

## Agent Context

- Purpose: Record the first third-batch implementation and native acceptance.
- Read this when: Reviewing the stream path or continuing channel productization.
- Update this when: The slice is released or native acceptance changes.
- Do not use this for: Authorization to release or claims that all third-batch capabilities shipped.
- Source of truth: Runtime owner documents define durable behavior; this file records evidence.

Status: implemented and locally verified, not deployed.
Remove when this slice is released and its acceptance evidence is preserved in the PR.

## Root cause and correction

Core already implemented CardKit 2.0 creation, updates, segmentation and terminal
publication. Remote Agent's eligibility predicate admitted only `space_wake`
and `web_dm`, so actual Feishu/Lark observations never reached those updates.
The previous product audit incorrectly treated the existence of the provider
implementation as an end-to-end streaming capability.

Admit `message_channel` text to the existing callback owner. Publish the first
words immediately and coalesce later full snapshots at 350 ms. Flush the tail
before a tool starts and before terminal publication. Do not send Web-only tool
parts to a receiver that suppresses them, or count those parts as visible text.
Thinking and checkpoint stop prose retain their existing privacy boundaries.
CardKit uses a fast 30 ms / 3-character print configuration so its animation
does not needlessly trail the generated answer.

Native smoke also exposed a terminal race: the final publication can claim the
same card while its last streaming PUT is in flight. Its higher sequence already
owns the full answer. When the streaming receipt loses its fence, reread the
canonical ledger and acknowledge a proven final owner instead of logging a
provider failure or reopening progress. Missing authority is never accepted.

## References

- [Official Feishu streaming guide](https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview.md): full text snapshots, fast print strategy, 10 mutations per card per second, explicit terminal streaming mode.
- Existing Agents Router source `src/providers/feishu_lark.rs`: bounded 350 ms progress coalescing and CardKit publication. Used as a reference; no source copied.
- Lark uses the shared adapter with its own host and protocol tests. The separate Lark streaming-guide URL returned 404; do not claim independent Lark documentation or native conversation acceptance from Feishu evidence.

## Evidence

- Regression before the fix: both Feishu and Lark observer cases made zero stream callbacks.
- After the fix: real Flue-shaped text observations publish before prompt completion, batch later snapshots, and flush text before a tool without publishing unsupported tool parts.
- Remote streaming/observer tests: 49 passed. Core stream/provider boundary tests: 37 passed, including a real SQLite final-claim race reproduced before its correction.
- Native Feishu local bot `OpenMeld Local Smoke 864`, lane `wt-d3ba22003165`, received `PHASE3_STREAM_A`. The same card was observed with only the introduction, then through part of section two, then as a complete five-section answer ending `PHASE3_STREAM_END`.
- Screenshots and AX observations: task worktree `dev-tmp/phase3-stream-smoke/03-stream-sample.*`, `04-stream-growth.*`, and `05-final.*`. These are actual native-client observations, not a simulated HTML card.
- The terminal-race correction was validated at the SQLite/provider boundary after that smoke. It does not relabel the earlier warning as a clean first attempt.
- No Lark conversation test: the user's account limitation remains. No production deployment or production Smoke in this slice.

## Contract and next scope

No wire schema, database migration, credential scope, SDK dependency, or
execution owner changes. Existing Core already accepts message-channel text
callbacks; deploy Core's race correction before enabling the Remote Agent
producer. Normal result placement remains frozen by Native Delivery. This
does not violate the scoped architecture ownership rules.

The third batch also retains typed task actions, current-chat Routine
destinations, separately consented business Apps, and richer workflow cards.
Those remain distinct pending capabilities. This streaming correction does not
claim to implement them or authorize automatic business access.
