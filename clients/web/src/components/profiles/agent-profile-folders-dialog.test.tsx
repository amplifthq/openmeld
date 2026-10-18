import type {
	AuthProfileView,
	GetAgentProfileFoldersResponse,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AgentProfileFoldersDialog } from "./agent-profile-folders-dialog";
import { buildAgentProfileFolderRows } from "./agent-profile-folders-model";

const readFoldersMock = vi.hoisted(() => vi.fn());
const manageFoldersMock = vi.hoisted(() => vi.fn());
const updateDefaultProjectMock = vi.hoisted(() => vi.fn());
const readWorkspaceMock = vi.hoisted(() => vi.fn());
const listProjectsMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/profiles/agent-profile-folders", () => ({
	manageAgentProfileFolders: manageFoldersMock,
	readAgentProfileFolders: readFoldersMock,
}));
vi.mock("#/lib/profiles/update-default-project", () => ({
	updateAgentProfileDefaultProject: updateDefaultProjectMock,
}));
vi.mock("#/lib/profiles/update-profile-workspace", () => ({
	readAgentProfileWorkspace: readWorkspaceMock,
}));
vi.mock("#/lib/organizations/projects", async () => ({
	...(await vi.importActual<typeof import("#/lib/organizations/projects")>(
		"#/lib/organizations/projects"
	)),
	listCurrentProjects: listProjectsMock,
}));
// The source chooser is covered by its own tests; here it only picks a source.
vi.mock("./agent-profile-project-selector", () => ({
	AgentProfileProjectSelector: (input: {
		onUseManagedWorkspace?: () => void;
	}) => (
		<button onClick={() => input.onUseManagedWorkspace?.()} type="button">
			Use the OpenMeld folder
		</button>
	),
}));

const MAKE_ANOTHER_DEFAULT = /Make another folder/;
const DEFAULT_FOLDER_REASON = /default folder/;
const CUSTOM_ID = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";
const OTHER_ID = "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21";
const PROJECT_ID = "0397cc3e-6689-4a06-a6c3-1ca0e265606b";
const BINDING_TARGET = {
	agentControllerConversationId: null,
	agentControllerRef: "builtin:codex",
	bindingId: "binding-1",
	openMeldServiceRuntimeId: "runtime-1",
};
const TARGET = { deviceId: "device-1", runtimeLane: "prod" as const };
const PROJECTION = {
	defaultFolderId: CUSTOM_ID,
	folders: [
		{
			displayName: "openmeld",
			folderId: CUSTOM_ID,
			isDefault: true,
			kind: "custom" as const,
		},
		{
			displayName: "website",
			folderId: OTHER_ID,
			isDefault: false,
			kind: "custom" as const,
		},
		{
			displayName: "Payments",
			folderId: PROJECT_ID,
			isDefault: false,
			kind: "project" as const,
			projectId: "project-payments",
		},
	],
	revision: 4,
};

function current(
	projection: typeof PROJECTION
): GetAgentProfileFoldersResponse {
	return {
		agentProfileId: "profile-agent",
		observedAtMs: 1,
		projection,
		status: "current",
		target: TARGET,
	};
}

function profileFixture(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		createdAt: "2026-07-14T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: "human-1",
		defaultProjectId: null,
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

function renderDialog(overrides: Partial<AuthProfileView> = {}) {
	const onProfileUpdated = vi.fn();
	render(
		<TestQueryClientProvider>
			<AgentProfileFoldersDialog
				actorProfileId={null}
				agentControllerRef="builtin:codex"
				executionTargetChangeEligibilityStatus="allowed"
				expectedBindingTarget={BINDING_TARGET}
				onOpenChange={vi.fn()}
				onProfileUpdated={onProfileUpdated}
				open
				organizationId="org-1"
				profile={profileFixture(overrides)}
				storageScope="account-1"
				target={TARGET}
			/>
		</TestQueryClientProvider>
	);
	return { onProfileUpdated };
}

async function findRow(name: string) {
	const list = await screen.findByRole("list", { name: "Folders" });
	const row = within(list)
		.getAllByRole("listitem")
		.find((item) => within(item).queryByText(name));
	if (!row) {
		throw new Error(`Row ${name} missing`);
	}
	return within(row);
}

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	readFoldersMock.mockResolvedValue(current(PROJECTION));
	readWorkspaceMock.mockResolvedValue({
		agentProfileId: "profile-agent",
		target: TARGET,
		workspace: {
			configurationVersion: 2,
			status: "configured",
			updatedAt: "2026-10-18T00:00:00.000Z",
			workspaceMode: "custom",
			workspacePath: "/Users/felix/work/openmeld",
		},
	});
	listProjectsMock.mockResolvedValue({ projects: [] });
	manageFoldersMock.mockImplementation(({ operation }) =>
		Promise.resolve({
			agentProfileId: "profile-agent",
			...(operation.folderId ? { folderId: operation.folderId } : {}),
			observedAtMs: 2,
			projection: PROJECTION,
			target: TARGET,
		})
	);
	updateDefaultProjectMock.mockResolvedValue(profileFixture());
});

describe("Agent folder rows", () => {
	it("marks the Default Project's folder as the default and protects it", () => {
		const rows = buildAgentProfileFolderRows({
			defaultProjectId: "project-payments",
			projection: PROJECTION,
		});
		expect(rows.map((row) => [row.displayName, row.effectiveDefault])).toEqual([
			["openmeld", false],
			["website", false],
			["Payments", true],
		]);
		expect(rows[2]?.removeBlockedReason).toMatch(MAKE_ANOTHER_DEFAULT);
		// The saved default folder is still protected from removal.
		expect(rows[0]?.removeBlockedReason).toMatch(DEFAULT_FOLDER_REASON);
	});
});

describe("Agent folders dialog", () => {
	it("lists every folder by name and shows only the default's path to its owner", async () => {
		renderDialog();
		const row = await findRow("openmeld");
		expect(row.getByText("Default")).toBeTruthy();
		expect(await row.findByText("/Users/felix/work/openmeld")).toBeTruthy();
		expect((await findRow("website")).queryByText("Default")).toBeNull();
		expect(
			(await findRow("openmeld"))
				.getByRole("button", { name: "Remove" })
				.hasAttribute("disabled")
		).toBe(true);
	});

	it("makes another folder the default and then clears the Default Project", async () => {
		const { onProfileUpdated } = renderDialog({
			defaultProjectId: "project-old",
		});
		const row = await findRow("website");
		fireEvent.click(row.getByRole("button", { name: "Make default" }));
		await waitFor(() => expect(updateDefaultProjectMock).toHaveBeenCalled());
		expect(manageFoldersMock).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBindingTarget: BINDING_TARGET,
				operation: { folderId: OTHER_ID, operation: "set_default" },
			})
		);
		expect(manageFoldersMock.mock.invocationCallOrder[0]).toBeLessThan(
			updateDefaultProjectMock.mock.invocationCallOrder[0] ?? 0
		);
		expect(updateDefaultProjectMock).toHaveBeenCalledWith(
			expect.objectContaining({ defaultProjectId: null })
		);
		expect(onProfileUpdated).toHaveBeenCalled();
	});

	it("makes a Project folder the default through Default Project", async () => {
		renderDialog();
		const row = await findRow("Payments");
		fireEvent.click(row.getByRole("button", { name: "Make default" }));
		await waitFor(() =>
			expect(updateDefaultProjectMock).toHaveBeenCalledWith(
				expect.objectContaining({ defaultProjectId: "project-payments" })
			)
		);
		expect(manageFoldersMock).not.toHaveBeenCalled();
	});

	it("renames and removes a folder that is not the default", async () => {
		renderDialog();
		let row = await findRow("website");
		fireEvent.click(row.getByRole("button", { name: "Rename" }));
		fireEvent.change(row.getByRole("textbox", { name: "Name for website" }), {
			target: { value: "Marketing site" },
		});
		fireEvent.click(row.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(manageFoldersMock).toHaveBeenCalledWith(
				expect.objectContaining({
					operation: {
						displayName: "Marketing site",
						folderId: OTHER_ID,
						operation: "rename",
					},
				})
			)
		);
		row = await findRow("website");
		fireEvent.click(row.getByRole("button", { name: "Remove" }));
		fireEvent.click(row.getByRole("button", { name: "Remove" }));
		await waitFor(() =>
			expect(manageFoldersMock).toHaveBeenCalledWith(
				expect.objectContaining({
					operation: { folderId: OTHER_ID, operation: "remove" },
				})
			)
		);
	});

	it("adds a folder from the folder source chooser", async () => {
		renderDialog();
		await findRow("openmeld");
		fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Use the OpenMeld folder" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
		await waitFor(() =>
			expect(manageFoldersMock).toHaveBeenCalledWith(
				expect.objectContaining({
					operation: { operation: "add_openmeld_managed" },
				})
			)
		);
	});

	it("keeps a recorded list read-only while the computer is offline", async () => {
		readFoldersMock.mockResolvedValue({
			...current(PROJECTION),
			reasonCode: "local_agent_control.service_offline",
			status: "recorded",
		});
		renderDialog();
		const row = await findRow("website");
		expect(
			row.getByRole("button", { name: "Make default" }).hasAttribute("disabled")
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Add folder" })
				.hasAttribute("disabled")
		).toBe(true);
	});
});
