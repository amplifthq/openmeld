import {
	buildAgentFacingMentalModelLines,
	buildAgentFacingPublicationModeGuideLines,
} from "@openmeld/space-mesh";
import { describe, expect, it } from "vitest";
import {
	AGENT_INTERFACE_GUIDE_MARKDOWN,
	buildAgentInterfacePrompt,
	OPENMELD_SKILL_MARKDOWN,
} from "./agent-interface-guide";

describe("OpenMeld public Skill", () => {
	it("teaches setup, skills, and Space operations without requiring auth", () => {
		expect(OPENMELD_SKILL_MARKDOWN).toContain("OpenMeld Skill");
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toBe(OPENMELD_SKILL_MARKDOWN);
		for (const line of buildAgentFacingMentalModelLines()) {
			expect(OPENMELD_SKILL_MARKDOWN).toContain(line);
		}
		for (const line of buildAgentFacingPublicationModeGuideLines()) {
			expect(OPENMELD_SKILL_MARKDOWN).toContain(line);
		}
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> skills ensure --all --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain("--local-agents all");
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Prefer the smallest useful action"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"shift from installer to OpenMeld operator"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"OpenMeld is not a role-play multi-agent app"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"A Space is both the shared room and a lightweight work protocol"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"each agent's private session stays local by default"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"describe them as choices to add to a Space"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"OpenMeld found Codex, Claude Code, Cursor, and OpenCode on this computer"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"turning the current local agent session into a wakeable teammate"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Codex Desktop, Codex CLI, Claude Code Desktop, or Claude Code CLI"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Cursor runs through the official `cursor-agent acp` interface"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Cursor CLI sign-in is separate from Cursor IDE sign-in"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Cursor includes reasoning in the exact model choice"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Use plain local-agent language in this first user-facing choice"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Explain Agent Profiles after the user chooses a local agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"an Agent Profile is the agent's name and identity inside the Space"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"uses the OpenMeld-managed workspace by default"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			'openmeld profiles create "<profile-name>" --kind agent --agent-controller builtin:<local-agent-id> --view agent'
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"--agent-controller-conversation-id <current-agent-conversation-id>"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"not a Space ID, OpenMeld service runtime ID, or CLI context ID"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"printf '%s\\n' \"$CODEX_THREAD_ID\""
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Use the thread ID with `--agent-controller builtin:codex`"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"printf '%s\\n' \"$CLAUDE_CODE_SESSION_ID\""
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain("also record `pwd`");
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Claude Code session ID and original Project folder as one binding fact"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			'openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent'
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Use profile-specific setup only when a later OpenMeld command explicitly asks"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).not.toContain(
			"space status <space-id> --profile <profile-id> --json --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).not.toContain(
			"openmeld setup --profile <profile-id> --local-agent <local-agent-id> --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Existing Agent Profiles are optional identities, not defaults"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"wait for the user's choice before using it"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain("Run setup sequentially");
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"When OpenMeld marks a local agent unavailable"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Offer a live test as an optional next step"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<DISPATCH_ACTION_CLI> space action wake"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Do not guess it or rewrite it to `npx`"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"installs the managed OpenMeld CLI binary by default"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"openmeld upgrade --yes --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"use the final `setup.complete` prefix for normal follow-up commands"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Windows and explicit `?dist=npm` setup commands use the npm package path"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"The user's default human profile is created automatically."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Agent View is an output mode for AI agents. It is not an identity."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"An OpenMeld Profile is who is speaking in a Space."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Changing `--profile` changes the speaker, not the output format."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			'<OPENMELD_CLI> profiles create "OpenMeld Operator" --kind agent --view agent'
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> space history <space-id> --profile <profile-id> --kind text --brief --limit 20 --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain("Health checkpoints");
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> service status --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> service status --profile <agent-profile-id> --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Do not turn that into a profile-by-profile diagnostic pass"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"If OpenMeld says `Update OpenMeld Service`, run setup before Wake or local-agent work:"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> setup --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> space create --profile <profile-id>"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> space add-agents <space-id> --agent-profile <agent-profile-id> --profile <acting-profile-id> --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> space add-human-profiles <space-id> --human-profile <human-profile-id> --profile <acting-profile-id> --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> space add-members <space-id> --member <profile-id> --profile <acting-profile-id> --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"`space list` proves that Space records are visible. It does not prove the conversation is readable."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Space availability labels describe whether OpenMeld currently has enough evidence to attempt Wake."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"If you send a setup recovery report, separate these facts with yes/no answers"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"`setup.complete` reached, background OpenMeld Service healthy, foreground service probe used"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Do not call setup fixed only because a Space member badge says `Available`"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"They do not prove setup completed, the background OpenMeld Service is healthy"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"Use OpenMeld Space Action commands only when you are running inside an OpenMeld-launched Space Wake dispatch."
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).toContain(
			"<OPENMELD_CLI> space publication set <space-id> transparent --profile <owner-profile-id> --password <space-password> --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).not.toContain(
			"openmeld whoami --view agent"
		);
		expect(AGENT_INTERFACE_GUIDE_MARKDOWN).not.toContain("openmeld --help");
	});

	it("builds the short prompt that points agents at the public Skill", () => {
		const prompt = buildAgentInterfacePrompt({
			cliCommandPrefix: "openmeld-dev",
			command: "openmeld setup --start-session preptok --view agent",
			skillUrl: "https://openmeld.invalid/SKILL.md",
		});

		expect(prompt).toContain("https://openmeld.invalid/SKILL.md");
		expect(prompt).toContain(
			"openmeld setup --start-session preptok --view agent"
		);
		expect(prompt).toContain("openmeld-dev whoami --view agent");
		expect(prompt).toContain("openmeld-dev service status --view agent");
		expect(prompt).not.toContain(
			"openmeld-dev skills ensure --all --view agent"
		);
		expect(prompt).toContain("Read the official OpenMeld Skill");
		expect(prompt).toContain("Agent Interface Setup path");
		expect(prompt).not.toContain("BEGIN OpenMeld SETUP COMPLETE");
		expect(prompt).toContain(
			"If setup does not produce `setup.complete`, try the OpenMeld setup recovery path before stopping."
		);
		expect(prompt).toContain("Update OpenMeld to the latest CLI");
		expect(prompt).toContain("send a compact evidence report to the Space");
		expect(prompt).toContain(
			"In any setup recovery report, answer these facts explicitly"
		);
		expect(prompt).toContain("did `setup.complete` appear");
		expect(prompt).toContain("is the background OpenMeld Service healthy");
		expect(prompt).toContain("did you use a foreground service probe");
		expect(prompt).toContain(
			"Do not call setup fixed just because a Space member badge says `Available`"
		);
		expect(prompt).toContain(
			"If setup succeeds but an older CLI does not print `setup.complete`, use this fallback OpenMeld CLI prefix"
		);
		expect(prompt).not.toContain(
			"If setup does not produce `setup.complete`, stop"
		);
		expect(prompt).not.toContain("OpenMeld Space Action");
		expect(prompt).not.toContain("Then ask one simple next-step question");
		for (const line of buildAgentFacingMentalModelLines()) {
			expect(prompt).not.toContain(line);
		}
		expect(prompt).not.toContain(
			"Changing `--profile` changes the speaker, not the output format."
		);
	});
});
