import { describe, expect, it } from "vitest";
import {
	createInitialStartFlowState,
	parsePersistedStartFlowState,
	reduceStartFlowState,
	serializeStartFlowState,
} from "./start-flow-state";

describe("start flow state", () => {
	it("creates an empty initial state", () => {
		expect(createInitialStartFlowState()).toEqual({
			entryActor: "human",
			selectedHumanProfileId: null,
			localAgentSetupChoice: null,
			spaceChoice: null,
			joinMethod: null,
			targetSpaceId: null,
			targetSpaceName: null,
			targetSpaceSource: null,
			spaceEntrySelection: null,
		});
	});

	it("resets downstream selections when the human profile changes", () => {
		const nextState = reduceStartFlowState(
			{
				entryActor: "human",
				selectedHumanProfileId: "hum_old",
				localAgentSetupChoice: "setup_this_computer",
				spaceChoice: "create",
				joinMethod: "saved_space",
				targetSpaceId: "space-123",
				targetSpaceName: "Design review",
				targetSpaceSource: "join_existing",
				spaceEntrySelection: {
					status: "ready",
					selectedAdditionalProfileIds: ["agent-123"],
				},
			},
			{
				type: "set_selected_human_profile_id",
				selectedHumanProfileId: "hum_new",
			}
		);

		expect(nextState).toEqual({
			entryActor: "human",
			selectedHumanProfileId: "hum_new",
			localAgentSetupChoice: null,
			spaceChoice: null,
			joinMethod: null,
			targetSpaceId: null,
			targetSpaceName: null,
			targetSpaceSource: null,
			spaceEntrySelection: null,
		});
	});

	it("keeps the target space when the agent setup choice changes", () => {
		const nextState = reduceStartFlowState(
			{
				entryActor: "human",
				selectedHumanProfileId: "hum_123",
				localAgentSetupChoice: null,
				spaceChoice: "join",
				joinMethod: "saved_space",
				targetSpaceId: "space-123",
				targetSpaceName: "Design review",
				targetSpaceSource: "join_existing",
				spaceEntrySelection: {
					status: "ready",
					selectedAdditionalProfileIds: ["agent-123"],
				},
			},
			{
				type: "set_local_agent_setup_choice",
				localAgentSetupChoice: "skip_setup",
			}
		);

		expect(nextState).toEqual({
			entryActor: "human",
			selectedHumanProfileId: "hum_123",
			localAgentSetupChoice: "skip_setup" as const,
			spaceChoice: "join",
			joinMethod: "saved_space",
			targetSpaceId: "space-123",
			targetSpaceName: "Design review",
			targetSpaceSource: "join_existing",
			spaceEntrySelection: null,
		});
	});

	it("clears membership state when the space choice changes", () => {
		const nextState = reduceStartFlowState(
			{
				entryActor: "human",
				selectedHumanProfileId: "hum_123",
				localAgentSetupChoice: "skip_setup",
				spaceChoice: "join",
				joinMethod: "saved_space",
				targetSpaceId: "space-123",
				targetSpaceName: "Design review",
				targetSpaceSource: "join_existing",
				spaceEntrySelection: {
					status: "ready",
					selectedAdditionalProfileIds: ["agent-123"],
				},
			},
			{
				type: "set_space_choice",
				spaceChoice: "create",
			}
		);

		expect(nextState).toEqual({
			entryActor: "human",
			selectedHumanProfileId: "hum_123",
			localAgentSetupChoice: null,
			spaceChoice: "create",
			joinMethod: null,
			targetSpaceId: null,
			targetSpaceName: null,
			targetSpaceSource: null,
			spaceEntrySelection: null,
		});
	});

	it("restores web-only space member selection from storage", () => {
		const state = {
			entryActor: "human" as const,
			selectedHumanProfileId: "hum_123",
			localAgentSetupChoice: "skip_setup" as const,
			spaceChoice: "join" as const,
			joinMethod: "saved_space" as const,
			targetSpaceId: "space-123",
			targetSpaceName: "Design review",
			targetSpaceSource: "join_existing" as const,
			spaceEntrySelection: {
				status: "ready" as const,
				selectedAdditionalProfileIds: ["agent-123"],
			},
		};

		expect(
			parsePersistedStartFlowState(serializeStartFlowState(state))
		).toEqual({
			entryActor: "human",
			selectedHumanProfileId: "hum_123",
			localAgentSetupChoice: "skip_setup",
			spaceChoice: "join",
			joinMethod: "saved_space",
			targetSpaceId: "space-123",
			targetSpaceName: "Design review",
			targetSpaceSource: "join_existing",
			spaceEntrySelection: {
				status: "ready",
				selectedAdditionalProfileIds: ["agent-123"],
			},
		});
	});

	it("migrates legacy just-me space member selection from storage", () => {
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					spaceMemberChoice: "just_me",
					selectedSpaceMemberProfileIds: ["agent-123"],
				})
			)
		).toMatchObject({
			spaceEntrySelection: {
				status: "ready",
				selectedAdditionalProfileIds: [],
			},
		});
	});

	it("migrates legacy empty bring-other-profiles selection to unresolved", () => {
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					spaceMemberChoice: "bring_other_profiles",
					selectedSpaceMemberProfileIds: [],
				})
			)
		).toMatchObject({
			spaceEntrySelection: {
				status: "unresolved",
				selectedAdditionalProfileIds: [],
			},
		});
	});

	it("migrates legacy selected profiles to a ready space entry selection", () => {
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					spaceMemberChoice: "bring_other_profiles",
					selectedSpaceMemberProfileIds: ["agent-123"],
				})
			)
		).toMatchObject({
			spaceEntrySelection: {
				status: "ready",
				selectedAdditionalProfileIds: ["agent-123"],
			},
		});
	});

	it("deduplicates selected additional profiles before storing them", () => {
		const nextState = reduceStartFlowState(createInitialStartFlowState(), {
			type: "set_space_entry_selection",
			spaceEntrySelection: {
				status: "ready",
				selectedAdditionalProfileIds: ["agent-123", " agent-123 ", ""],
			},
		});

		expect(nextState).toMatchObject({
			spaceEntrySelection: {
				status: "ready",
				selectedAdditionalProfileIds: ["agent-123"],
			},
		});
	});

	it("fails closed on invalid persisted state", () => {
		expect(parsePersistedStartFlowState("{bad-json")).toBeNull();
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "unknown",
				})
			)
		).toBeNull();
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "agent",
				})
			)
		).toBeNull();
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: null,
				})
			)
		).toBeNull();
	});

	it("fills new fields with defaults when restoring older persisted state", () => {
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					selectedHumanProfileId: "hum_123",
					spaceChoice: "join",
					joinMethod: "saved_space",
				})
			)
		).toEqual({
			entryActor: "human",
			selectedHumanProfileId: "hum_123",
			localAgentSetupChoice: null,
			spaceChoice: "join",
			joinMethod: "saved_space",
			targetSpaceId: null,
			targetSpaceName: null,
			targetSpaceSource: null,
			spaceEntrySelection: null,
		});
	});

	it("maps the deprecated bring-agents boolean to the explicit setup choice", () => {
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					selectedHumanProfileId: "hum_123",
					wantsBringAgents: true,
				})
			)
		).toMatchObject({
			localAgentSetupChoice: "setup_this_computer",
		});
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					selectedHumanProfileId: "hum_123",
					wantsBringAgents: false,
				})
			)
		).toMatchObject({
			localAgentSetupChoice: "skip_setup",
		});
	});

	it("ignores deprecated persisted computer and local-agent fields", () => {
		expect(
			parsePersistedStartFlowState(
				JSON.stringify({
					entryActor: "human",
					selectedHumanProfileId: "hum_123",
					localAgentSetupChoice: "setup_this_computer",
					spaceChoice: "join",
					joinMethod: "saved_space",
					chosenComputerId: "computer-123",
					selectedLocalAgentIds: ["codex"],
					targetSpaceId: "space-123",
				})
			)
		).toEqual({
			entryActor: "human",
			selectedHumanProfileId: "hum_123",
			localAgentSetupChoice: "setup_this_computer",
			spaceChoice: "join",
			joinMethod: "saved_space",
			targetSpaceId: "space-123",
			targetSpaceName: null,
			targetSpaceSource: null,
			spaceEntrySelection: null,
		});
	});
});
