# Collaboration review context

## Agent Context

- Purpose: Record the contract audit and focused evidence for collaboration context improvements.
- Read this when: Reviewing this candidate or preparing its local-component release.
- Update this when: The candidate scope, compatibility decision, or delivery evidence changes.
- Do not use this for: Runtime authority, general model-performance claims, or production acceptance.
- Source of truth: This review owns candidate evidence; the linked product and architecture owners define current behavior.

Status: Implementation and localhost smoke complete; production delivery pending.
Remove after the change is delivered and its release evidence is preserved in the PR and Changelog.

## Scope and ownership

The local reply coordinator retains the latest 20 distinct observed public
signals within one coordination call. Every isolated repair receives that view
and the current unpublished action. Each signal excerpt is capped at 2,000
characters; omitted history and truncated text are explicit. The observation
cursor still advances through the existing authorized read, and Space retains
its atomic publication guard. There is no model-specific branch continuation,
durable context store, business-specific assignment rule, or review-count cap.

The shared Space guidance distinguishes a requested personal answer from
unnecessary repetition. Activated participants do not establish a work order or
prove completion. The existing Remote Agent consumer also receives the shared
participant guidance; its native publication and execution owners are unchanged.
The local repair-view implementation does not claim Remote/Center runtime smoke.

Generated local context-read commands include the current target Profile and
Agent View explicitly: Board, anchored history, fallback history, exact thread,
and current-Wake updates. They must not depend on whichever profile happens to
be selected in the user's terminal. This does not grant access or change the
request-context authorization owner. Ordered contributions are guided by the
next valid published step, without a business-specific assignment algorithm.
Local activation guidance classifies requested coordination as assigned work
before considering the candidate-silence exit. It preserves silence for a real
non-assignment and the existing explicit-Wake rule for ambiguous intent. No
recipient is added or changed by instruction rendering.

## Contract impact audit

- Changed surface: CLI/Service model-facing context and shared Space guidance.
  Compact CLI history additionally preserves `files` from the existing shared
  signal schema. This is an optional additive read-projection field; canonical
  IDs, revisions and authorization remain owned by Space Files. Old consumers
  can ignore it and no file contents are prefetched.
  The shared MCP launch configuration also forwards the carrier's optional
  `OPENMELD_HOME`, `OPENMELD_AUTH_URL` and `OPENMELD_GATEWAY_URL` selectors,
  alongside the existing environment preset. This
  preserves lane-local login resolution across Codex's filtered tool-process
  environment; no credential is copied and Space authorization is unchanged.
  The new rule is per-turn material, including on resumed Codex conversations;
  no retrofit of developer instructions or instruction epoch is needed.
- Unchanged boundaries: HTTP/RPC/WebSocket schemas, setup, Prepare, runtime
  identity, canonical controller conversation, saved permissions, allowed
  Space Actions, action acknowledgements, trace schemas, and publication owner.
- Mixed versions: old Core accepts new Service actions and new Core accepts old
  Service actions because their wire shapes and validation remain identical.
  Old Service retains the known context-loss behavior but has no newly required
  receiver or capability. Setup, status, diagnostics and self-rescue commands
  have no new dependency.
- Release policy: advisory CLI/Service artifact update (`available`), with no
  contract epoch bump or forced user update. This feature branch does not bump
  versions or stamp release hashes. The eventual clean-main release must rebuild
  and stamp the changed artifacts through its normal guarded release process.
- Deploy order: no new protocol ordering dependency; ordinary scoped release
  rules still apply. Remote only needs its normal rebuild to receive shared
  participant prose, and does not depend on the local view correction.
- Rollback: restore the prior artifacts. No data migration, session rewrite,
  permission repair, or durable-state cleanup is required.

## Evidence and remaining work

The regression failed on the base implementation: the second canonical-parent
review omitted the first peer's signal. It passes after retaining the bounded
view. Focused checks also cover duplicate inputs, overflow disclosure, truncation,
unchanged-room fast paths, source-Wake scoping, terminal outcomes, and missing
action/error preservation. Local product smoke evidence is retained under this
worktree's `dev-tmp/`; it is distinct from contract checks and release evidence.

A real GLM-to-Luna handoff also exposed an incomplete generated history command:
it omitted `--profile`, and the local read reported no selected identity. The
anchored-history/thread regressions failed before adding explicit target identity.
This correction belongs to instruction generation, not a request for the user to
reattach files or repair their terminal selection.

The next real read exposed a second information-loss boundary: compact history
discarded canonical file references even though the original message contained
them. A regression using the public CSV-upload response shape failed before
preserving those references. The repair adds no new file catalog or access path.

A subsequent Codex file-tool call received the correct reference but failed with
`auth.session_token_unavailable`: the MCP environment allowlist dropped
`OPENMELD_HOME`, selecting the default home instead of the carrier's isolated
lane. The shared adapter regression failed before retaining this non-secret
selector. A recorded error reply alone does not prove task completion.
Forwarding only the home exposed the same omission for endpoint overrides:
the next native file read reported that sign-in belonged to a different
environment. The correction therefore retains the complete explicit lane
selection, not just its filesystem root. No authentication check is bypassed.

The final Web/thread handoff with clean profiles exposed a separate instruction
ambiguity: GLM chose `activation_intent.referenced_or_candidate` after being
asked to have another member verify a report. The guidance now explicitly
recognizes coordination as work assigned to the addressed Agent. This is a
generic collaboration obligation, not a fixture-specific workflow or recipient
assignment. The original failed smoke is retained alongside its rerun.

The final localhost Web/thread rerun kept the user request unchanged. OpenCode
GLM 5.3 Flash actually Woke Codex Luna; Luna read the earlier thread attachment
through the native file tool and published the correct result in the original
thread. Both public dispatch traces showed delivered visible replies, retained
after browser reload. Other observed successes cover three ordered contributions,
requested personal answers, and reference-only participants remaining inactive.
Models used low reasoning throughout. These are focused product observations,
not a benchmark or a general token-saving claim. An older reused GLM session
repeated historical authentication failures in a separate attempt; comprehensive
long-lived-session recovery remains outside this correction.

Initial-history supply and managed context-read receipts remain separate work.
An arbitrary CLI read or scanned cursor does not prove that the model received
the underlying facts. No eval framework or generalized performance claim is
part of this change.
