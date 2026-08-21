import type { AuthProfileView } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewProfileLocalSetupError } from "./create-profile-flow";

const orchestrationMocks = vi.hoisted(() => ({
	createProfile: vi.fn(),
	deleteProfile: vi.fn(),
	joinSpace: vi.fn(),
	setupLocalState: vi.fn(),
}));

vi.mock("./create-profile-flow", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./create-profile-flow")>();
	return {
		...actual,
		createNewProfile: orchestrationMocks.createProfile,
		setupNewAgentProfileLocalState: orchestrationMocks.setupLocalState,
	};
});

vi.mock("#/lib/profiles/delete-agent-profile", () => ({
	deleteStartAgentProfile: orchestrationMocks.deleteProfile,
}));

vi.mock("./join-profile-to-space", () => ({
	joinProfileToSpace: orchestrationMocks.joinSpace,
}));

import {
	createProfileWithFollowUps,
	SessionProfileCreationRolledBackError,
} from "./create-profile-orchestration";

describe("Session-based Agent Profile creation", () => {
	beforeEach(() => {
		orchestrationMocks.createProfile
			.mockReset()
			.mockResolvedValue(agentProfile);
		orchestrationMocks.deleteProfile
			.mockReset()
			.mockResolvedValue(agentProfile);
		orchestrationMocks.joinSpace.mockReset().mockResolvedValue(undefined);
		orchestrationMocks.setupLocalState
			.mockReset()
			.mockResolvedValue(agentProfile);
	});

	it("removes the new Agent when Core rejects stale Resume eligibility", async () => {
		const resumeUnavailable = new NewProfileLocalSetupError({
			message:
				"This Session changed or is no longer available to resume. Refresh Agent Activity and choose it again.",
			reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
			setupRefreshActionLabel: "Connect local agent",
			setupRefreshAvailable: false,
		});
		orchestrationMocks.setupLocalState.mockRejectedValue(resumeUnavailable);

		await expect(
			createProfileWithFollowUps(resumeCreationInput())
		).rejects.toMatchObject({
			cause: resumeUnavailable,
			message: resumeUnavailable.message,
			name: SessionProfileCreationRolledBackError.name,
		});

		expect(orchestrationMocks.deleteProfile).toHaveBeenCalledWith({
			data: agentProfile.openMeldProfileId,
		});
		expect(orchestrationMocks.joinSpace).not.toHaveBeenCalled();
	});

	it("reports cleanup failure without claiming that creation rolled back", async () => {
		const resumeUnavailable = new NewProfileLocalSetupError({
			message: "This Session is no longer available to resume.",
			reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
			setupRefreshActionLabel: "Connect local agent",
			setupRefreshAvailable: false,
		});
		orchestrationMocks.setupLocalState.mockRejectedValue(resumeUnavailable);
		orchestrationMocks.deleteProfile.mockRejectedValue(
			new Error("Auth cleanup unavailable.")
		);

		await expect(
			createProfileWithFollowUps(resumeCreationInput())
		).rejects.toMatchObject({
			message: expect.stringContaining(
				"couldn't remove the incomplete Agent Profile"
			),
			name: "Error",
		});
		expect(orchestrationMocks.joinSpace).not.toHaveBeenCalled();
	});

	it("removes the new Agent when Resume setup fails before Binding", async () => {
		const computerOffline = new NewProfileLocalSetupError({
			message: "OpenMeld Service is offline.",
			setupRefreshActionLabel: "Reconnect computer",
			setupRefreshAvailable: true,
		});
		orchestrationMocks.setupLocalState.mockRejectedValue(computerOffline);

		await expect(
			createProfileWithFollowUps(resumeCreationInput())
		).rejects.toMatchObject({
			cause: computerOffline,
			message: computerOffline.message,
			name: SessionProfileCreationRolledBackError.name,
		});

		expect(orchestrationMocks.deleteProfile).toHaveBeenCalledWith({
			data: agentProfile.openMeldProfileId,
		});
		expect(orchestrationMocks.joinSpace).not.toHaveBeenCalled();
	});

	it("keeps post-Binding local setup failures as visible follow-up issues", async () => {
		orchestrationMocks.setupLocalState.mockRejectedValue(
			new NewProfileLocalSetupError({
				bindingEstablished: true,
				message: "OpenMeld couldn't prepare the working folder.",
				setupRefreshActionLabel: "Reconnect computer",
				setupRefreshAvailable: false,
			})
		);

		await expect(
			createProfileWithFollowUps(resumeCreationInput())
		).resolves.toMatchObject({
			followUpIssues: [
				{
					kind: "local_setup",
					message: "OpenMeld couldn't prepare the working folder.",
				},
			],
			profile: agentProfile,
		});
		expect(orchestrationMocks.deleteProfile).not.toHaveBeenCalled();
	});
});

const agentProfile = {
	openMeldProfileId: "agent-profile-1",
	profileKind: "agent",
	profileName: "Session Agent",
} as AuthProfileView;

function resumeCreationInput(): Parameters<
	typeof createProfileWithFollowUps
>[0] {
	return {
		agentControllerConversationId: "native-session-1",
		boundAgentId: "codex",
		currentServiceCanSetProfileWorkspace: true,
		defaultProjectId: "project-1",
		deviceId: "device-1",
		idempotencyKey: "creation-1",
		modelId: null,
		openCodePermission: null,
		organizationId: "organization-1",
		profileKind: "agent",
		profileName: "Session Agent",
		projectFolderPath: null,
		queryClient: {} as Parameters<
			typeof createProfileWithFollowUps
		>[0]["queryClient"],
		reasoningLevel: null,
		runtimeLane: "dev-local",
		selectedHumanProfile: null,
		selectedHumanProfileId: "human-profile-1",
		sessionInventorySelection: {
			computerId: "computer-1",
			nativeSessionId: "native-session-1",
			organizationId: "organization-1",
			ownerUserId: "owner-1",
			projectId: "project-1",
			provider: "codex",
		},
		spaceContext: undefined,
	};
}
