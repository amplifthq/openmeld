# Claude Code Entrypoint

Read [AGENTS.md](../AGENTS.md) first and follow it. It is the single
agent-facing rule authority for this repository: production guardrails,
context routing to `developing/` owner documents, core invariants, task
rules, testing gates, lane safety, and commit rules all live there.

This file is a thin adapter and must stay one. Do not copy rules, routing
tables, or architecture facts into it; change `AGENTS.md` or the owning
`developing/` document instead.

Code standards live in
[developing/engineering/code-standards.md](../developing/engineering/code-standards.md)
and are routed from `AGENTS.md`.
