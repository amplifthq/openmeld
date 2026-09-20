import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readPendingAgentProfileCreationLocalSetup,
	rememberPendingAgentProfileCreationLocalSetup,
} from "#/lib/profiles/agent-profile-creation-local-setup";
import { projectQueryKeys } from "#/query/organizations/projects";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { shouldShowAgentProfileProjectSettings } from "./agent-profile-project-settings";
import { AgentProfileProjectSettingsDialog } from "./agent-profile-project-settings-dialog";

const updateDefaultProjectMock = vi.hoisted(() => vi.fn());
const updateWorkspaceMock = vi.hoisted(() => vi.fn());
const ACTIVE_WAKE_FOLDER_CHANGE_MESSAGE =
	/changing folders would interrupt the current Wake/i;

afterEach(cleanup);

vi.mock("#/lib/profiles/update-default-project", () => ({
	updateAgentProfileDefaultProject: updateDefaultProjectMock,
}));

vi.mock("#/lib/profiles/update-profile-workspace", () => ({
	updateAgentProfileWorkspace: updateWorkspaceMock,
}));

vi.mock("#/components/projects/use-project-discovery", () => ({
	useProjectDiscovery: () => ({
		applyConnectionSnapshot: vi.fn(),
		claimMutationGeneration: vi.fn(() => 1),
		computer: {
			deviceId: "device-current",
			localFolderPicker: { selectFolders: true },
		},
		projectView: () => ({
			connections: [
				{
					bindingGeneration: "binding-1",
					isDefault: true,
					path: "/repo",
					status: "available",
				},
			],
			discovery: null,
			status: "ready",
		}),
		refresh: vi.fn(),
	}),
}));

describe("AgentProfileProjectSettingsDialog", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		updateDefaultProjectMock
			.mockReset()
			.mockResolvedValue(profileFixture({ defaultProjectId: null }));
		updateWorkspaceMock.mockReset().mockResolvedValue(undefined);
	});

	it("keeps managed and project sources separate", () => {
		renderSettings();
		expect(
			screen.getByRole("combobox", { name: "Folder source" })
		).toBeTruthy();
		selectSource("Let OpenMeld choose");
		expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
		expect(screen.queryByText("/repo")).toBeNull();
		expect(
			screen.getByText("OpenMeld will manage a working folder for this agent.")
		).toBeTruthy();
	});

	it("applies the displayed managed choice only when explicitly saved, even without a draft change", async () => {
		renderSettings("allowed", { defaultProjectId: null }, "OpenMeld managed");
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		const save = screen.getByRole("button", { name: "Save changes" });
		expect((save as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(save);
		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledExactlyOnceWith({
				actorProfileId: "human-1",
				organizationId: "organization-1",
				profileId: "profile-agent",
				workspaceMode: "openmeld_managed",
			});
		});
	});

	it("selects a connected project without another folder click and saves only project intent", async () => {
		renderSettings("allowed", { defaultProjectId: null });
		selectSource("From a project");
		fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
		fireEvent.focus(screen.getByRole("option", { name: "OpenMeld" }));
		fireEvent.click(screen.getByRole("option", { name: "OpenMeld" }));
		await vi.waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Save changes",
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await vi.waitFor(() =>
			expect(updateDefaultProjectMock).toHaveBeenCalledWith(
				expect.objectContaining({ defaultProjectId: "project-1" })
			)
		);
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
	});

	it("saves a custom working-folder draft only after explicit confirmation", async () => {
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: "profile-agent",
			organizationId: "organization-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Old Workspace",
		});
		window.sessionStorage.clear();
		const { onProfileUpdated } = renderSettings();
		selectSource("On this computer");
		fireEvent.click(
			screen.getByRole("button", { name: "Enter path manually" })
		);
		fireEvent.change(screen.getByLabelText("Custom working folder path"), {
			target: { value: "/Users/felix/Private Workspace " },
		});

		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				organizationId: "organization-1",
				profileId: "profile-agent",
				workspaceMode: "custom",
				workspacePath: "/Users/felix/Private Workspace ",
			});
			expect(updateDefaultProjectMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				defaultProjectId: null,
				organizationId: "organization-1",
				profileId: "profile-agent",
			});
		});
		expect(onProfileUpdated).toHaveBeenCalled();
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "organization-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toBeNull();
	});

	it("switches to the managed workspace before clearing the Default Project", async () => {
		const { onProfileUpdated } = renderSettings();

		selectSource("Let OpenMeld choose");
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				organizationId: "organization-1",
				profileId: "profile-agent",
				workspaceMode: "openmeld_managed",
			});
			expect(updateDefaultProjectMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				defaultProjectId: null,
				organizationId: "organization-1",
				profileId: "profile-agent",
			});
		});
		expect(updateWorkspaceMock.mock.invocationCallOrder[0]).toBeLessThan(
			updateDefaultProjectMock.mock.invocationCallOrder[0] ?? 0
		);
		expect(onProfileUpdated).toHaveBeenCalledWith(
			expect.objectContaining({ defaultProjectId: null })
		);
	});

	it("keeps working-folder changes disabled while the Agent is working", () => {
		renderSettings("blocked");

		expect(screen.getByText(ACTIVE_WAKE_FOLDER_CHANGE_MESSAGE)).toBeTruthy();
		expect(
			(
				screen.getByRole("combobox", {
					name: "Folder source",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);

		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
	});

	it("does not expose local Project settings for managed or hosted profiles", () => {
		expect(
			shouldShowAgentProfileProjectSettings({
				agentControllerRef: "builtin:codex",
				managedRole: "center_agent",
			})
		).toBe(false);
		expect(
			shouldShowAgentProfileProjectSettings({
				agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
				managedRole: null,
			})
		).toBe(false);

		const { container } = render(
			<AgentProfileProjectSettingsDialog
				actorProfileId="human-1"
				agentControllerRef="builtin:codex"
				currentWorkingFolder="/repo"
				executionTargetChangeEligibilityStatus="allowed"
				onOpenChange={vi.fn()}
				onProfileUpdated={vi.fn()}
				open={true}
				organizationId="organization-1"
				profile={profileFixture({ managedRole: "center_agent" })}
			/>
		);
		expect(container.childElementCount).toBe(0);
	});
});

function renderSettings(
	executionTargetChangeEligibilityStatus:
		| "allowed"
		| "blocked"
		| "unavailable" = "allowed",
	overrides: Partial<AuthProfileView> = {},
	currentWorkingFolder: string | null = "/repo"
) {
	const queryClient = createTestQueryClient();
	const onProfileUpdated = vi.fn();
	queryClient.setQueryData(projectQueryKeys.organization("organization-1"), {
		organizationId: "organization-1",
		projects: [
			{
				archivedAtMs: null,
				canArchive: true,
				canManage: true,
				createdAtMs: 1,
				createdByUserId: "user-1",
				id: "project-1",
				name: "OpenMeld",
				organizationId: "organization-1",
				repositoryFingerprint: null,
				slug: "openmeld",
				updatedAtMs: 1,
			},
		],
	});
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AgentProfileProjectSettingsDialog
				actorProfileId="human-1"
				agentControllerRef="builtin:codex"
				currentWorkingFolder={currentWorkingFolder}
				executionTargetChangeEligibilityStatus={
					executionTargetChangeEligibilityStatus
				}
				onOpenChange={vi.fn()}
				onProfileUpdated={onProfileUpdated}
				open={true}
				organizationId="organization-1"
				profile={profileFixture(overrides)}
			/>
		</TestQueryClientProvider>
	);
	return { onProfileUpdated };
}

function profileFixture(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		createdAt: "2026-07-14T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: "human-1",
		defaultProjectId: "project-1",
		isDefault: false,
		lastUsedAt: null,
		managedRole: null,
		ownerUserId: "user-1",
		profileHandle: "research-agent",
		profileKind: "agent",
		profileName: "Research Agent",
		source: "manual",
		status: "active",
		updatedAt: "2026-07-14T00:00:00.000Z",
		openMeldProfileId: "profile-agent",
		...overrides,
	};
}

function selectSource(name: string) {
	fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
	fireEvent.focus(screen.getByRole("option", { name }));
	fireEvent.click(screen.getByRole("option", { name }));
}
