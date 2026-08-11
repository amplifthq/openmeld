# Experience Principles

## Agent Context

- Purpose: Own the product experience judgment principles for OpenMeld — the
  recurring taste decisions behind status display, copy, guidance, and
  interaction quality across every client.
- Read this when: You are deciding what a status should say, whether a banner
  should exist, how an error reads, how a flow guides the user, or between two
  implementations that are both "correct" but feel different.
- Update this when: Felix makes a product judgment call that contradicts or
  extends a principle here. Record the new call in the same PR.
- Do not use this for: Hard architecture boundaries (`AGENTS.md` and owner
  docs), client-specific presentation rules (`developing/clients/*`), or visual
  design tokens (`developing/clients/shared-ui.md`).
- Source of truth: This file owns OpenMeld product experience judgment. Cap: at most
  10 principles. To add one past the cap, merge or retire another.

These principles exist because "technically correct" is not the bar. Each one
was extracted from repeated real decisions; each shows what applying it and
violating it look like. When two principles conflict, honesty wins.

## 1. Honest state beats reassuring state

Show what the system actually knows. When evidence is missing, say so — do not
substitute a softer state to avoid alarming the user.

- Applied: when strict CONNECTED evidence had a data gap, Desktop shipped
  honest "cannot confirm" copy instead of an optimistic green.
- Applied: a failed route lookup is surfaced as a lookup failure, never
  repainted as a stable `Offline`; `Offline` is never repainted as `Checking`.
- Applied: live Agent work may name the current step, but it keeps the explicit
  `Agent is working` execution state visible until the authoritative stream
  reaches a terminal outcome. A live phase or settled work step remains
  supporting context and never replaces that execution state.
- Applied: when an Agent result was accepted but reply publication exhausts its
  repair window, Space shows one explicit publication failure instead of an
  endless pending state or a later reply that contradicts a terminal failure.
  The retained result remains diagnostic evidence; the failure does not claim
  that the Agent execution failed.
- Violation looks like: mapping an error branch to the nearest healthy-looking
  enum value so the UI "stays calm," or replacing execution state with a tool
  activity label that answers only what the Agent is doing.

## 2. Precision beats generic banners

Put the problem on the thing that has the problem, with its own action.
Page-level banners are reserved for genuinely global states (for example, zero
local agents installed).

- Applied: Local Agents surfaces per-agent status issues with a per-agent CTA;
  the top banner shows only in the zero-agent case.
- Applied: missing Organization Wake access appears as an amber, per-agent
  configuration outcome with a direct `Turn on Wake access` action, while real
  execution failures remain destructive.
- Violation looks like: one agent goes unready, and the whole page grows a
  "Connect Local Agent" banner that points nowhere specific.

## 3. One outcome, one next action

Every state a user can land on shows: the current outcome, exactly one
recommended next action, and a diagnostic path for when they need more. Not a
menu of parallel maybes.

- Applied: setup completion hands the user a single URL to go to; failure
  states name the failed step and the one command to run.
- Applied: a controller action blocked by Agent Profile permission settings is
  shown as an approval outcome, not a command failure, with one action to review
  that Agent Profile's permissions.
- Violation looks like: an error card listing four commands the user "could
  try."

## 4. No dead ends, no loops

Every failure state has an exit that makes progress. A guidance loop (A sends
you to B, B fails back to A) is a P0 product defect, not a copy problem.

- Applied: the Reconnect card loop (setup → foreground → precheck → setup) was
  treated as a defect to break, including exposing the real anomaly code so the
  user can reach the actual failure site.
- Violation looks like: retry buttons that re-run the same failing path with no
  new information and no escalation route.

## 5. Frugal probing — design for the low-end machine

Do not assume the user's computer is fast or idle. Probe rarely, probe cheap,
and never disturb the user because a background check failed.

- Applied: readiness probes are debounced and budgeted; a runaway local
  controller pegging a CPU core was treated as a product bug and disabled.
- Violation looks like: polling loops added "temporarily," per-tick probes on
  recovery paths, or spawning helper processes per check.

## 6. Converge, don't flicker

A status that flips back and forth is worse than one that arrives a beat late.
Debounce at the display layer only — raw facts stay raw so diagnostics never
lie.

- Applied: Members and Agents readiness-badge debounce is display-only; the
  underlying Core readiness keeps every raw transition and continues to drive
  actions, filtering, diagnostics, and Wake eligibility.
- Applied: an optimistic outgoing message does not add a short-lived
  `Sending...` row; only a meaningfully delayed send adds `Still sending...`.
- Applied: conversation compaction appears only after the final reply carries a
  durable server-authored checkpoint. Web does not flash a speculative
  `Compacting...` state while the model runtime is still working.
- Violation looks like: smoothing applied to the stored state itself, or
  hiding transitions diagnostics later need.

## 7. Same truth on every surface

Web, CLI, and Desktop must reach the same conclusion from the same facts — or
explicitly explain the split (local view vs cloud view). A three-surface
comparison is part of production smoke for a reason.

- Applied: members list, Agents page, and `openmeld service status` are checked
  against each other as a standing smoke step.
- Violation looks like: one client computing its own availability from a
  different evidence chain because it was convenient.

## 8. Copy is product

Product-facing copy targets North American users and must read as
native-level, calm, and specific. Error text leads with what happened in plain
words and what to do; codes and IDs support diagnosis but never replace the
sentence.

- Applied: retired commands answer with what replaced them; carrier
  false-failure copy was rewritten to state the true startup window instead of
  crying wolf.
- Violation looks like: `agent_profile_binding.primary_conflict` as the
  headline of a user-facing failure, or copy that hedges because the developer
  was unsure.

## 9. Intent is authority; confirmation is the exception

A verified user's clear request authorizes the ordinary writes needed to
complete it. Do not make the user approve the same action twice. Ask only when
material information is missing, when the Center Agent proposes a new external
write outside the request, or when an interactive delete or merge needs its one
separate safeguard against slips.

- Applied: "Comment on this pull request" posts the comment directly; it does
  not answer with a draft plus "Reply yes to post."
- Applied: a clear "yes" to one exact delete or merge proposal is consumed
  once and executes without another confirmation loop.
- Applied: an optional Computer file access boundary leaves default Wakes
  untouched. A deterministic working-folder conflict stops without a redundant
  question; only an unverifiable active boundary asks the Computer owner once
  for that exact Wake, and reconnect replays rather than duplicates it.
- Applied: Routine instructions are standing task direction for ordinary safe
  actions, so each Run does not interrupt the user for approval. They are not a
  destructive permission database: a Routine delete or merge is skipped with
  `routine_destructive_action_unsupported` and zero side effects.
- Applied: Center Agent may use account names and emails to decide whether one
  existing member account is worth offering when a personal action is blocked.
  The signed-in person still sees both accounts and explicitly connects them.
  Model confidence or a reply such as "yes" never becomes authority.
- Violation looks like: treating a tool's ability to write as a reason to ask
  again after the user already asked for that write, making an unattended
  Routine impossible because no one is present to repeat its instruction, or
  silently linking two accounts because a model found their names similar.

## 10. Guide the action; do not assign the thinking

A beginner flow should make the useful next action feel obvious without asking
the user to form a product strategy, invent a prompt, or understand the
architecture first. Demonstrate the concrete outcome, supply safe defaults, and
keep the explanation shorter than the decision.

- Applied: Account Setup Studio says Slack, GitHub, Codex, and Claude Code,
  shows what each connection enables, defaults untouched safe settings on, and
  lets the user continue without composing a message to Center Agent.
- Applied: a recommendation pairs one primary action with a programmatic demo;
  optional details expand only when the user chooses to edit them.
- Violation looks like: opening onboarding with "What do you want AI to do for
  your organization?", teaching Center Agent vocabulary before it has useful
  context, or using a paragraph where one labeled outcome and animation would
  work.
