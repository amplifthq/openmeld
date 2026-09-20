# OpenMeld

**People and agents, working as one.**

The open-source operating system for agent-native teams of people and machines.

OpenMeld connects your Center Agent, Slack, shared cloud Spaces, and every
teammate's local Claude Code, Codex, Cursor, and OpenCode agents into one
organization-wide system.

<!-- badges: build | npm (openmeld) | license | discord — add once CI, npm publish, and community links are live -->

Start with your Center Agent. Talk to it from OpenMeld or Slack; it sets up the workspace, brings in teammates, and connects the right local coding agents. The work still runs on each teammate's machine, and the result comes back to the Space where everyone can see it.

---

## What is OpenMeld

OpenMeld is built around one loop: a need is raised in a Space, dispatched to a human or an agent, executed where the work actually lives, and the result comes back to the same Space. Everything below is that loop, disclosed one layer at a time — the same way the product itself reveals it.

### 1. The solo loop

This is the whole product in one person's hands.

You create a **Space** — a shared room for a piece of work. You connect a computer (your laptop, a workstation, a cloud box) so the agents on it become reachable. Then you write a message and **@-mention** an agent:

> @build-agent(wake) rerun the migration and paste the failing rows

That mention is a **Wake**. OpenMeld routes it to the agent's real runtime — Claude Code, Codex, or whatever local agent tool it's bound to — which executes on your machine and posts one reply, or one explicit failure, back into the Space. Because the Space lives in the cloud, you can fire that Wake from your phone on the train and read the answer when it lands. The heavy work stays local; only the conversation and the result travel.

One person commanding a fleet of agents is already a complete OpenMeld. You never have to meet another concept to get value.

### 2. The Center Agent

As your fleet grows, you get a coordinator.

Your **Center Agent** is your chief of staff — a resident agent that holds the context across your whole fleet and helps you turn a vague need into a running, correctly set-up Space. You tell it what you're trying to do; it shapes the work, spins up the right Space, brings in the right agents, and gets things moving. It works through the exact same Wake pipeline every other agent uses — no special channel, no privileged backdoor — and every action it takes on your behalf is attributed and audited.

The Center Agent is a first-class surface, not a buried setting. It's the difference between owning a pile of agents and running an organization of them.

### 3. Organizations

When you're ready to bring in other people, you create an **Organization**.

An Organization is a shared boundary where teammates work the loop together: share agents, see everyone's fleet in one directory, invite humans and agents into Spaces, and let an Organization-level Center Agent coordinate the group. Roles (`owner`, `admin`, `member`) decide who can manage what. Your agents stay yours — you authorize specific ones into the Organization, revocably — while the Organization gives the loop a place to run at organization scale.

Until you invite someone, none of this is in your way. OpenMeld is **organization-level infrastructure for the AI work-loop** — not a chat app that happens to let bots in. The core object is always the loop, whether one person or twenty are running it.

---

## Quick Start

Sign up, start in a conversation with your organization's Center Agent, then connect your computer when you want local agents to pick up real work from the cloud.

**1. Start with your Center Agent.**

Sign up at [openmeld.ai](https://openmeld.ai). You'll land in a conversation with your organization's Center Agent. Ask it anything, or tell it what you're working on and it can set up a Space for that work.

**2. Optionally add a computer.**

Use **Connect this computer** when you want your local agents — Claude Code, Codex, Cursor, OpenCode, or another supported tool — to pick up work from OpenMeld. OpenMeld gives you a one-time command to paste into a terminal on the machine whose agents you want to reach:

```bash
curl -fsSL https://openmeld.ai/setup | sh
```

The exact command is generated for you (it carries a one-time token that signs this machine in and connects its local agents). It installs the OpenMeld background service, detects the AI coding tools already on the machine, and connects them. The web page flips to **Connected** when it's done.

Prefer to drive it from the CLI yourself? Install the CLI globally and run setup directly:

```bash
npm install -g openmeld@latest
openmeld setup
```

**3. Wake an agent in a Space.**

In a Space, @-mention one of your now-connected agents:

```
@your-agent(wake) summarize what changed in the last commit
```

The agent runs on your machine and replies in the Space. That's the loop.

> Setup is designed to be optional and re-runnable. A Space works as a plain human chat room with zero setup; local agents are something you add when you want them, and `openmeld setup` (or its read-only twin `openmeld doctor`) is always safe to run again.

---

## Core Concepts

| Concept | What it is |
| --- | --- |
| **Space** | The shared cloud room where a piece of work happens. People and agents talk here; it's both where a Wake starts and where the reply lands. |
| **Agent Profile** | An AI teammate's identity — its name, instructions, and continuity. This is *who* you talk to, independent of which tool or machine currently runs it. |
| **Binding** | The link between an Agent Profile and the local agent tool that executes for it. Think of the Agent Profile as the **badge** (a stable identity) and the Binding as the **desk** (the machine and tool it's working at right now). Rebinding moves the desk without changing the badge. |
| **Center Agent** | An Organization's designated coordinator — a normal Agent Profile with a designation that lets it set up Spaces and bring in teammates on the org's behalf. Additive powers only; audited. |
| **Organization** | The boundary the loop runs inside. Owns Spaces, agent authorizations, and membership. You get one for yourself automatically; you create more to collaborate with people. |

**Addressing:** a message can `@Name(wake)` an Agent Profile to assign work, `@Name(reference)` an Agent Profile to include it as context without assigning work, or `@Name(mention)` a person to notify them. **Only an Agent Wake puts an agent to work; a Human Mention creates Inbox and browser attention without entering agent execution.**

---

## Architecture at a glance

The cloud side runs entirely on **Cloudflare Workers**, with **Durable Objects** holding per-Space state, **D1** as the durable ledger, and **Queues** carrying dispatch. The execution side is the **OpenMeld Service**: a small background service on each of your computers that carries Space work to the local agent tools and reports back. The cloud owns the conversation and the routing; your machine owns the work and stays the trust boundary for it.

```text
  Space message (@agent wake)          ── Web or CLI, from anywhere
        │
        ▼
  Gateway  ──►  Core (Durable Objects)  ── auth, routing, Space state
        │
        ▼
  OpenMeld Service (on your computer)   ── carries the local run
        │
        ▼
  Local agent (Claude Code, Codex, …)   ── does the actual work
        │
        ▼
  Reply or explicit failure ──► Space   ── one visible outcome
```

The rule that keeps this honest: a Wake produces exactly **one visible reply or one explicit visible failure**. Setup, readiness, and diagnostics exist only to help you reach, understand, or repair that loop — they are never mistaken for the loop itself.

---

## Development

For commit, push, validation, and merge instructions, follow the shared
[CI/CD workflow](developing/engineering/agent-native-delivery.md#daily-workflow).
It applies equally to engineers, Codex, Claude Code, and other coding agents.

OpenMeld is a pnpm + Turborepo monorepo.

```text
services/     Cloudflare Workers — core (state authority), gateway (public ingress), auth
packages/     shared domain code — protocol, schemas, agent-runtime, db, ui, …
clients/      openmeld-cli, web app, desktop, create-openmeld scaffold
runtime/      local execution + adapters (claude-code, codex, cursor, opencode, …)
```

Requires [**Node 24**](https://nodejs.org/en/download) and the repository-pinned
**pnpm 10**. After installing Node, let Corepack install the exact pnpm version
declared in `package.json`:

```bash
corepack enable
corepack install
```

Install the Doppler CLI from its
[official installation guide](https://docs.doppler.com/docs/install-cli), then
authenticate once with `doppler login`. The normal Docker-free local workflow
uses two terminals:

```bash
# Terminal 1
pnpm install --frozen-lockfile
pnpm dev:doctor
pnpm dev:worktree

# Terminal 2, after the Worker stack reports ready
pnpm dev:web:worktree
```

Use the localhost URLs printed by the launchers; worktrees do not use one fixed
port set. Run `pnpm dev:help` for the Sandbox/Docker boundary and cleanup
commands. The full environment model and migration safety rules live in
[`developing/engineering/environment-and-secrets.md`](./developing/engineering/environment-and-secrets.md).

Use `pnpm check`, `pnpm test`, and `pnpm test:full` for repository validation.

Before contributing, start with **[AGENTS.md](./AGENTS.md)** — it's the single router to the owner documents under [`developing/`](./developing/) that hold the product model, transport contract, client boundaries, and engineering workflow. It's written for coding agents, and it's the fastest way for a human to find the right context too.

---

## Status

OpenMeld is **early-stage and evolving quickly**. It is being dogfooded — the team builds OpenMeld inside OpenMeld — and the surface is still moving. **Expect breaking changes**, including to CLI flags, on-the-wire contracts, and data shapes, until things settle.

Known limitations worth calling out up front:

- **The hosted Center Agent is live and experimental.** It is Flue-based, OpenMeld-operated, and can be woken from OpenMeld and from Slack. Slack support is experimental and currently bound to one Slack workspace per OpenMeld organization.
- **Session sync isn't built yet.** Organization-wide visibility into what every agent is running is a planned pillar, not a current feature.
- **The optional desktop app is unsigned.** If you try the early macOS desktop build, it ships un-notarized, so Gatekeeper will quarantine it and you'll need a manual `xattr -dr com.apple.quarantine` step to open it. The CLI is the primary, fully supported entry point and has no such caveat.

---

## License

See [LICENSE](./LICENSE).
