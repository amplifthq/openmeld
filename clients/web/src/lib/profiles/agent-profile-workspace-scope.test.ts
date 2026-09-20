import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	disableAgentProfilePrimaryBinding,
	readAgentProfilePrimaryBinding,
	updateAgentProfilePrimaryBindingAgentControllerPermissionMode,
} from "./agent-profile-primary-binding";
import { updateAgentProfileWorkspace } from "./update-profile-workspace";

const disablePrimaryBindingMock = vi.hoisted(() => vi.fn());
const getPrimaryBindingMock = vi.hoisted(() => vi.fn());
const setCurrentAgentProfileWorkspaceMock = vi.hoisted(() => vi.fn());
const updatePermissionModeMock = vi.hoisted(() => vi.fn());
const createOrganizationScopedFoundationMock = vi.hoisted(() => vi.fn());
const desktopMock = vi.hoisted(() => vi.fn());
vi.mock("#/desktop/platform", () => ({ getDesktopPlatform: desktopMock }));

vi.mock("@openmeld/api-client", async () => {
	const actual = await vi.importActual<typeof import("@openmeld/api-client")>(
		"@openmeld/api-client"
	);
	return {
		...actual,
		createAgentProfileBindingApi: () => ({
			disablePrimaryBinding: disablePrimaryBindingMock,
			getPrimaryBinding: getPrimaryBindingMock,
			updatePrimaryBindingAgentControllerPermissionMode:
				updatePermissionModeMock,
		}),
		createCurrentDeviceApi: () => ({
			setCurrentAgentProfileWorkspace: setCurrentAgentProfileWorkspaceMock,
		}),
	};
});

vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation:
		createOrganizationScopedFoundationMock,
}));

describe("Agent Profile Workspace-scoped Web clients", () => {
	beforeEach(() => {
		desktopMock.mockReset().mockReturnValue(null);
		createOrganizationScopedFoundationMock
			.mockReset()
			.mockReturnValue({ requestJson: vi.fn() });
		getPrimaryBindingMock.mockReset().mockResolvedValue({
			binding: null,
			grantsClaimSuccess: false,
			status: "missing",
		});
		updatePermissionModeMock.mockReset().mockResolvedValue({
			binding: null,
			grantsClaimSuccess: false,
			reasonCodes: [],
			routable: false,
			status: "rejected",
		});
		disablePrimaryBindingMock.mockReset().mockResolvedValue({
			agentProfileId: "agt-profile",
			disabled: true,
			reasonCodes: [],
			status: "disabled",
		});
		setCurrentAgentProfileWorkspaceMock.mockReset().mockResolvedValue({
			agentProfileId: "agt-profile",
			status: "updated",
			workspaceMode: "openmeld_managed",
			workspacePath: "/managed/profile",
		});
	});

	it("sends the route Workspace for Binding reads and mutations", async () => {
		await readAgentProfilePrimaryBinding({
			agentProfileId: "agt-profile",
			organizationId: "org-route",
		});
		await updateAgentProfilePrimaryBindingAgentControllerPermissionMode({
			actorProfileId: "human-route",
			agentControllerPermissionMode: "codex:fullAccess",
			agentProfileId: "agt-profile",
			organizationId: "org-route",
		});
		await disableAgentProfilePrimaryBinding({
			actorProfileId: "human-route",
			agentProfileId: "agt-profile",
			organizationId: "org-route",
		});

		expect(createOrganizationScopedFoundationMock).toHaveBeenNthCalledWith(1, {
			organizationId: "org-route",
		});
		expect(createOrganizationScopedFoundationMock).toHaveBeenNthCalledWith(2, {
			openMeldProfileId: "human-route",
			organizationId: "org-route",
		});
		expect(createOrganizationScopedFoundationMock).toHaveBeenNthCalledWith(3, {
			openMeldProfileId: "human-route",
			organizationId: "org-route",
		});
	});

	it("sends the route Workspace for local working-folder mutations", async () => {
		await updateAgentProfileWorkspace({
			actorProfileId: "human-route",
			organizationId: "org-route",
			profileId: "agt-profile",
			workspaceMode: "openmeld_managed",
		});

		expect(createOrganizationScopedFoundationMock).toHaveBeenCalledWith({
			openMeldProfileId: "human-route",
			organizationId: "org-route",
		});
		expect(setCurrentAgentProfileWorkspaceMock).toHaveBeenCalledWith({
			agentProfileId: "agt-profile",
			workspaceMode: "openmeld_managed",
		});
	});

	it("keeps Desktop workspace writes on the chosen native computer and preserves the full path", async () => {
		const target = { deviceId: "mac-a", runtimeLane: "canary" as const };
		desktopMock.mockReturnValue({
			localComputer: async () => ({
				status: "available",
				accountId: "account-a",
				target,
			}),
		});
		const input = {
			organizationId: "org-route",
			profileId: "agt-profile",
			workspaceMode: "custom" as const,
			workspacePath: "/work/Design 中文 ",
			target,
		};
		await updateAgentProfileWorkspace(input);
		expect(setCurrentAgentProfileWorkspaceMock).toHaveBeenCalledExactlyOnceWith(
			{
				agentProfileId: input.profileId,
				workspaceMode: "custom",
				workspacePath: input.workspacePath,
				target,
			}
		);
		setCurrentAgentProfileWorkspaceMock.mockClear();
		for (const wrongTarget of [
			{ ...target, deviceId: "mac-b" },
			{ ...target, runtimeLane: "prod" as const },
		]) {
			await expect(
				updateAgentProfileWorkspace({ ...input, target: wrongTarget })
			).rejects.toThrow();
		}
		expect(setCurrentAgentProfileWorkspaceMock).not.toHaveBeenCalled();
	});
});
