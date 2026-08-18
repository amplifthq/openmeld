import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectQueryKeys } from "#/query/organizations/projects";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import {
	AgentProfileProjectSettingsDialog,
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings-dialog";

const updateDefaultProjectMock = vi.hoisted(() => vi.fn());
const updateWorkspaceMock = vi.hoisted(() => vi.fn());

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
		updateDefaultProjectMock
			.mockReset()
			.mockResolvedValue(profileFixture({ defaultProjectId: null }));
		updateWorkspaceMock.mockReset().mockResolvedValue(undefined);
	});

	it("shows the Default Project, future-Wake notice, and maintenance actions", () => {
		renderSettings();

		expect(screen.getByText("OpenMeld")).toBeTruthy();
		expect(screen.getByText("/repo")).toBeTruthy();
		expect(screen.getByText(FUTURE_WAKES_PROJECT_SETTINGS_NOTICE)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Change Default Project" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Change local folder" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Choose custom working folder" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Let OpenMeld choose",
			})
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Clear Default Project" })
		).toBeTruthy();
	});

	it("saves a custom working-folder draft only after explicit confirmation", async () => {
		const { onProfileUpdated } = renderSettings();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose custom working folder" })
		);
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
	});

	it("switches to the managed workspace before clearing the Default Project", async () => {
		const { onProfileUpdated } = renderSettings();

		screen
			.getByRole("button", {
				name: "Let OpenMeld choose",
			})
			.click();

		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
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

function renderSettings() {
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
				onOpenChange={vi.fn()}
				onProfileUpdated={onProfileUpdated}
				open={true}
				organizationId="organization-1"
				profile={profileFixture()}
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
