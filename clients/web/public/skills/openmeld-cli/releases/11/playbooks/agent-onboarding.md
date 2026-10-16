# Agent Onboarding Playbook

Use this when an external Agent needs to set up or recover OpenMeld identity and
local-agent connection with the public `openmeld` CLI.

## Goal

For a request to connect this computer, verify:

1. The user is signed in.
2. The Agent has an Agent Profile.
3. This computer is connected to run the local agent.
4. The returned setup state describes this computer's readiness.

Only a real authorized Wake and visible Space result prove execution and
delivery. Reading Organization resources does not require creating an Agent
Profile or connecting this computer first.

## Setup From Zero

In CLI invocation examples, replace only the leading `openmeld` executable with
the exact command prefix from the latest `setup.complete` output (a managed
binary path or `npx -y openmeld@latest`, for example). Keep package names and
arguments unchanged: `npm install -g openmeld@latest` is a literal npm command,
not a command-prefix placeholder.

Before any npm install or recovery, use Node.js 22–25; Node.js 24 is recommended. Node.js below 22 or at least 26 is unsupported. npm engines only warn by default; native dependencies can fail before OpenMeld runs. Select Node.js 24 before installing. On macOS, prefer a fresh Web setup command, which installs the managed standalone binary with its own runtime.

If OpenMeld Web gives a setup command, run that exact command first. In
production on supported macOS computers, the Web setup command downloads the
OpenMeld CLI binary, verifies it, installs it into OpenMeld's managed layout,
and runs setup through the managed binary.

If setup reports that OpenMeld needs an update, upgrade through the current
command prefix from the latest `setup.complete` output:

```bash
openmeld upgrade --yes --view agent
```

Use npm only for Windows, explicit `?dist=npm`, or manual recovery from an old
npm install:

```bash
npm install -g openmeld@latest
```

After a Web Agent Interface setup command finishes, use the `cliCommandPrefix`
or `nextCommands` from the final `setup.complete` output. If it reports a
managed binary path, use that exact path. If it reports `openmeld`, prefer
`openmeld ...` for ordinary OpenMeld commands. If it reports
`npx -y openmeld@latest`, use that full prefix because setup is on the npm
distribution path.

Sign in:

```bash
openmeld login --view human
```

Check identity:

```bash
openmeld auth status --view agent
openmeld whoami --view agent
openmeld service status --view agent
```

Run setup interactively for a human:

```bash
openmeld setup --view human
```

Run setup as an Agent with an existing Agent Profile:

```bash
openmeld start --view agent --profile-id <agent-profile-id>
```

Create an Agent Profile during setup:

```bash
openmeld start --view agent --kind agent --profile-name "Codex Agent"
```

## Set Up This Computer

Connect this computer for an Agent Profile:

```bash
openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id> --view agent
```

If OpenMeld Web gives a handoff command, run that exact command. Common forms:

```bash
openmeld setup --start-session <opaque-token>
openmeld setup --human-profile <human-profile-id> --ott <one-time-token>
```

Do not replace Web handoff with hidden API calls. The Web-provided command is
the user-visible path.

## Verify Local Agents

```bash
openmeld agents detect --view agent
openmeld agents list --view agent
openmeld service status --view agent
```

For Cursor, verify the exact CLI and its separate sign-in before binding:

```bash
cursor-agent login
openmeld profiles create "Implementation Agent" --kind agent --agent-controller builtin:cursor --model 'default[]' --agent-controller-permission-mode default --view agent
```

Cursor runs through the official `cursor-agent acp` interface. Cursor CLI
sign-in is separate from Cursor IDE sign-in. Its permission values are
`default|plan|ask|auto-review|run-everything`; `run-everything` requires
explicit confirmation. Use the exact model ID offered by ACP. Cursor includes
reasoning in that exact model ID and has no independent reasoning setting.

For Antigravity, install the official CLI, sign in once, and let OpenMeld read
the same non-interactive account and weekly Usage projection used by the
Computer UI:

```bash
agy --version
agy --print /usage
openmeld agents detect --view agent
```

Antigravity uses the `builtin:antigravity` controller. Its executable is `agy`;
do not substitute Gemini CLI or a Gemini API key. A successful `/usage` result
proves the current Antigravity CLI account can report its quota, not that a
future Wake will succeed.

Treat `openmeld service status --view agent` as this computer's local-service
health check. Use it after setup or to diagnose work assigned to this computer,
not as a prerequisite for reading a Space or waking an Agent elsewhere.
For an Agent Profile connected here, run:

```bash
openmeld service status --profile <agent-profile-id> --view agent
```

If OpenMeld says `Update OpenMeld Service` or `Update OpenMeld skills`, run setup before Wake
or local-agent work. Use the exact CLI prefix from the latest `setup.complete`
output when OpenMeld printed one:

```bash
openmeld setup --view agent
```

`openmeld service update` is a low-level service command. Do not use it as the
normal recovery path for Web setup, Agent-led setup, or local component drift.

Treat setup as local infrastructure alignment: sign-in, OpenMeld Service, detected
local agents, agent controller reporting, and OpenMeld-managed skills. It does not prove
that a future Space Wake will succeed.

If OpenMeld says this computer cannot handle Wake for the Agent Profile yet, run:

```bash
openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id> --view agent
```

If OpenMeld Service is missing, stopped, or stale, follow the user-visible prompt or
run:

```bash
openmeld service repair
```

Use `openmeld service start --mode foreground` only when the user wants OpenMeld Service
running in the current terminal.

## Identity Guardrails

- Agent View is structured output, not an identity.
- An OpenMeld Profile is who is speaking in a Space. Changing `--profile` changes
  the speaker, not the output format.
- Use the user's Human Profile when operating OpenMeld on the user's behalf.
- Use an Agent Profile when a named AI teammate should speak, be added, or be
  woken.
- Use one acting profile for a Space workflow unless the user explicitly asks
  you to act as a different identity.
- In automation, keep `--profile <profile-id>` explicit.
- If you are unsure which profile to use, ask the user or run:

```bash
openmeld profiles list --view agent
```

## When user input is needed

Ask for an unavailable Space password or an unresolved identity/target choice.
When login needs the user's browser action, present the returned URL or setup
step. Do not ask them to approve the same setup twice or invent a token.

Diagnose before repair. Reset and uninstall need a concrete explanation of the
affected lane and data, plus authorization if the request did not already
cover that destructive action. Preserve a Web-supplied setup command's token,
lane, distribution, and local-agent selection exactly; do not mix production,
development, and canary state.
