# Center Agent empty-response recovery

## Agent Context

- Purpose: Record the incident evidence and bounded reply-recovery implementation.
- Read this when: Reviewing Center Agent empty-response recovery for issue #923.
- Update this when: Implementation or validation changes the supported recovery behavior.
- Do not use this for: Production execution truth or release authorization.
- Source of truth: Runtime traces establish the incident; the Remote Agent runtime owner document defines shipped contracts.

Status: implementation in progress, September 13, 2026. Nothing has been deployed.

Remove this document after recovery is delivered and its lasting contracts and evidence are retained in owner documents and the pull request.

## Product result and responsibility

### Error presentation review

GitHub's [Copilot troubleshooting guidance](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/troubleshoot-copilot/troubleshoot-common-issues?tool=webui)
places resubmission under the affected chat response. Claude's
[error guidance](https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages)
distinguishes capacity, usage limits, and input length with cause-specific next
steps. These are documented behaviors, not a visual audit of those products.

OpenMeld keeps recovery beside the affected request and uses the existing Local
Wake system Marker divider for system outcome rows. A runtime failure must not
impersonate an Agent reply. Actual Agent-authored failure explanations keep the
normal speaker and bubble; text matching never determines message provenance.
The empty-reply notice names Center Agent and preserves the saved-message fact,
without asserting an unproven provider outage. Recovery eligibility and its
action remain Core-owned; changing presentation does not authorize another Wake.

A member should send a request once and receive a useful answer or a clear account of what completed and what could not. Recoverable model failures should normally be absorbed within that request. Members should not have to interpret an empty model completion, find diagnostics, or repeatedly resend the same message.

The originating fault and product responsibility are separate. The current incident does not establish whether a serving provider, OpenRouter, or OpenMeld's model adapter lost the answer. OpenMeld nevertheless owns recovery, model integration, default-model quality, request preservation, truthful presentation, and operational detection.

The reported conversation had three consecutive terminal failures on September 12 at approximately 23:14–23:16 Asia/Taipei. Published CLI traces and authenticated Web history agree: each used `z-ai/glm-5.3-flash`, made one outbound provider request, received response headers, completed without recorded assistant text, made zero tool calls, and did not exhaust the tool-call budget. Failure notices were successfully published. The previous two requests in the same conversation succeeded. One outbound request does not establish the number of OpenRouter's internal provider attempts.

These are empty-answer failures, not ongoing work or missing browser rendering. This evidence does not prove a normal provider `stop`, absence of reasoning, absence of content-filtering, token exhaustion, or a particular adapter defect.

## Baseline gaps before this change

Source was checked in the current checkout and corresponding files at `origin/main` (`57238f0d4cf81abe8bcffb4888a660a7b4e308da`), rather than assuming the dirty checkout represents deployment.

1. **Recovery covers a narrow event shape.** `services/remote-agent/flue-adapter/provider-stream-retry.ts` retries once only for `done(stop)` with no meaningful text/thinking/tool content and no preceding event other than `start`. Any intermediate event or reasoning-only completion disables that retry. Tests explicitly preserve those restrictions. This is existing behavior, not a missing retry library. The three incident requests did not record a second outbound request; their precise exclusion condition remains unknown.
2. **No final text collapses to one error.** `services/remote-agent/flue-adapter/stream-observer.ts` converts a non-error completed prompt with no assistant text into `remote_agent.empty_assistant_response`. The product outcome is correctly unsuccessful, but that outcome alone cannot explain why generation stopped or decide recovery.
3. **The user is sent into a retry/diagnostics loop.** `packages/schemas/src/public-agent-failure-reason.ts` says “Center Agent didn't return a reply. Try again. If it keeps happening, open diagnostics in OpenMeld.” This describes a symptom and transfers diagnosis to the member. No additional change in conditions is explained when it repeats.
4. **A failure can appear as a reply.** The inspected failure message's Web details showed `Replied`. The ordinary reply paths in `clients/web/src/components/spaces/space-message-details-presentation.ts` assign `replied` to text replies. The final trace simultaneously records `visible_failure`. A correction must project the authoritative outcome into the existing shared presentation, not match error text or create a second failure ledger.
5. **Exact generation evidence is not readily available to the diagnostic operator.** PR #931 added provider completion logging and was verified merged. Its deployment was not established here. Live reads of both Workers Observability and AI Gateway logs returned HTTP 403 / Cloudflare code 10000 using the current Wrangler OAuth identity. This is an access gap, not evidence that the logs are empty. Standard traces retained no raw/normalized finish reason, provider response ID, or reasoning/token counts for these turns.

## What providers and SDKs actually guarantee

- OpenRouter explicitly documents no-content responses during cold starts/scaling and recommends retry or another provider. It also documents HTTP 200 before output and errors inside the response stream. A successful HTTP status alone is not a usable completion. [OpenRouter errors](https://openrouter.ai/docs/api/reference/errors-and-debugging)
- Reasoning, final text, tool calls, and terminal reasons are different facts. Z.ai documents separate reasoning and content fields and reasons including length, tool calls, filtering, context limits, and network errors. Tool-only output is valid intermediate work. [Z.ai Chat Completions](https://docs.z.ai/api-reference/llm/chat-completion)
- Reasoning consumes output budget. OpenMeld currently requests high reasoning with a 16,384-token output limit for GLM 5.3 Flash; actual token usage is required before blaming this setting. Do not assume that disabling reasoning is supported by the exact Flash route. [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- OpenRouter has native same-model provider routing and restrictions for parameter support, provider eligibility, retention, and price. OpenMeld already sends `allow_fallbacks: true`; that is not a guarantee to recover a completed-but-empty response or reroute after output has begun. [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [errors](https://openrouter.ai/docs/api/reference/errors-and-debugging)
- OpenRouter's separate model-fallback feature is not a general semantic-answer validator. An explicitly chosen model and its privacy/capability constraints must not silently change. [Model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- Provider zero-completion insurance is narrower than a failed user outcome. Billed reasoning without a visible answer is not automatically refundable under its documented conditions. Keep real provider usage for operations; decide user-facing failed-attempt charges separately. [Zero completion insurance](https://openrouter.ai/docs/guides/features/zero-completion-insurance)

Installed dependencies are pi-ai 0.83.0 and Flue 2.0.3. Their native request/assistant retry and durable continuation facilities should be used before adding another retry loop. pi-ai's transient-error retry does not classify a successful empty `stop` as an error. The registry reported pi-ai 0.85.1 and Flue 2.0.5 as current stable versions. pi-ai 0.84.3/0.84.4 include relevant OpenRouter reasoning metadata/replay fixes, alongside other releases with breaking interfaces. They are upgrade candidates, not a demonstrated fix for this incident. [pi-ai changelog](https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md), [adapter source](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts)

## Recommended recovery contract

Keep recovery before terminal settlement, owned by Remote Agent's existing provider/harness integration. Preserve the same admitted request, destination, authorization, cancellation and publication identity. Do not implement recovery by sending another user message or re-enqueuing the entire workflow.

| Classified result | Recommended action | Required boundary |
| --- | --- | --- |
| Completed empty or whitespace-only, no tool event or published answer | One bounded automatic inference retry; use eligible same-model routing | Retain attempt lineage and usage; stop on cancellation; one owner controls the limit |
| Only hidden reasoning, no tool event or published answer | Treat as missing final answer; consider bounded inference recovery after validating the terminal reason | Reasoning is not user delivery; revise the current no-content-event contract explicitly |
| Length/context exhaustion | Correct supported output/context handling or continue through the harness's existing durable state | Repeating the identical exhausted request is not recovery; never blindly truncate tool history |
| Valid tool call with no prose | Execute the validated authorized tool and continue normally | Complete arguments and ordinary tool authority remain mandatory |
| Transient transport/provider error | Existing bounded native retry where eligible | Honor backpressure, cancellation and retry budgets across layers |
| Prior tool effects or partial published output | Recover only the next inference/continuation from recorded results | Never replay an already sent message, file mutation, or unknown external effect |
| Refusal/filtering, invalid credentials or deterministic unsupported configuration | Accurate classification and a relevant product action | Do not treat a refusal as availability trouble or route around policy |
| Recovery exhausted | One truthful failure state with a usable action | No endless working state, duplicate failure messages, or claim that no actions ran without evidence |

A bounded retry is a starting policy, not an availability guarantee. Measure its success before increasing attempts. Track actual serving provider and route configuration; repeated failures should alert operators and inform native provider exclusion/ordering. Start with native routing and operational response rather than inventing a new distributed circuit breaker without data.

For an OpenMeld-managed default, an evaluated alternative model can be part of an explicit reliability policy. For a member's explicit model choice, preserve the selected model or obtain the product-defined opt-in to alternatives. Both paths must retain tool capabilities, context compatibility, privacy, quality and cost limits. The current `automaticModelFallback: false` contract remains in force until deliberately revised.

## User-facing behavior

The original message and attachments remain in place. During a real automatic recovery, retain the normal working state; only a noticeable delay needs “Taking longer than usual. Trying again…” and a working Stop action. Do not show a failure before recovery is exhausted.

After automatic recovery is exhausted, use “Center Agent couldn't generate a reply. Your message is saved.” with one contextual primary action. The implementation uses **Continue conversation** only when Core verifies the saved exact hosted conversation. It does not resubmit the original user request: the continuation has no tools, Computer sandbox, or executable Skills. If that continuation fails, the original failure no longer offers another execution. Unknown publication or connectivity outcomes offer a read-only status check.

Repeated failures must not return the member to the same unchanged loop. A permitted alternative model or a truthful service-unavailable state is preferable, with a direct support action when needed. Error IDs belong under `Details`. If the product says an issue was reported, the report must have a real receipt; automatic operational detection must not fabricate user-submitted Diagnostic Reports.

The baseline writing review blocked the old empty-reply error and `Replied` classification: the former hid recovery and the latter contradicted the failed outcome. The draft implementation corrects both; production still requires deployment and verification.

## Implementation and evidence order

1. Retrieve the three exact provider completion/generation records through an authorized observability identity. Compare actual provider, response ID, raw/normalized stop reason, reasoning/text/tool counts, token limits/usage, and event sequence. Confirm the deployed adapter version. Persist a small redacted evidence projection, not private prompts or hidden reasoning.
2. Compare captured records through installed and candidate SDK versions. Upgrade first if the official implementation fixes the relevant contract more simply. Do not assume a release-note resemblance proves the cause.
3. Correct the existing inference recovery boundary and shared failure projection together with their owner contracts. Preserve cancellation, publication fencing, tools and usage. Carry historical failed attempts even when recovery succeeds.
4. Exercise representative externally grounded cases: empty/whitespace, reasoning-only, length, refusal, truncated SSE, valid tool-only output, recovery success/exhaustion, stop during recovery, and failure after a recorded external effect. Prove no duplicated tool effects or messages. Then verify the full authenticated UI flow with retained input and an executable next action.
5. Evaluate usable-answer rate, recovered-failure rate, repeated failures, added latency, provider cost and user impact by actual provider/model/configuration. Do not present these three incidents as a global GLM failure rate.

## Draft implementation and evidence

Draft PR #969 implements the bounded inference retry, restricted exact-conversation
continuation, operational classification, and honest failure/recovery UI. Each
inference retries at most once, before any visible text or tool event; reasoning
and whitespace buffering is bounded, cancellation is retained, and both attempts'
usage is accounted for. The retry-start deadline does not fail an active inference.
Explicit model selection remains unchanged; native same-model routing is reused.
Non-deliverable completions are failed execution-stage metrics and structured
warnings, with distinct recovered and recovery-exhausted operations. This change
does not create an alert delivery resource or claim an operator was notified.

Focused validation covers provider stream boundaries, capability removal,
callback persistence, durable hosted submit/publication, recovery projections,
historical failure presentation, and status-check recovery without another
execution. Authenticated local browser inspection confirms that a seeded historic
empty-response message is shown as a saved-message failure, its Message details
say **Failed**, and **Send report** remains available. This fixture is UI evidence,
not proof of a live model recovery. Production provider records remain unavailable
under the current log identity; upstream attribution and live recovery rate remain
unproven. No production deployment or full model-backed browser continuation has
been performed.

Architecture assessment: the scoped owner documents explicitly revise the
invisible-output retry rule and permit restricted hosted continuation. Core remains
the native-delivery/publication owner, Flue remains the durable execution owner,
and shared schemas own the cross-boundary recovery policy. RuntimeCoordinator and
workstation execution authority are unchanged. No conflicting architecture rule
was identified. The mixed-version order and rollback constraint are recorded in
`developing/architecture/shared-contracts.md`; no local component epoch or release
is needed.
