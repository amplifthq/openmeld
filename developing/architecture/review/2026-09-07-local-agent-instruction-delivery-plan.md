# Local Agent Instruction Delivery Inventory and Plan

## Agent Context

- Purpose: Classify existing workstation Wake inputs and define the smallest safe improvement to instruction delivery.
- Read this when: Implementing instruction separation or evaluating Codex dynamic tools for local agents.
- Update this when: A listed provider capability is verified or the implementation scope changes.
- Do not use this for: Production authority, a release approval, or a claim that provider lifecycle behavior has been tested.
- Source of truth: This document owns this review and proposed sequence only; the linked owner documents remain authoritative.

Status: SELECTED LOCAL SCOPE COMPLETE — local implementation and real Codex/Space experiments authorized by the user on 2026-09-08. No commit or release is authorized. See [local experiment results](2026-09-08-local-agent-instruction-spike-results.md) for the selected scope, evidence, and unadopted options. The broader matrix below is not an instruction to migrate unchanged carriers or execute a stale roadmap.
Remove when the selected changes ship and durable decisions are incorporated into the owner documents, or when this proposal is superseded.

## Outcome and evidence boundary

Keep OpenMeld operational guidance distinct from user-authored work, reduce redundant instructions, and preserve the user's native agent behavior and conversation continuity. A clean transcript is not the same as an empty model context or an instruction that automatically expires.

### Primary acceptance priority: return the result to the Space

User emphasis, 2026-09-08: agents repeatedly finish reasoning without using the supplied tool or supported method to return their result to the Space. This is a reported recurring failure mode, not a newly reproduced incident in this review. Successful reasoning or a private final answer is not successful completion of the main user journey.

Treat reliable Space outcome delivery as the highest-priority instruction objective, ahead of prompt brevity, token savings, or response speed. Make the required completion action salient and unambiguous: choose the action permitted by the current Space contract, supply the actual intended result, inspect the tool response, and follow the supported recovery path on failure. Preserve status-only, intentional-silence, and explicitly supported raw-reply contracts; do not force a public message where the contract forbids it. An action proposal acknowledgement is not proof of final publication.

Diagnose the failing boundary before selecting a correction. Missing/wrong tool choice or premature prose-only completion requires instruction and tool-discoverability work. Tool registration, execution, acknowledgement, result transport, or publication failures require a system correction at their owner. Prompt emphasis must not conceal infrastructure failures or substitute for deterministic action validation and recovery.

Compare old and new instructions on first-attempt valid completion-action rate, reliance on repair, and eventual correct visible Space outcome. Include long reasoning/tool-use tasks and resumed conversations, where the final delivery obligation can be lost. Preserve concise explicit completion guidance when consolidating duplicates; do not optimize it away merely to shorten the prompt. Investigate every missing-result case in the comparison rather than averaging it into general output quality.

Initial inventory baseline: `59c490bfb728debebc39f1f2403c8d7c89010edd`. Implementation started from freshly fetched `origin/main` at `7ba073872`, in an isolated worktree; unrelated Web changes were excluded. Local Codex protocol version inspected: `0.150.1`. Locked SDKs: Claude Agent SDK `0.3.195`, OpenCode SDK `1.18.7`. These do not establish versions installed on other computers.

OpenClaw comparison is pinned to `5bf5dc9c5be8366f99e0291c01cd3aafb7ab5a4a`. Documentation and acpx main are moving references. This is source/protocol review, not a real-provider behavioral certification or a reproduction of the screenshot's session.

Owners:

- [Local Service: Agent Instruction Delivery](../local-openmeld-service.md#agent-instruction-delivery)
- [Shared contracts](../shared-contracts.md)
- [Agent transport](../agent-transport-contract.md)
- [Space collaboration](../../product/space-collaboration.md)
- [Delivery lifecycle](../../engineering/agent-native-delivery.md)

## Decisions

1. Do not put all OpenMeld-delivered content in developer instructions. Transport origin does not promote user-authored content into application authority.
2. Keep one provider-neutral content owner. Adapters select supported carriers; they do not rewrite policy or maintain a second policy copy.
3. Use existing native instruction channels. Do not replace base model instructions, user configuration, project files, or conversation identity to make the transcript cleaner.
4. Separate instruction lifetime from API request lifetime. A field on `turn/start` is not proof of automatic expiration. Test omission, replacement, resume, fork, and direct user continuation where relevant.
5. Include a bounded Codex dynamic-tools experiment in this work. Keep MCP as the established production transport until comparison proves a benefit. Do not expose duplicate action tools or automatically replay an outcome-ambiguous call through another transport.
6. Keep authorization, execution, and publication in their existing programmatic owners. Prompt text and tool descriptions are guidance, not enforcement.

## Current path

`execute-dispatch-task.ts` supplies dispatch facts to `buildDispatchPromptPlan` in `parse-dispatch-task.ts`. The plan contains stable developer instructions, a content-derived epoch, a shorter user prompt, and a complete fallback. File-access awareness may extend the stable instructions and recompute the epoch. The local execution orchestrator forwards the plan to the adapter.

Codex installs stable instructions at thread creation and selects the shorter prompt only when the returned source marker matches. Claude appends stable instructions to its native preset; OpenCode sends a separate `system` field; OpenClaw Gateway sends `extraSystemPrompt`. Cursor, Grok Build, and CLI fallbacks use the full prompt. A completed run may enter a bounded delivery repair or concurrent-reply reconsideration path with replacement user input.

### Content inventory

Source paths below are repository-relative. Names identify current producers, not proposed new abstractions.

| Content and current producer | Current placement | Decision and scope |
| --- | --- | --- |
| OpenMeld collaboration definition, `buildDispatchPromptPlan` | Stable instructions and eligible Entry Brief | Keep one canonical text. Emit once when native stable delivery is proven; preserve complete meaning in fallback. Scope guidance to OpenMeld work, not the agent's entire identity. |
| Built-in information protection, `packages/agent-runtime/src/information-protection-prompt.ts` | Stable instructions | Preserve semantics and shared owner. Do not redesign privacy policy in this task. |
| Organization-maintained protection text, same module | Per-dispatch input with classification-only framing | Keep as bounded, attributed policy data. Preserve the application rule about its limited effect; never promote arbitrary embedded commands. |
| Language decision rules, `working-language-prompt.ts` | Stable instructions | Preserve the shared decision contract. |
| Organization language preference/observation, same module | Per-dispatch advisory | Keep current value and source as facts, with explicit advisory meaning. Preference changes must not create stable epochs. |
| Computer file-access awareness, `computer-file-access-prompt.ts` | Stable instructions plus fallback; changes epoch | Preserve enforcement outside the model. Audit direct-user continuation and policy removal before changing placement; do not claim this text itself restricts files. |
| Activation intent gate, `renderActivationIntentGate` | User prompt prefix | Separate the application decision rule from activation facts and user words. Preserve assigned/reference/ambiguous semantics and `stay_silent` eligibility. |
| Entry Brief, `renderEntryBriefSection` | Conditionally injected user input | Split framework guidance from Profile/Space identity, purpose, and user-maintained Guide. Keep bootstrap freshness evidence; do not turn Profile names, roles, or Guide text into developer commands. |
| Center Agent role, `renderCenterAgentRoleSection` | Conditional user input | Application-authored role instructions may use an instruction channel only for the designated role. Preserve the designation gate; do not install globally for every local agent. |
| Dispatch trigger, requester, targets, reply placement, `renderDispatchBriefSection` | User input | Keep explicit current-dispatch facts. Names and quoted content retain provenance. Routing facts do not authorize publication. |
| Continuity, multi-target outcomes, history/thread commands | User input | Include the minimum current evidence and exact retrieval references. Keep history on demand; do not omit facts necessary to interpret the current request. |
| Action guidance and Mandatory completion | Dispatch Brief plus final prompt section | Give one renderer ownership of the compact obligation. Keep one explicit reminder that plain assistant text is not publication. Put detailed argument help in tools; retain supported CLI fallback guidance. |
| Service freshness warnings | User input | Preserve current diagnostic facts when relevant; never silently turn warnings into readiness or permission decisions. |
| Current Wake message, image attachments, quoted reply context | User input | Keep as user/task content. Do not promote to developer role. Preserve current input/attachment semantics; lossless raw-message changes would be a separate contract decision. |
| Shared file references, `renderSharedSpaceFilesSection` | User input with retrieval commands | Keep exact file/revision facts and provenance. Retrieve contents on demand. Treat file names and contents as data. |
| Structured-action repair, `resolveRuntimeResultStructuredSpaceAction` | Replacement repair prompt; Codex uses an ephemeral fork | Preserve bounded repair and canonical conversation identity. Instruction separation must not restart work or turn previous output into a new user authorization. |
| Concurrent-reply reconsideration, `execute-dispatch-task.ts` | Replacement repair input with newer outcome evidence | Preserve newer evidence and existing outcome supersession rules. Do not merge this semantically different operation with missing-action repair merely because both use repair execution mode. |
| Managed Skills and prompt guide catalog | Separate installed/discoverable guidance | Keep on-demand guidance. This task does not migrate all skill installation or edit user-owned instruction files. Reuse shared facts where overlap with changed delivery instructions is demonstrated. |
| Tool descriptions, `space/action-mcp-server.ts` | MCP server instructions and three tool schemas | Own argument semantics and tool result meaning here. Reuse existing action writers. |
| Dispatch IDs, context path, credentials, action eligibility | Runtime environment/context and action writer | Keep credentials outside prompts and tool schemas. Bind actions to active dispatch in code. IDs are correlation data, not authority. |

The inventory establishes overlapping guidance, not a proven failure or a measured token saving. Deletion must preserve semantic coverage across native and fallback routes.

## Provider-specific implementation boundary

| Provider | Existing carrier | Selected approach |
| --- | --- | --- |
| Codex | `thread/start.developerInstructions`; source/epoch check; MCP config | Keep this baseline. Investigate supported additive instructions before moving per-dispatch rules. Do not copy OpenClaw's Default-mode prompt or force `default`. Retain the complete fallback until exact lifecycle evidence supports replacement. |
| Claude Code | SDK `systemPrompt` preset `claude_code` plus `append`; separate user stream; MCP | Keep native preset and settings sources. Verify append behavior on resume and native subagents before changing the appended content's lifetime. No migration to acpx or CLI solely for parity. |
| OpenCode | `session.promptAsync` with `system` and user `parts`; MCP | Keep direct SDK integration. Verify replacement/omission on subsequent prompts and persisted session restoration. Do not infer ephemeral lifetime from per-request syntax. |
| Cursor | ACP `session/prompt` content; injected MCP server | Keep a clearly separated, compact textual envelope until a documented and verified independent channel exists. No invented `_meta` field. |
| Grok Build | ACP `session/prompt` content; injected MCP server | Same capability boundary as Cursor, verified independently. ACP connectivity is not evidence of a system-instruction capability. |
| OpenClaw | Gateway `extraSystemPrompt`; action-enabled dispatch uses temporary local plugin/config | Keep both actual routes in acceptance. Gateway-only evidence does not certify the action-enabled path. |
| CLI fallback routes | Complete prompt | Render from the same semantic source. Preserve behavior without pretending user-role text acquires developer priority. |

### Codex uncertainty to resolve first

OpenClaw's `turn-params.ts` explicitly selects Default mode and copies a pinned Default prompt when adding custom collaboration instructions. The official app-server behavior fills the built-in preset when custom developer instructions are null. Consequently, this is a mode-control mechanism, not a harmless append-only slot.

The local owner document currently says resume/fork do not replace developer instructions. The inspected Codex protocol accepts those fields and the upstream request processor handles configuration overrides, with separate already-running behavior. Acceptance therefore requires exact supported-version behavior rather than assuming either universal support or universal rejection. Do not remove source/epoch checks based on the presence of a schema field. If verified behavior changes the supported contract, update the owner document in the same implementation change.

## Dynamic tools decision

Codex `dynamicTools` registers tool names, descriptions, and argument schemas. On invocation, app-server sends `item/tool/call` to its client; the client executes and returns structured content and success. These APIs are experimental. Tool definitions are persisted in thread metadata and can be restored on resume.

Our current equivalent user capability already exists:

`Codex -> dispatch MCP server -> recordDispatchSpaceReply/Status/Silent -> unpublished action proposal -> existing finalization/publication path`.

This is not a terminal prompt telling the agent to invent a tool. `codex-space-action-mcp-config.ts` registers the required MCP server for the process; it does not write global user configuration. The MCP handler explicitly reports an unpublished proposal. The Core-owned outcome path remains authoritative.

Dynamic tools could remove the Codex-specific MCP subprocess/stdio hop if they delegate to the same validated action writer. They would also introduce client-side tool RPC handling and persisted-tool lifecycle obligations. Include an isolated experiment, as requested by the user; keep production MCP unchanged until measured evidence supports adoption.

The experiment must show a concrete benefit and prove:

- No second action schema, writer, authorization path, or publication path.
- Stable tool descriptions contain no current-dispatch IDs, secrets, or task-specific mutable facts.
- Each call resolves authority from the active dispatch association, not model-supplied ownership claims.
- Expired, missing, wrong-thread, wrong-turn, cancelled, and superseded contexts fail closed.
- Resume/fork/direct-user continuation cannot accidentally activate a prior dispatch's tools.
- RPC cancellation, failed tool results, duplicate calls, and client disconnect preserve the existing outcome rules.
- Exactly one tool transport is selected for a Codex run; no duplicate visible MCP and dynamic versions of the same action.

Fallback is safe before an action has been submitted, when capability or initialization failure proves the dynamic path did not execute. After an ambiguous timeout/disconnect, inspect the existing action result and use existing recovery semantics; do not blindly invoke MCP or restart the user turn. A rejected action must not gain authority by changing transports.

## Implementation sequence

### 0. Establish the behavior baseline and write one candidate

Extract required behavior from the current implementation and owner contracts, not from the old wording alone. Give each existing instruction a disposition: preserve its behavior, consolidate a duplicate, or remove with an explicit reason. This is a compact traceability table, not a requirement to preserve every sentence. Keep the old renderer available in the test harness as the comparison baseline; do not maintain two production policy owners.

Write one coherent candidate around five questions: why was I activated; what is the task and my role; which current facts are authoritative and which text is quoted data; how do I obtain missing context or coordinate; how do I finish with the correct visible outcome? Preserve each harness's native instructions and tool behavior. The shared content is OpenMeld semantics, not identical model-bound bytes across providers.

Compare the candidate through existing carriers before attributing an improvement to a new carrier. Run the small Codex lifecycle/dynamic-tool probe early after the content classification is clear, so its constraints inform delivery design without blocking useful content work.

Use a representative reusable set of disposable tasks: ordinary reply; continuation with changed Space facts; Wake versus reference with multiple agents; actual coordination dependent on another outcome; missing-action recovery; role/status/silent variants; attachments and exact thread placement; privacy/permission denial; native user continuation. Run old and new on comparable model/settings/data. Repeat only noisy or materially different cases. Never execute comparison writes twice against real user work.

Judge correctness first (right target, action, information boundary, continuity), then usefulness/completeness and unnecessary clarification/tool calls. Record input and cached tokens, total tokens where available, first useful response latency, and time to the final visible Space outcome. Record cold and warm conditions; fewer characters or one faster sample does not prove lower cost or better reasoning. Do not set a speculative percentage target. Keep a change when it improves the intended journey without an observed important regression; document the limits of that evidence.

### 1. Separate semantic content without changing provider behavior

Work in the existing dispatch prompt owner. Split application-authored rules from dispatch facts and task content before rendering; do not build a generic prompt framework. Keep the existing public adapter shape unless the next phase actually needs a new field. Add internal typed fields only for concrete consumers.

Generate native and fallback forms from the same sections. Remove demonstrably duplicate collaboration definition/action instructions while preserving one compact completion obligation and the CLI fallback. Preserve special Space contracts, activation gating, bootstrap freshness, role eligibility, repair, and reconsideration.

Acceptance: behavior-focused cases covering ordinary reply, status-only and silent outcomes, raw-reply contracts, unavailable tools, role gating, attributed hostile-looking content, policy advisory, and attachment/reply references. Check rendered native and fallback forms against requirements, not giant mirrored snapshots.

### 2. Resolve the Codex lifecycle contract with an isolated probe

Use a disposable working directory and temporary `CODEX_HOME`, with authorized normal authentication if actual model execution is needed. Do not edit or resume a real user's conversation to test instruction replacement. Schema checks prove shape only; a real model turn is required for model-visible behavior.

One organized matrix: fresh thread; cold resume with same/changed instructions; already-loaded thread; Default and Plan; omitted versus explicit replacement on the next turn; fork/native subagent; compaction; ordinary user continuation. Use harmless distinct markers, protocol events, and instruction provenance where available. Model self-report alone is not proof of instruction role or lifetime.

Decision rule: adopt a supported additive mechanism only if it preserves mode and native instructions and has an explicit lifecycle strategy. Otherwise retain the compact fallback. Do not create new sessions, rewrite history, or maintain a copied Codex mode prompt to satisfy cosmetic transcript goals.

### 3. Map verified carriers and validate the user journey

Use the existing Claude/OpenCode channels after their narrower resume/next-turn checks. Cursor/Grok keep the shared textual form. Validate both OpenClaw routes. Verify actual Wake entry to one authorized recorded action and eventual visible outcome; successful model text or a tool proposal alone is insufficient.

Cover cross-dispatch stale-context rejection at the action boundary and preserve current-account local Service/RuntimeCoordinator ownership. No global provider-config or project-instruction-file mutations.

### 4. Close out the selected change

Run focused adapter/prompt/action tests first. If shared process payloads change, use `packages/schemas` and perform the Contract Impact Audit. Local Service/CLI changes require the normal local-component stamping and release-readiness process. Follow the owner delivery lifecycle for any later commit/release; this plan itself authorizes neither.

Update the Local Service instruction-delivery owner for any adopted lifecycle rule. A user-visible change to transcript or agent behavior merits a changelog assessment; this research document alone needs no product changelog. Do not broaden this into replacing all harness transports, installing a new memory system, or rewriting information-protection policy.

## Acceptance summary

The result is correct when required instructions reach each supported execution path, user data retains its provenance, no selected mode or conversation continuity is lost, stale dispatch context cannot authorize an action, and the Space gets the same valid outcome. Token or transcript improvements are secondary measurements, not correctness evidence.

Architecture review: these decisions preserve existing owners. Real Codex 0.150.1 marker probes support the existing resume/fork instruction-replacement restriction. They do not establish every provider version or lifecycle; untested matrix entries remain unverified rather than implied acceptance requirements for an unchanged carrier.

## External evidence

- [Official Codex app-server: dynamic tool calls and thread lifecycle](https://learn.chatgpt.com/docs/app-server)
- [OpenClaw pinned thread configuration](https://github.com/openclaw/openclaw/blob/5bf5dc9c5be8366f99e0291c01cd3aafb7ab5a4a/extensions/codex/src/app-server/thread-requests.ts)
- [OpenClaw pinned collaboration-mode instructions](https://github.com/openclaw/openclaw/blob/5bf5dc9c5be8366f99e0291c01cd3aafb7ab5a4a/extensions/codex/src/app-server/turn-params.ts)
- [OpenClaw pinned Claude CLI setup](https://github.com/openclaw/openclaw/blob/5bf5dc9c5be8366f99e0291c01cd3aafb7ab5a4a/extensions/anthropic/cli-backend.ts)
- [acpx provider registry and Claude-specific system-prompt extension](https://github.com/openclaw/acpx/blob/main/docs/agents.md)
- [Official Claude system-prompt modification](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [Official ACP prompt-turn contract](https://agentclientprotocol.com/protocol/v1/prompt-turn)
