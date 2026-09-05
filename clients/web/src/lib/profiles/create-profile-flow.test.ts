import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createNewProfile,
	setupNewAgentProfileLocalState,
} from "./create-profile-flow";

const createStartAgentProfileMock = vi.hoisted(() => vi.fn());
const ensureRuntimeBindingMock = vi.hoisted(() => vi.fn());
const updateDefaultProjectMock = vi.hoisted(() => vi.fn());
const updateWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/profiles/create-agent-profile", () => ({
	createStartAgentProfile: createStartAgentProfileMock,
}));

vi.mock("#/lib/profiles/agent-profile-runtime-binding", () => ({
	ensureWebAgentProfileRuntimeBinding: ensureRuntimeBindingMock,
	formatWebAgentProfileRuntimeBindingFailure: () => "Binding failed.",
	formatWebAgentProfileRuntimeBindingFailureActionLabel: () => "Reconnect",
	shouldOfferWebAgentProfileSetupRefresh: () => false,
}));

vi.mock("./update-default-project", () => ({
	updateAgentProfileDefaultProject: updateDefaultProjectMock,
}));

vi.mock("./update-profile-workspace", () => ({
	updateAgentProfileWorkspace: updateWorkspaceMock,
}));

describe("new Agent Profile local setup", () => {
	beforeEach(() => {
		createStartAgentProfileMock.mockReset().mockResolvedValue(profileFixture());
		ensureRuntimeBindingMock
			.mockReset()
			.mockResolvedValue({ status: "accepted" });
		updateWorkspaceMock.mockReset().mockResolvedValue(undefined);
		updateDefaultProjectMock
			.mockReset()
			.mockResolvedValue(profileFixture({ defaultProjectId: "project-1" }));
	});

	it("saves Project intent without copying its path into custom workspace preferences", async () => {
		const result = await createAndSetupAgent({
			boundAgentId: "codex",
			defaultProjectId: "project-1",
			deviceId: "device-1",
			organizationId: "organization-1",
			profileName: "Research Agent",
			projectFolderPath: "/repo",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});
		expect(createStartAgentProfileMock).toHaveBeenCalledWith({
			data: {
				creatorProfileId: "profile-human",
				organizationId: "organization-1",
				profileName: "Research Agent",
			},
		});

		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		expect(updateDefaultProjectMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			defaultProjectId: "project-1",
			organizationId: "organization-1",
			profileId: "profile-agent",
		});
		expect(result.defaultProjectId).toBe("project-1");
	});

	it("fails before profile creation when an Agent has no explicit Organization", async () => {
		await expect(
			createNewProfile({
				organizationId: null,
				profileKind: "agent",
				profileName: "Research Agent",
				selectedHumanProfileId: "profile-human",
			})
		).rejects.toThrow(
			"Choose an organization before creating an Agent Profile."
		);
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
	});

	it("preserves a selected folder name with trailing spaces", async () => {
		await createAndSetupAgent({
			boundAgentId: "codex",
			deviceId: "device-1",
			organizationId: "organization-1",
			profileName: "Research Agent",
			projectFolderPath: "/Users/felix/Design Work ",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			organizationId: "organization-1",
			profileId: "profile-agent",
			workspaceMode: "custom",
			workspacePath: "/Users/felix/Design Work ",
		});
	});

	it("binds a resumed Agent Profile to the selected Native Session ID", async () => {
		const sessionInventorySelection = {
			computerId: "computer-1",
			nativeSessionId: "native-codex-thread-1",
			organizationId: "organization-1",
			ownerUserId: "user-1",
			projectId: "project-1",
			provider: "codex" as const,
		};
		await createAndSetupAgent({
			agentControllerConversationId: "native-codex-thread-1",
			boundAgentId: "codex",
			deviceId: "device-1",
			organizationId: "organization-1",
			profileName: "Research Agent",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
			sessionInventorySelection,
		});

		expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentControllerConversationId: "native-codex-thread-1",
				agentControllerRef: "builtin:codex",
				sessionInventorySelection,
			})
		);
	});

	it("marks a rejected runtime Binding as not established", async () => {
		ensureRuntimeBindingMock.mockResolvedValue({
			reasonCodes: ["agent_profile_binding.runtime_offline"],
			status: "rejected",
		});

		await expect(
			createAndSetupAgent({
				agentControllerConversationId: "native-codex-thread-1",
				boundAgentId: "codex",
				deviceId: "device-1",
				organizationId: "organization-1",
				profileName: "Research Agent",
				runtimeLane: "dev-local",
				selectedHumanProfileId: "profile-human",
			})
		).rejects.toMatchObject({
			bindingEstablished: false,
			message: "Binding failed.",
			reasonCodes: ["agent_profile_binding.runtime_offline"],
		});
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
	});

	it("marks a workspace failure after an accepted runtime Binding", async () => {
		updateWorkspaceMock.mockRejectedValue(
			new Error("Computer workspace is unavailable.")
		);

		await expect(
			createAndSetupAgent({
				agentControllerConversationId: "native-codex-thread-1",
				boundAgentId: "codex",
				deviceId: "device-1",
				organizationId: "organization-1",
				profileName: "Research Agent",
				runtimeLane: "dev-local",
				selectedHumanProfileId: "profile-human",
			})
		).rejects.toMatchObject({
			bindingEstablished: true,
			message: "Computer workspace is unavailable.",
		});
	});

	it("preserves the existing managed-workspace behavior when no Project is selected", async () => {
		await createAndSetupAgent({
			boundAgentId: "codex",
			deviceId: "device-1",
			organizationId: "organization-1",
			profileName: "Research Agent",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			organizationId: "organization-1",
			profileId: "profile-agent",
			workspaceMode: "openmeld_managed",
		});
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
	});

	it("prepares a managed workspace for an unbound Agent created on the current computer", async () => {
		await createAndSetupAgent({
			boundAgentId: "",
			currentServiceCanSetProfileWorkspace: true,
			deviceId: "device-1",
			organizationId: "organization-1",
			profileName: "Future Grok Agent",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			organizationId: "organization-1",
			profileId: "profile-agent",
			workspaceMode: "openmeld_managed",
		});
	});

	it("keeps an unbound Agent independent from a historical computer without current workspace control", async () => {
		await createAndSetupAgent({
			boundAgentId: "",
			deviceId: "historical-device",
			organizationId: "organization-1",
			profileName: "Manual Teammate",
			runtimeLane: "prod",
			selectedHumanProfileId: "profile-human",
		});

		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
	});
});

async function createAndSetupAgent(
	input: Omit<
		Parameters<typeof setupNewAgentProfileLocalState>[0],
		"profile"
	> & { profileName: string }
) {
	const { profileName, ...localSetup } = input;
	const profile = await createNewProfile({
		organizationId: input.organizationId,
		profileKind: "agent",
		profileName,
		selectedHumanProfileId: input.selectedHumanProfileId,
	});
	return await setupNewAgentProfileLocalState({
		...localSetup,
		profile,
	});
}

function profileFixture(overrides: { defaultProjectId?: string | null } = {}) {
	return {
		bindingState: "bound" as const,
		createdAt: "2026-07-14T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: "profile-human",
		defaultProjectId: overrides.defaultProjectId ?? null,
		isDefault: false,
		lastUsedAt: null,
		ownerUserId: "user-1",
		profileHandle: "research-agent",
		profileKind: "agent" as const,
		profileName: "Research Agent",
		source: "manual" as const,
		status: "active" as const,
		updatedAt: "2026-07-14T00:00:00.000Z",
		openMeldProfileId: "profile-agent",
	};
}
