import {
	CREDENTIAL_CONFIRMATION_REQUIRED_CODE,
	formatCredentialConfirmationRequiredMessage,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	GetAgentProfileFoldersResponse,
	ProfileFolderProjection,
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
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import {
	AgentProfileFoldersDialog,
	type WorkingFolderRecovery,
} from "./agent-profile-folders-dialog";
import { buildAgentProfileFolderRows } from "./agent-profile-folders-model";

const readFoldersMock = vi.hoisted(() => vi.fn());
const manageFoldersMock = vi.hoisted(() => vi.fn());
const updateDefaultProjectMock = vi.hoisted(() => vi.fn());
const readWorkspaceMock = vi.hoisted(() => vi.fn());
const listProjectsMock = vi.hoisted(() => vi.fn());
const clearCreationSetupMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/profiles/agent-profile-folders", () => ({
	manageAgentProfileFolders: manageFoldersMock,
	readAgentProfileFolders: readFoldersMock,
}));
vi.mock("#/lib/profiles/agent-profile-creation-local-setup", () => ({
	clearPendingAgentProfileCreationLocalSetupForProfile: clearCreationSetupMock,
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
const NO_FOLDERS_YET = /No folders yet/;
const COMPUTER_CHANGED_MESSAGE = /Computer or local agent changed/;
const DEFAULT_FOLDER_REASON = /default folder/;
const SETTINGS_UNREADABLE =
	/saved folder settings on its computer can’t be read/;
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
	projection: ProfileFolderProjection
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

function renderDialog(
	overrides: Partial<AuthProfileView> = {},
	bindingTarget = BINDING_TARGET,
	recovery?: WorkingFolderRecovery
) {
	const onProfileUpdated = vi.fn();
	const onOpenChange = vi.fn();
	const view = (target: typeof BINDING_TARGET, open = true) => (
		<TestQueryClientProvider queryClient={queryClient}>
			<AgentProfileFoldersDialog
				actorProfileId={null}
				agentControllerRef="builtin:codex"
				executionTargetChangeEligibilityStatus="allowed"
				expectedBindingTarget={target}
				onOpenChange={onOpenChange}
				onProfileUpdated={onProfileUpdated}
				open={open}
				organizationId="org-1"
				profile={profileFixture(overrides)}
				recovery={recovery}
				storageScope="account-1"
				target={TARGET}
			/>
		</TestQueryClientProvider>
	);
	const queryClient = createTestQueryClient();
	const { rerender } = render(view(bindingTarget));
	return {
		onOpenChange,
		onProfileUpdated,
		close: () => rerender(view(bindingTarget, false)),
		rebind: (target: typeof BINDING_TARGET) => rerender(view(target)),
	};
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
		// Cut in the middle: the last folder name stays visible on its own and
		// the full path is the tooltip.
		const tail = await row.findByText("/openmeld");
		const path = tail.closest("[data-slot='folder-path']");
		expect(path?.textContent).toBe("/Users/felix/work/openmeld");
		expect(path?.getAttribute("aria-description")).toBe(
			"/Users/felix/work/openmeld"
		);
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

	it("closes on the folders it showed, not on its header alone", async () => {
		const dialog = renderDialog();
		await findRow("openmeld");
		dialog.close();
		// The exit animation still shows the body; it goes with the dialog.
		expect(screen.getByRole("list", { name: "Folders" })).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("keeps its loading layout until the folders and default path are read", async () => {
		let resolveFolders: (value: unknown) => void = () => undefined;
		readFoldersMock.mockReturnValue(
			new Promise((resolve) => {
				resolveFolders = resolve;
			})
		);
		renderDialog();
		expect(
			document.querySelector("[data-slot='folders-dialog-skeleton']")
		).not.toBeNull();
		expect(screen.queryByRole("list", { name: "Folders" })).toBeNull();
		resolveFolders(current(PROJECTION));
		await findRow("openmeld");
		expect(
			document.querySelector("[data-slot='folders-dialog-skeleton']")
		).toBeNull();
	});

	it("is titled Working folder, like the card and menu entry that open it", () => {
		renderDialog();
		expect(
			screen.getByRole("heading", { name: "Working folder" })
		).toBeTruthy();
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

	it("makes the first folder added to an Agent with none its default", async () => {
		const added = {
			displayName: "OpenMeld folder",
			folderId: OTHER_ID,
			isDefault: false,
			kind: "openmeld_managed" as const,
		};
		readFoldersMock.mockResolvedValue(
			current({ ...PROJECTION, defaultFolderId: null, folders: [] })
		);
		manageFoldersMock.mockImplementation(({ operation }) =>
			Promise.resolve({
				agentProfileId: "profile-agent",
				folderId: operation.folderId ?? OTHER_ID,
				observedAtMs: 2,
				projection: {
					defaultFolderId: operation.folderId ?? null,
					folders: [
						{ ...added, isDefault: operation.operation === "set_default" },
					],
					revision: 5,
				},
				target: TARGET,
			})
		);
		renderDialog();
		await screen.findByText(NO_FOLDERS_YET);
		fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Use the OpenMeld folder" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
		await waitFor(() =>
			expect(manageFoldersMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					operation: { folderId: OTHER_ID, operation: "set_default" },
				})
			)
		);
		await waitFor(() =>
			expect(updateDefaultProjectMock).toHaveBeenCalledWith(
				expect.objectContaining({ defaultProjectId: null })
			)
		);
	});

	it("keeps the current default when another folder is added", async () => {
		renderDialog();
		await findRow("openmeld");
		fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Use the OpenMeld folder" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
		await waitFor(() => expect(manageFoldersMock).toHaveBeenCalledTimes(1));
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
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

	it("prepares the saved default folder again before clearing the Default Project", async () => {
		// The folder is already the saved default; its OpenMeld folder may be
		// missing, so it is prepared again before the Project clear.
		renderDialog({ defaultProjectId: "project-old" });
		const row = await findRow("openmeld");
		fireEvent.click(row.getByRole("button", { name: "Make default" }));
		await waitFor(() =>
			expect(updateDefaultProjectMock).toHaveBeenCalledWith(
				expect.objectContaining({ defaultProjectId: null })
			)
		);
		expect(manageFoldersMock).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: { folderId: CUSTOM_ID, operation: "set_default" },
			})
		);
		expect(manageFoldersMock.mock.invocationCallOrder[0]).toBeLessThan(
			updateDefaultProjectMock.mock.invocationCallOrder[0] ?? 0
		);
	});

	it("blocks writes when the Agent's computer changes while Folders is open", async () => {
		const { rebind } = renderDialog();
		await findRow("website");
		rebind({ ...BINDING_TARGET, bindingId: "binding-2" });
		expect(await screen.findByText(COMPUTER_CHANGED_MESSAGE)).toBeTruthy();
		expect(
			(await findRow("website"))
				.getByRole("button", { name: "Make default" })
				.hasAttribute("disabled")
		).toBe(true);
	});

	it("shows the owner's Inbox confirmation instead of a change while a colleague's task runs", async () => {
		// The same structured refusal every gated folder write returns.
		manageFoldersMock.mockRejectedValue({
			code: "http_409",
			message: formatCredentialConfirmationRequiredMessage("confirmation-1"),
			requestId: null,
			status: 409,
			upstreamCode: CREDENTIAL_CONFIRMATION_REQUIRED_CODE,
		});
		renderDialog();
		const row = await findRow("website");
		fireEvent.click(row.getByRole("button", { name: "Make default" }));
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Confirm this change in your OpenMeld Inbox"
		);
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
		expect((await findRow("openmeld")).getByText("Default")).toBeTruthy();
	});

	it("repairs unreadable folder settings with the folder new work starts in", async () => {
		readFoldersMock.mockResolvedValue({
			agentProfileId: "profile-agent",
			message:
				"The working folder settings are invalid (invalid_schema). Repair them before changing folders.",
			reasonCode: "profile_folder.configuration_invalid",
			status: "unavailable",
			target: TARGET,
		});
		manageFoldersMock.mockResolvedValue({
			agentProfileId: "profile-agent",
			folderId: CUSTOM_ID,
			observedAtMs: 2,
			projection: { ...PROJECTION, revision: 1_800_000_000_000 },
			target: TARGET,
		});
		const { onProfileUpdated } = renderDialog({
			defaultProjectId: "project-old",
		});
		expect(await screen.findByText(SETTINGS_UNREADABLE)).toBeTruthy();
		// Ordinary changes can't apply to settings that can't be read.
		expect(screen.queryByRole("button", { name: "Add folder" })).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Use the OpenMeld folder" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
		await waitFor(() => expect(updateDefaultProjectMock).toHaveBeenCalled());
		expect(manageFoldersMock).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBindingTarget: BINDING_TARGET,
				operation: {
					folder: { kind: "openmeld_managed" },
					operation: "repair",
				},
			})
		);
		// The repaired folder only starts new work once no Default Project wins.
		expect(updateDefaultProjectMock).toHaveBeenCalledWith(
			expect.objectContaining({ defaultProjectId: null })
		);
		expect(onProfileUpdated).toHaveBeenCalled();
		expect(clearCreationSetupMock).toHaveBeenCalledWith("profile-agent");
		expect(await findRow("openmeld")).toBeTruthy();
	});

	it("sets up the current folder again from recovery and rechecks the Agent", async () => {
		const onSaved = vi.fn();
		const { onOpenChange } = renderDialog({}, BINDING_TARGET, {
			message: "This Agent could not use its working folder.",
			onSaved,
		});
		expect(
			screen.getByText("This Agent could not use its working folder.")
		).toBeTruthy();
		const row = await findRow("openmeld");
		// Only the folder new work starts in can be set up again.
		expect(
			(await findRow("website")).queryByRole("button", {
				name: "Set up again",
			})
		).toBeNull();
		// The saved path is read for its owner before the button applies.
		await row.findByText("/openmeld");
		fireEvent.click(row.getByRole("button", { name: "Set up again" }));
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		// A repair, which a Service too old to prepare the folder refuses.
		expect(manageFoldersMock).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: {
					folder: { kind: "custom", path: "/Users/felix/work/openmeld" },
					operation: "repair",
				},
			})
		);
		expect(clearCreationSetupMock).toHaveBeenCalledWith("profile-agent");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("rechecks the Agent after recovery makes another folder the default", async () => {
		const onSaved = vi.fn();
		renderDialog({}, BINDING_TARGET, { message: "Recover.", onSaved });
		fireEvent.click(
			(await findRow("website")).getByRole("button", { name: "Make default" })
		);
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
	});

	it("blocks recovery writes while the Agent's Computer can't be confirmed", async () => {
		const blocked =
			"Couldn’t confirm this Agent’s current Computer. Close and reopen Working folder to try again.";
		renderDialog({}, BINDING_TARGET, {
			message: "Recover.",
			onSaved: vi.fn(),
			saveBlockedReason: blocked,
		});
		const row = await findRow("openmeld");
		expect(screen.getByText(blocked)).toBeTruthy();
		expect(
			row.getByRole("button", { name: "Set up again" }).hasAttribute("disabled")
		).toBe(true);
		expect(
			(await findRow("website"))
				.getByRole("button", { name: "Make default" })
				.hasAttribute("disabled")
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Add folder" })
				.hasAttribute("disabled")
		).toBe(true);
	});

	it("blocks repair while the Agent's Computer can't be confirmed", async () => {
		readFoldersMock.mockResolvedValue({
			agentProfileId: "profile-agent",
			message: "Repair them before changing folders.",
			reasonCode: "profile_folder.configuration_invalid",
			status: "unavailable",
			target: TARGET,
		});
		renderDialog({}, BINDING_TARGET, {
			message: "Recover.",
			onSaved: vi.fn(),
			saveBlockedReason: "Checking this Agent’s current Computer…",
		});
		await screen.findByText(SETTINGS_UNREADABLE);
		fireEvent.click(
			screen.getByRole("button", { name: "Use the OpenMeld folder" })
		);
		expect(
			screen
				.getByRole("button", { name: "Use this folder" })
				.hasAttribute("disabled")
		).toBe(true);
	});

	it("clears a Default Project set elsewhere and keeps a failed clear visible", async () => {
		readFoldersMock.mockResolvedValue({
			agentProfileId: "profile-agent",
			message: "Repair them before changing folders.",
			reasonCode: "profile_folder.configuration_invalid",
			status: "unavailable",
			target: TARGET,
		});
		updateDefaultProjectMock.mockRejectedValue(new Error("offline"));
		// This opening saw no Default Project; another tab may have set one.
		renderDialog();
		await screen.findByText(SETTINGS_UNREADABLE);
		fireEvent.click(
			screen.getByRole("button", { name: "Use the OpenMeld folder" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
		// The repaired list replaces the form; the partial failure stays.
		expect((await screen.findByRole("alert")).textContent).toContain(
			"couldn’t confirm that the Default Project was cleared"
		);
		expect(updateDefaultProjectMock).toHaveBeenCalledWith(
			expect.objectContaining({ defaultProjectId: null })
		);
		expect(await findRow("openmeld")).toBeTruthy();
		expect(clearCreationSetupMock).not.toHaveBeenCalled();
	});
});
