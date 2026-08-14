import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNewStartProfile } from "./create-profile-flow";

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

describe("createNewStartProfile Default Project setup", () => {
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

	it("saves the connected folder before the cloud Default Project preference", async () => {
		const result = await createNewStartProfile({
			boundAgentId: "codex",
			defaultProjectId: "project-1",
			deviceId: "device-1",
			organizationId: "organization-1",
			profileKind: "agent",
			profileName: "Research Agent",
			projectFolderPath: "/repo",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			profileId: "profile-agent",
			workspaceMode: "custom",
			workspacePath: "/repo",
		});
		expect(updateDefaultProjectMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			defaultProjectId: "project-1",
			organizationId: "organization-1",
			profileId: "profile-agent",
		});
		expect(updateWorkspaceMock.mock.invocationCallOrder[0]).toBeLessThan(
			updateDefaultProjectMock.mock.invocationCallOrder[0] ?? 0
		);
		expect(result.defaultProjectId).toBe("project-1");
	});

	it("preserves a selected folder name with trailing spaces", async () => {
		await createNewStartProfile({
			boundAgentId: "codex",
			deviceId: "device-1",
			profileKind: "agent",
			profileName: "Research Agent",
			projectFolderPath: "/Users/felix/Design Work ",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			profileId: "profile-agent",
			workspaceMode: "custom",
			workspacePath: "/Users/felix/Design Work ",
		});
	});

	it("preserves the existing managed-workspace behavior when no Project is selected", async () => {
		await createNewStartProfile({
			boundAgentId: "codex",
			deviceId: "device-1",
			profileKind: "agent",
			profileName: "Research Agent",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			profileId: "profile-agent",
			workspaceMode: "openmeld_managed",
		});
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
	});

	it("prepares a managed workspace for an unbound Agent created on the current computer", async () => {
		await createNewStartProfile({
			boundAgentId: "",
			deviceId: "device-1",
			profileKind: "agent",
			profileName: "Future Grok Agent",
			runtimeLane: "dev-local",
			selectedHumanProfileId: "profile-human",
		});

		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(updateWorkspaceMock).toHaveBeenCalledWith({
			actorProfileId: "profile-human",
			profileId: "profile-agent",
			workspaceMode: "openmeld_managed",
		});
	});

	it("keeps offline unbound Agent creation independent from local workspace setup", async () => {
		await createNewStartProfile({
			boundAgentId: "",
			deviceId: null,
			profileKind: "agent",
			profileName: "Manual Teammate",
			runtimeLane: null,
			selectedHumanProfileId: "profile-human",
		});

		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
	});
});

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
