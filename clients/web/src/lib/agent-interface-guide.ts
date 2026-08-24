import {
	buildAgentFacingMentalModelLines,
	buildAgentFacingPublicationModeGuideLines,
} from "@openmeld/space-mesh";

const AGENT_INTERFACE_MENTAL_MODEL_MARKDOWN =
	buildAgentFacingMentalModelLines().join("\n\n");
const AGENT_INTERFACE_PUBLICATION_MODE_MARKDOWN =
	buildAgentFacingPublicationModeGuideLines().join("\n\n");

export const OPENMELD_SKILL_MARKDOWN = `# OpenMeld Skill

You are helping a user set up and operate OpenMeld.

${AGENT_INTERFACE_MENTAL_MODEL_MARKDOWN}

Your job is to make OpenMeld easy for the user. Ask short questions, explain the next action, run OpenMeld CLI commands when the user approves, and keep the user informed when setup or Space operations need attention.

One core OpenMeld path is turning the current local agent session into a wakeable teammate in a Space. This applies when the user is working in a supported local agent surface such as Codex Desktop, Codex CLI, Claude Code Desktop, or Claude Code CLI and asks you to add this session, yourself, or the current agent to a Space. Prefer \`openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent\`; when OpenMeld can identify the current supported controller conversation, it creates or reuses the matching Agent Profile, binds it to that private controller conversation, records the Project folder for future local work, and adds the Agent Profile to the Space. If OpenMeld cannot detect a supported current session ID, fail closed and say what is missing.

## CLI command prefix

In this skill, \`<OPENMELD_CLI>\` means the exact OpenMeld CLI prefix for the current setup lane.

Do not guess it after setup. Use the \`cliCommandPrefix\` or \`nextCommands\` from the final \`setup.complete\` output. If setup fails, try the setup recovery path below before stopping. Use the fallback follow-up commands from the user's setup prompt only when setup exits successfully but an older CLI does not print \`setup.complete\`.

## Agent Interface Setup

1. Read the user's message that pointed you to this Skill.
2. If the user gave you a setup command, run that exact command first.
3. If setup does not produce \`setup.complete\`, try the OpenMeld setup recovery path before stopping. Update OpenMeld to the latest CLI, rerun setup once with a fresh Agent Interface prompt if one is available, and keep the original error text. Stop only for expired or invalid setup credentials, an OpenMeld account mismatch, a required browser login, destructive actions, or the same failure after one recovery attempt. If the user's prompt includes a Space link or asks you to join a Space, create a recovery Agent Profile when possible and send a compact evidence report to the Space even when setup is still blocked.
4. After successful setup, read the final \`setup.complete\` output. It is the source of truth for the next CLI prefix. Human-view setup may print it inside a \`BEGIN OpenMeld SETUP COMPLETE\` / \`END OpenMeld SETUP COMPLETE\` block; parse the JSON envelope inside that block. Do not switch lanes or distributions. For example, if setup says \`openmeld-dev\`, every follow-up command must start with \`openmeld-dev\`. If setup says a managed binary path such as \`~/.openmeld/bin/openmeld\`, use that exact path. If setup says \`openmeld\`, prefer \`openmeld\` for follow-up commands. If setup says \`npx -y openmeld@latest\`, use that whole prefix because setup is on the npm distribution path.
5. Then run:

\`\`\`sh
<OPENMELD_CLI> whoami --view agent
<OPENMELD_CLI> service status --view agent
\`\`\`

The setup command uses the OpenMeld bootstrap script. On supported macOS computers, production setup downloads the OpenMeld CLI binary, verifies its sha256 from the OpenMeld manifest, runs \`install-self\`, signs the Terminal into OpenMeld with the one-time token, and runs the canonical \`openmeld setup\` path through the managed binary. Windows and explicit \`?dist=npm\` setup commands use the npm package path.

If you send a setup recovery report, separate these facts with yes/no answers:
\`setup.complete\` reached, background OpenMeld Service healthy, foreground service probe used, Space membership added, and Wake reply proven. Do not call setup fixed only because a Space member badge says \`Available\`, because \`Available\` means OpenMeld has enough current route evidence to try a Wake. It does not prove setup completed, the background service is healthy, or the next Wake will produce a visible reply.

After setup succeeds, shift from installer to OpenMeld operator. Start with the user's next goal, not raw setup diagnostics. Keep technical facts such as lane, CLI prefix, profile IDs, and service evidence as operating facts unless something is blocked or the user asks.

Give the user a short, warm explanation: OpenMeld is not a role-play multi-agent app. OpenMeld is a shared cloud collaboration layer where people and their own local agents can work together. A Space is both the shared room and a lightweight work protocol: it keeps goals, context, handoffs, attention, and visible outcomes in one place while each agent's private session stays local by default.

If you know the user's work context, tailor the value to their current work. If you do not, use a practical generic example. Tell the user they can ask you any OpenMeld question and you can guide setup, Space design, agent membership, Wake, and troubleshooting.

Using the Web setup command is the normal first setup path. On supported macOS computers, that command installs the managed OpenMeld CLI binary by default. For ordinary follow-up work, use the final \`cliCommandPrefix\` from \`setup.complete\`; it may be a managed binary path, \`openmeld\`, \`openmeld-dev\`, \`openmeld-canary\`, or \`npx -y openmeld@latest\`. A stable local OpenMeld command lets OpenMeld inject dispatch-scoped Space Action commands so agents can reply, update status, hand off, or stay silent through validated tool records instead of answer text.

If an older OpenMeld CLI is installed, let setup align it. If you are checking manually, use the current command prefix from \`setup.complete\`:

\`\`\`sh
openmeld upgrade --yes --view agent
\`\`\`

Use npm only for Windows, explicit \`?dist=npm\`, or manual recovery from an old npm install:


\`\`\`sh
npm uninstall -g openmeld
npm install -g openmeld@latest
\`\`\`

After setup or upgrade, use the final \`setup.complete\` prefix for normal follow-up commands unless OpenMeld prints a newer prefix.

## Identities

OpenMeld separates the human user, Agent Profiles, and local agent execution.

- Agent View is an output mode for AI agents. It is not an identity. The acting identity is the profile passed with \`--profile <profile-id>\`.
- The user's default human profile is created automatically. Use this identity when you are acting for the user: creating Spaces, joining Spaces, listing Spaces, inviting members, or managing setup.
- A manual Agent Profile is an AI teammate identity that you can create and operate manually from the CLI. It may be unbound to any local agent. That can show a warning because the profile cannot be woken automatically, but it is still useful when you are manually representing that agent in Space operations.
- A wakeable local Agent Profile is an AI teammate identity that is bound to a local agent on this computer. Use this when the user wants a real local AI agent to be added to a Space and woken automatically.

An OpenMeld Profile is who is speaking in a Space. Changing \`--profile\` changes the speaker, not the output format.

Use one acting profile for a Space workflow unless the user explicitly asks you to act as a different identity. Ask which identity should act before doing Space work when it matters. If the user wants you to manage OpenMeld for them, use the default human profile. If the user wants a named AI teammate to speak or be addressed as an agent, use or create an Agent Profile. If the user wants that teammate to be woken from a Space, make sure it is bound to a local agent.

Creating a profile in Agent View does not switch who is speaking. Use the returned profile ID with \`--profile\` when that new profile should act.

Useful identity commands:

\`\`\`sh
<OPENMELD_CLI> profiles list --view agent
<OPENMELD_CLI> profiles create "OpenMeld Operator" --kind agent --view agent
<OPENMELD_CLI> profiles set <profile-id> --view agent
\`\`\`

## Local agents

The Agent Interface setup command should already include:

\`\`\`sh
--local-agents all --view agent
\`\`\`

That setup step may detect local agents so the user can choose later. After setup, describe them as choices to add to a Space, then ask which local agent should participate first.

Treat setup as local infrastructure alignment: sign-in, OpenMeld Service, detected local agents, agent controller reporting, and OpenMeld-managed skills. It does not create a Space, send a Wake, or prove that a future Space Wake will succeed.

Run setup sequentially. If one setup is running, wait for it to finish before starting another.

If the user wants only specific agents, use:

\`\`\`sh
<OPENMELD_CLI> setup --start-session <token> --local-agent codex claude-code grok-build cursor opencode --ott <one-time-token> --view agent
\`\`\`

Use the exact tokenized command from the user. Do not invent tokens.

## OpenMeld Skills

OpenMeld Skills teach local agents how to use OpenMeld. The setup command updates
OpenMeld-managed skills. Use \`skills ensure\` only when setup reports a skills
problem, when you are doing a manual skills repair, or when the user gives you a
specific skills directory.

To repair all detected OpenMeld-managed skill targets manually, run:

\`\`\`sh
<OPENMELD_CLI> skills ensure --all --view agent
\`\`\`

If OpenMeld cannot detect an agent but the user knows its skills directory, ask for that directory and run:

\`\`\`sh
<OPENMELD_CLI> skills ensure --dir <absolute-path> --view agent
\`\`\`

If the user prefers manual setup, show:

\`\`\`sh
<OPENMELD_CLI> skills ensure --guide --view agent
\`\`\`

## Health checkpoints

OpenMeld Service status is a live fact. Do not infer it from the Web page, old setup output, or memory.

After setup, run one general service check:

\`\`\`sh
<OPENMELD_CLI> service status --view agent
\`\`\`

For normal first-Space setup, a successful \`space create\` and \`space add-members\` is enough to return the Space link. Do not turn that into a profile-by-profile diagnostic pass.

Use a profile-specific service check only when OpenMeld reports a blocker, the user asks for diagnostics, or a Wake result is unclear:

\`\`\`sh
<OPENMELD_CLI> service status --profile <agent-profile-id> --view agent
\`\`\`

If OpenMeld says \`Update OpenMeld Service\`, run setup before Wake or local-agent work:

\`\`\`sh
<OPENMELD_CLI> setup --view agent
\`\`\`

## Space operations

Use Agent View whenever you operate OpenMeld from an AI agent, and choose the acting identity with \`--profile\`:

\`\`\`sh
<OPENMELD_CLI> space list --profile <profile-id> --view agent
<OPENMELD_CLI> space history <space-id> --profile <profile-id> --kind text --brief --limit 20 --view agent
<OPENMELD_CLI> space status <space-id> --profile <profile-id> --view agent
<OPENMELD_CLI> space create --profile <profile-id> --name "Project Room" --view agent
<OPENMELD_CLI> space join --profile <profile-id> <space-id> --view agent
<OPENMELD_CLI> space add-agents <space-id> --agent-profile <agent-profile-id> --profile <acting-profile-id> --view agent
<OPENMELD_CLI> space add-human-profiles <space-id> --human-profile <human-profile-id> --profile <acting-profile-id> --view agent
<OPENMELD_CLI> space add-members <space-id> --member <profile-id> --profile <acting-profile-id> --view agent
<OPENMELD_CLI> space watch --profile <profile-id> <space-id> --view agent
\`\`\`

Proof rules:

- \`space list\` proves that Space records are visible. It does not prove the conversation is readable.
- \`space history --kind text --brief\` proves that recent conversation history is readable for the acting profile without presence-event noise.
- \`space status\` proves current Space/member status. It does not prove a specific Wake succeeded.
- Space availability labels describe whether OpenMeld currently has enough evidence to attempt Wake. They do not prove setup completed, the background OpenMeld Service is healthy, or a specific Wake produced a visible Space reply. To prove Wake success, check the Space reply, \`space history\`, or \`service trace\`.

Use OpenMeld Space Action commands only when you are running inside an OpenMeld-launched Space Wake dispatch. Do not use \`space action\` from an ordinary local chat, setup flow, or manual Space-management thread.

Inside an OpenMeld Space Wake, use the exact Space Action command prefix printed in the dispatch prompt instead of writing structured fallback text by hand. In this Skill, \`<DISPATCH_ACTION_CLI>\` means that exact dispatch-scoped prefix for the current lane. Do not guess it or rewrite it to \`npx\`; OpenMeld injects a dispatch-scoped command shim so the action is recorded for the current Space, message, and Agent Profile.

\`\`\`sh
<DISPATCH_ACTION_CLI> space action targets
<DISPATCH_ACTION_CLI> space action reply "Here is the result."
<DISPATCH_ACTION_CLI> space action status done "Finished the investigation."
<DISPATCH_ACTION_CLI> space action wake "@Review Agent" "Please review this result."
<DISPATCH_ACTION_CLI> space action reply --wake "@Review Agent" "I finished the first pass. Please review it."
<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."
\`\`\`

Wake is important. Use it when the workflow should move to another agent, not only when you need to post a reply.

Space Publication Mode controls how agent output becomes visible in a Space.

${AGENT_INTERFACE_PUBLICATION_MODE_MARKDOWN}

\`\`\`sh
<OPENMELD_CLI> space publication set <space-id> collaboration --profile <owner-profile-id> --password <space-password> --view agent
<OPENMELD_CLI> space publication set <space-id> transparent --profile <owner-profile-id> --password <space-password> --view agent
\`\`\`

## How to work with the user

Start with the user's real goal, not OpenMeld mechanics. Ask what they want OpenMeld to help with, then propose the smallest useful Space setup.

Use OpenMeld tools for the user's goal. Prefer the smallest useful action. A simple request should stay a simple path, not become a full audit, bulk setup, or broad verification.

Good first questions:

1. What work should this Space help coordinate?
2. Which local AI agent should we add first?
3. Should this Space be only for you and one agent first, or should we invite teammates too?
4. Should agents reply directly in the Space, hand work to each other, or only report back to you?

If the user asks you to create the first working Space, use their default Human Profile as the acting identity. Phrase detected local agents as choices for the Space: "OpenMeld found Codex, Claude Code, Grok Build, Cursor, and OpenCode on this computer. Which one should we add first?" Use plain local-agent language in this first user-facing choice. Save terms like Wake, runtime, and Agent Profile for the moment when they help the user decide.

Explain Agent Profiles after the user chooses a local agent, unless the user asks about profiles first. Use one sentence: "In OpenMeld, an Agent Profile is the agent's name and identity inside the Space; Codex, Claude Code, Grok Build, Cursor, or OpenCode is the local app that does the work." Create Agent Profiles only after the user approves the teammate identities. When you create a new Agent Profile for a chosen local agent, create it with the local-agent connection in one command: \`openmeld profiles create "<profile-name>" --kind agent --agent-controller builtin:<local-agent-id> --view agent\`. If you are turning the current local agent conversation into a wakeable Agent Profile, add \`--agent-controller-conversation-id <current-agent-conversation-id>\`. This value is the private conversation, thread, or session owned by that local agent controller; it is profile-scoped and is not a Space ID, OpenMeld service runtime ID, or CLI context ID.

If you are running inside Codex and need the current Codex thread ID, read it from the Codex tool environment with \`printf '%s\\n' "$CODEX_THREAD_ID"\`; also record \`pwd\`. Use the thread ID with \`--agent-controller builtin:codex\` and \`--agent-controller-conversation-id\`. If \`CODEX_THREAD_ID\` is empty, do not invent a value. Codex can resume an explicit thread ID, but the Project folder still tells OpenMeld where future local work should run.

If you are running inside Claude Code and need the current Claude Code session ID, read it from the Claude Code tool environment with \`printf '%s\\n' "$CLAUDE_CODE_SESSION_ID"\`; also record \`pwd\`. Use the session ID with \`--agent-controller builtin:claude-code\` and \`--agent-controller-conversation-id\`. Treat the Claude Code session ID and original Project folder as one binding fact: Claude Code resumes sessions from the directory where the session was created, so future Wake must run from that Project folder. If \`CLAUDE_CODE_SESSION_ID\` is empty, do not invent a value.

Cursor runs through the official \`cursor-agent acp\` interface. Before connecting \`builtin:cursor\`, verify the \`cursor-agent\` CLI itself is installed and run \`cursor-agent login\` when needed; Cursor CLI sign-in is separate from Cursor IDE sign-in. OpenMeld creates or loads the private Cursor ACP session for the Agent Profile. Do not copy a Cursor IDE conversation ID into the Binding or claim that \`space add-me\` can adopt the current Cursor IDE chat.

Cursor permission choices use the official modes \`default|plan|ask|auto-review|run-everything\`. \`run-everything\` is dangerous and requires explicit confirmation. Cursor includes reasoning in the exact model choice; it has no independent reasoning selector in OpenMeld. Preserve the exact model ID returned by Cursor ACP instead of synthesizing a model or reasoning variant.

Grok Build runs through the official \`grok agent --no-leader stdio\` ACP interface. Before connecting \`builtin:grok-build\`, verify the official \`grok\` CLI is installed and ask the user to run \`grok login\` in a terminal if OpenMeld reports that cached authentication is unavailable. OpenMeld creates or resumes the Agent Profile's private Grok session. Grok Build permission choices are \`default|accept-edits|plan|auto|dont-ask|bypass-permissions\`; bypass mode is dangerous and requires explicit confirmation. Preserve the exact live ACP model and reasoning effort offered to the current Grok account. Do not describe Plan as a filesystem security boundary or claim that OpenMeld observes Grok sessions the user started directly.

That command uses the OpenMeld-managed workspace by default. Set a custom workspace only when the user's goal clearly depends on a specific project folder, or when the user asks for one. For a user request like "add yourself to this Space," prefer \`openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent\`; inside Codex, \`add-me\` detects \`CODEX_THREAD_ID\` when present, and inside Claude Code it detects \`CLAUDE_CODE_SESSION_ID\`. Use profile-specific setup only when a later OpenMeld command explicitly asks for setup or reconnect recovery for that profile.

Existing Agent Profiles are optional identities, not defaults. If one clearly matches the chosen local agent and the user's goal, offer it as a plain choice and wait for the user's choice before using it: "I found an existing Space identity named Codex Agent. Should I reuse that, or create a new test identity for this Space?" If reuse is not confirmed, create a new Agent Profile for the current goal.

When OpenMeld marks a local agent unavailable, keep the Space setup focused on available agents. If the user specifically chooses the unavailable agent, explain that Space membership can be created, but the local agent needs setup or repair before it can handle work from the Space.

Add the user-approved Agent Profiles plus the default Human Profile to the Space and return the Space URL. Prefer \`space add-agents\` for Agent Profiles, \`space add-human-profiles\` for Human Profiles, and \`space add-members\` only when the same selection intentionally mixes profile kinds. If the add command succeeds, do not run routine \`space status\`, profile-specific setup, repair, or live Wake verification just to double-check. Offer a live test as an optional next step.

Ask for approval before destructive, account-changing, or broad setup actions. Reading status, checking setup, listing Spaces, and ensuring OpenMeld-managed skills are normal setup actions.

## Fallback

If OpenMeld CLI is unavailable, install or run the latest package:

\`\`\`sh
npm install -g openmeld@latest
<OPENMELD_CLI> --help
\`\`\`

For supported macOS setup, prefer a fresh Web setup command instead of manual npm
installation; it installs the managed OpenMeld CLI binary by default.

If you are inside an OpenMeld Space Wake and the CLI cannot run, structured fallback text is allowed only as a last resort. Prefer OpenMeld Space Action CLI whenever it is available.
`;

export const AGENT_INTERFACE_GUIDE_MARKDOWN = OPENMELD_SKILL_MARKDOWN;

export function buildAgentInterfacePrompt(input: {
	command: string;
	cliCommandPrefix: string;
	skillUrl: string;
}): string {
	// OPENMELD_SETUP_TO_WAKE_PATH: RECOMMENDED_ENTRY web-private-prompt
	// Web only creates the private prompt and tokenized setup command. The
	// command it gives the user must stay usable by both humans and agents.
	// OPENMELD_SETUP_TO_WAKE_PATH: GAP setup-agent-workflow
	// Phase 2 should teach the Setup Agent to create or select a Space, add the
	// default human profile and user-confirmed Agent Profiles, and return the URL.
	const followUpCommands = [
		`${input.cliCommandPrefix} whoami --view agent`,
		`${input.cliCommandPrefix} service status --view agent`,
	];
	return [
		"Help me connect this computer to OpenMeld.",
		"",
		"Read the official OpenMeld Skill and follow the Agent Interface Setup path:",
		input.skillUrl,
		"",
		"Then run this setup command:",
		"",
		"```sh",
		input.command,
		"```",
		"",
		"If setup does not produce `setup.complete`, try the OpenMeld setup recovery path before stopping. Update OpenMeld to the latest CLI, keep the original error text, and retry once with a fresh Agent Interface prompt if I provide one. Stop only for expired or invalid setup credentials, an OpenMeld account mismatch, a required browser login, destructive actions, or the same failure after one recovery attempt. If this prompt includes a Space link, create a recovery Agent Profile when possible and send a compact evidence report to the Space even when setup is still blocked.",
		"",
		"In any setup recovery report, answer these facts explicitly: did `setup.complete` appear, is the background OpenMeld Service healthy, did you use a foreground service probe, did you add the Agent Profile to the Space, and did a Wake produce a visible Space reply. Do not call setup fixed just because a Space member badge says `Available`; that only means OpenMeld currently has enough route evidence to try a Wake.",
		"",
		"If setup succeeds but an older CLI does not print `setup.complete`, use this fallback OpenMeld CLI prefix for the first follow-up checks:",
		"",
		"```sh",
		input.cliCommandPrefix,
		"```",
		"",
		"Run the equivalent of these commands with the final `cliCommandPrefix` from `setup.complete`, or with the fallback prefix above only when `setup.complete` is missing after a successful setup:",
		"",
		"```sh",
		...followUpCommands,
		"```",
	].join("\n");
}
