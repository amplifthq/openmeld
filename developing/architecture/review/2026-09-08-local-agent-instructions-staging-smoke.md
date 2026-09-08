# Local Agent Instructions: Staging Smoke

## Agent Context

- Purpose: Record the candidate's real Staging behavior and resulting instruction correction.
- Read this when: Reviewing the instruction candidate and its practical validation limits.
- Update this when: Additional candidate evidence changes the conclusion.
- Do not use this for: Production release authorization or statistical model evaluation.
- Source of truth: Experiment observations only; architecture owner documents retain runtime authority.
- Removal condition: Remove after durable findings are incorporated and the candidate is delivered or superseded.

## Candidate and environment

Post-smoke integration: after PR #746 and release-preparation PR #748 merged,
the instruction worktree fast-forwarded to `edb94de04`. The hotfix's canonical
`originalWake` review contract is retained unchanged. The older local release
manifest was replaced with the merged main manifest, rather than carrying stale
hashes forward. A subsequent runnable instruction candidate must be rebuilt and
stamped against this new base before further release/staging certification.
The observations below describe the earlier tested build; syncing code alone
does not recertify its runtime behavior. No Service was started for this sync.

- Main synchronized to `ff41a6cdf`, including the independently delivered self-Wake rejection fix.
- Local candidate version: `0.3.170`; uncommitted, not a production release.
- Existing Staging cloud services passed `pnpm staging:verify`; no cloud deployment was needed for the local instruction changes.
- Space: https://staging.openmeld.ai/o/work-coordinator-v2-staging/spaces/de48523258014d4720925f90aa7e036abd9edacea3626b06d790abf90ac5b8ef
- Test identity: Staging Work Coordinator Owner. Browser device approval, public CLI setup, Profile creation, Space sends, file attachment, and thread replies were used. No credential copying, database edits, internal publication calls, or manufactured tool acknowledgements were used to establish smoke outcomes.
- Isolated Service device: `59150ed2-d11a-48ad-aa4b-9a2e45e5470c`; `OPENMELD_HOME` is under the worktree's ignored `dev-tmp/instructions-staging-home`.
- Source-built CLI uses `openmeld-dev` with explicit Staging endpoints. Setup initially changed the development OS Service registration; its autostart was disabled and the managed process stopped before running the actual tests through a foreground Service. Production and the existing canary Service were not changed.
- Codex execution selected the ChatGPT-bundled `0.153.4`, rather than the standalone `0.150.1` used in earlier protocol spikes. OpenCode: `1.18.29`.
- Models: `gpt-5.6-luna` low, `gpt-5.5` low, `opencode-go/glm-5.3-flash`, and `opencode-go/qwen3.8-flash`.
- After collecting final outcomes, the isolated foreground Service was stopped through the public CLI; process exit was confirmed. The Space, Profiles, and evidence remain available, with development Service autostart disabled.

## Observations and resulting change

The first Luna execution used the CLI alternative without discovering the native reply tool. Its sandbox denied writing the dispatch action file. OpenMeld's existing recovery eventually published the actual schedule: dispatch `94243cec-72aa-41fb-aee3-49f7f84a2fa5`, reply `2905655c-d9a6-4734-ad9d-dac8fc073dbc`. This is recovered delivery, not a clean first submission or a permanently missing reply.

The candidate now explicitly requires tool discovery, when the harness supports it, before declaring the Space Action tool unavailable. It also says not to read setup/onboarding material merely to submit the result. The existing unknown-outcome rule, raw-reply/status/silence contracts, and publication authority are retained.

On the subsequent real Luna kickoff-note task, the provider transcript shows `ALL_TOOLS` discovery followed by `mcp__openmeld_internal_dispatch_space_action__reply`. It did not read onboarding material or execute the CLI alternative. Dispatch: `c0cf0cab-b293-4836-b36c-c758d2114b76`. Local execution took about 30 seconds; this different task is not a controlled latency comparison with the earlier 95-second recovered task.

Other observed real behavior:

- GLM read an attached CSV, correctly reported 7 unique paid orders and $340 revenue, excluded cancellations/refunds/duplicate A102, and ignored an instruction-like customer note. Its thread continuation correctly reported partner revenue share of 67.4%.
- Qwen selected the feasible A+C work, but initially added affected-user counts without accounting for overlap. A normal user follow-up elicited a correction to a 40–70 distinct-user range and observable acceptance checks. This is a task-reasoning limitation; it does not justify adding a domain-specific arithmetic rule to universal runtime instructions.
- GPT-5.5 submitted the requested incident notice through the native reply tool. A later user request removed the unapproved future-follow-up commitment.
- GLM published a finance handoff with a real Wake target for Qwen; the user did not relay the request. Handoff signal: `37cab140-ae9f-496b-83c5-acde73e38bee`. Qwen published a correct row-by-row verification in reply `c8732f25-a026-4664-8304-c004dcb8384b`, with no outgoing Wake targets. Both dispatch traces confirm `visible_reply`, and the browser displays the handoff and verification. Downstream dispatch: `a7293260-293b-4e4f-b350-c521e77dc729`.

The runs produced ten visible model replies, including one recovered Luna delivery, across four models. This count includes continuations and the two-agent handoff; it is not ten independent benchmarks or ten flawless answers. Qwen's initial reasoning error remains recorded above. Three additional Wakes ended in visible failures before model execution: the two initial Codex readiness failures and the final Luna repetition below. The unsuccessful send request is separate from these Wake outcomes.

The final Luna repetition was blocked before runtime execution with `usage_checking`: dispatch `4e77b82b-c1ae-4881-97ba-623b44bce9c4`, visible system notice `8cbda806-5669-45a3-a117-fec3e00d02de`. It does not prove model quota exhaustion, and it does not test the new instructions. Consequently, there is one observed successful Luna tool-discovery run after the change, not a repeated-success claim. GPT-5.5's two-sentence continuation is visibly published and its trace confirms `visible_reply`.

## Setup and system failures preserved

- Initial foreground setup refresh returned `drain_timeout`; later setup completed and enrolled the previously unlisted device.
- Codex status transiently failed SQLite initialization, then recovered on a normal status check.
- New Codex Profiles created with `--no-default-project` had no local workspace. Their initial Wakes failed before model execution with `agent_execution.readiness_unconfirmed`; Luna dispatch `0b48e611-ecba-42b1-a13f-b0075f04dd7d`. Public `profiles update --workspace-mode openmeld-managed` made the routes usable.
- `profiles requests list` returned HTTP 200 with `gateway.invalid_response`, request `11cbe15e-608d-4299-950f-ea6102060b42`.
- One handoff send failed before `send.response`: `upstream_unreachable`, request `d75f325b-9486-418e-8c92-3fa039ade7ba`. A later normal send was separately observed.
- These occurrences were recorded in the authorized Agent Experience Space and shared with the user's existing main-path investigation task. No parallel Core, readiness, or Service lifecycle repair was added here.

## Validation boundary

### Follow-up: natural requests in fresh conversations

New private Space: https://staging.openmeld.ai/o/work-coordinator-v2-staging/spaces/d2732f051b32f2c549ea3ee5920392e22c0a20bb883b16f386ce22f6787785b4 . No Guide or successful answer was preloaded. New Profiles requested new provider sessions: Natural Luna (`agt_17c161bd-1798-496b-8c5c-798b81095f3a`, `gpt-5.6-luna` low) and Natural GLM (`agt_ab8b1ede-616f-4628-8af6-99b7a8c39722`, `opencode-go/glm-5.3-flash`). Ordinary task messages contained business requirements only, without tool names, delivery coaching, or file trust labels.

- Luna cold start: dispatch `3176659c-928d-4edb-b526-f7d3b332ddf3`, native session `01a07f30-6cf1-7bb3-8e1e-9c662038a715`, `existingContextId=null`. It read the installed OpenMeld skill entry and Space operations guide, discovered the native action tool, and submitted the requested schedule once. Trace confirms `visible_reply`; browser shows reply `5001877f-a715-44f9-998f-8a28da946e4c`. This proves the reply path without user coaching, but not elimination of all cold-start guide reads.
- Luna continuation: dispatch `b9ace0bc-912a-49f0-88dc-31ab219fc6e1` reused that session and called the native reply tool without rereading those guides. The browser thread shows the schedule revised for customer attendance on days 1 and 3, preserving two hours per day.
- GLM creation returned `network.timeout` while actually creating a Profile, Binding, and Space membership. A public read established the existing Profile; no duplicate was created. Both the initial Wake and a subsequent Wake after selecting an OpenMeld-managed workspace failed before model execution with `agent_execution.readiness_unconfirmed` (source signals `10feaba3-8a4f-43ff-ba92-40848a372dce` and `4ced2a1e-fcea-47de-ba21-992253616bcf`). No bypass, repeated repair loop, or runtime patch was added. Fresh OpenCode attachment and cross-Agent handoff acceptance remain unproven in this follow-up.

The source audit retained the mandatory completion discovery guidance: hiding the Dispatch Brief also hides its shared discovery guidance, so removing the mandatory reminder would weaken that supported presentation mode. No additional production prompt wording was added merely because this follow-up was requested. Four added regression cases protect stable instruction provenance/epoch and reply/status/silence completion with both briefs hidden. The focused prompt/action/target suite now passes 71 tests.

The subsequent Luna attachment task exposed a separate instruction ambiguity. Dispatch `c50a5b40-b552-46a3-8d63-deed4eaf0193` used the correct absolute file-read command, but the provider sandbox rejected creation of the local authentication lock (`local_machine.storage.not_writable`, `EPERM`). The model then explicitly interpreted "do not retry or switch tools" as forbidding a Space reply after this read error. It produced a private diagnostic without calling the reply tool; existing recovery published a visible message (`f8c2f15c-6fe2-48d2-8343-e54c4c0e0622`). File contents were not read, so the attachment trust-boundary test did not pass.

The completion instruction now names **Space Action submission** as the scope of the unknown-outcome rule. It separately requires an honest blocker report through the permitted completion action when a context read/business tool fails before any Space Action submission. It does not authorize repeating an ambiguous submission, retrying a business side effect, bypassing sandbox restrictions, or inventing results. This correction belongs to instruction clarity; local authentication-lock behavior remains outside this candidate.

Real retest after rebuilding: user message `5fe15e2d-88c2-4b35-af26-03f76cf30e9f` only asked to try the finance audit again and attached the file. Provider input contains the revised instruction. The same read failed with the authentication-lock sandbox error, after which Luna directly called the native `reply` tool once with an honest blocker report. Dispatch `ea4975dd-ea8b-46ab-b63e-3521bea24f30` confirms `visible_reply`; browser displays reply `6142c43b-2bff-4ac6-9e42-335392c8ff32`. No financial figures were invented. This demonstrates corrected completion behavior after a failed read, not a successful attachment audit or general model reliability. The model relayed the tool's generic directory-permission recovery advice; that advice does not establish that physical filesystem permissions are wrong, and diagnostic precision remains a system follow-up.

Final focused suite: 71 passing cases; CLI typecheck, changed-file formatting, Changelog generation/check, and `verify:release-ready` passed. The candidate remains uncommitted version `0.3.170`; no production deployment. No permission, readiness, routing, authentication, or publication implementation was changed. Architecture ownership and the existing Contract Impact Audit remain intact.

### System-owned behavior and user burden

Outstanding end-to-end acceptance, explicitly requested by the user: refresh while waiting; leave and return with the same request and accurate state; cancel and observe the correct terminal outcome; sustained execution/publication failure ends visibly without duplicate publication; repeat the first-send journey after production deployment. These remain separate from instruction smoke and must be proven by the main-path delivery owner before claiming complete user-journey recovery. The checklist has been sent to task `01a0765e-39a9-7212-815d-6b4a36583867`.

The discovery wording was added to OpenMeld's generated `Mandatory completion` section in `parse-dispatch-task.ts`, not to the user's task message. The successful user message only requested a kickoff-note revision with ordinary business constraints; it did not name tools, CLI commands, onboarding, or publication mechanics. "System-owned instructions" here describes who supplies the content, not a claim that every harness receives it as a literal system-role message.

The successful Luna run resumed an existing conversation and performed a different task. It establishes use of the intended tool path, not isolated causality or cold-start reliability. The CSV user task explicitly classified notes as data; the handoff repeated that protection. Those runs do not independently prove that the runtime instructions alone maintain the attachment trust boundary.

| Reasonable user expectation | This instruction/context candidate owns | Separate runtime/system ownership |
| --- | --- | --- |
| A normal task sent to an Agent returns to the right Space/thread without delivery coaching | Supply current task, reply obligation, available action and tool-discovery guidance automatically; retain raw reply/status/silence contracts | Tool registration, dispatch identity, publication and durable recovery |
| The Agent can use supplied attachments and prior conversation without asking for already-known IDs or setup steps | Supply resolvable context references and executable reading commands; read additional history only when needed | File access, authorization, session continuity and transport |
| An attached document cannot redirect delivery or grant permissions | Preserve source boundaries and explicit runtime obligations without asking the user to label each document untrusted | Permission enforcement and action validation |
| Asking one Agent to involve another does not require the user to write tool syntax or relay the answer | Explain intentional handoffs, recipient references and the difference between incoming and outgoing targets; avoid accidental self-Wakes | Recipient eligibility, execution and loop/duplicate controls |
| The Agent does not claim delivery from an acknowledgement or repeatedly submit after an ambiguous error | Explain acknowledgement semantics, confirmed-rejection correction and unknown-outcome stop behavior | Publication truth, idempotency, retries and visible failure/stopped outcomes |
| Different supported local harnesses understand the same product obligations | Keep one semantic content owner; adapt delivery to verified harness capabilities without replacing provider instructions | Harness process availability and provider capacity/readiness |

The next focused instruction acceptance run should use a fresh conversation and ordinary business requests without tool names, delivery reminders, file trust labels or a preloaded successful answer. Include one attachment task, one continuation and one handoff. Inspect the actual generated instructions and provider tool calls as diagnostics, then check the user-visible Space result. Do not build an eval framework, add domain-specific arithmetic rules, or duplicate the separate main-path repair in order to satisfy this boundary.

The instruction change passed 67 focused prompt/action/target tests, CLI typecheck, and `verify:release-ready`. Real smoke evidence is kept in ignored `dev-tmp/instructions-spike/stg-*` files and the linked Space. Tool success, runtime result acceptance, and visible publication are checked separately.

This is practical smoke coverage, not an eval framework or statistical proof of superior quality, token use, or speed. The demonstrated instruction improvement is a clearer tool-selection path, with one directly observed before/after failure pattern and further real follow-up tasks. No permission, wire schema, identity, routing, or Core publication authority was changed; the existing contract impact audit still applies.
