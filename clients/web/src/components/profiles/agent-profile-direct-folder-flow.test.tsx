import type {
	AuthProfileView,
	LocalFolderPickerResult,
} from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AgentProfileFoldersDialog } from "./agent-profile-folders-dialog";

const mocks = vi.hoisted(() => ({
	desktop: vi.fn(),
	manage: vi.fn(),
	pick: vi.fn(),
	clearProject: vi.fn(),
	clearSetup: vi.fn(),
}));

vi.mock("#/desktop/platform", () => ({ getDesktopPlatform: mocks.desktop }));
vi.mock("#/lib/connect/local-folder-picker", () => ({
	selectPeopleComputerFolders: mocks.pick,
}));
vi.mock("#/lib/profiles/agent-profile-folders", () => ({
	manageAgentProfileFolders: mocks.manage,
	readAgentProfileFolders: vi.fn(),
}));
vi.mock("#/lib/profiles/update-default-project", () => ({
	updateAgentProfileDefaultProject: mocks.clearProject,
}));
vi.mock("#/lib/profiles/agent-profile-creation-local-setup", () => ({
	clearPendingAgentProfileCreationLocalSetupForProfile: mocks.clearSetup,
}));

const TARGET = { deviceId: "test-device", runtimeLane: "prod" } as const;
const BINDING = {
	agentControllerConversationId: null,
	agentControllerRef: "builtin:codex",
	bindingId: "binding-1",
	openMeldServiceRuntimeId: "runtime-1",
};
const PERSISTED = {
	agentProfileId: "agent-1",
	folderId: "folder-1",
	observedAtMs: 2,
	projection: { defaultFolderId: "folder-1", folders: [], revision: 3 },
	target: TARGET,
};
const PROFILE = {
	defaultProjectId: "project-1",
	managedRole: null,
	openMeldProfileId: "agent-1",
	profileName: "Fixture Agent",
} as AuthProfileView;

function Fixture(
	overrides: Partial<ComponentProps<typeof AgentProfileFoldersDialog>>
) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button onClick={() => setOpen(true)} type="button">
				Folder
			</button>
			<AgentProfileFoldersDialog
				actorProfileId="human-1"
				agentControllerRef="builtin:codex"
				executionTargetChangeEligibilityStatus="allowed"
				expectedBindingTarget={BINDING}
				onOpenChange={setOpen}
				onProfileUpdated={vi.fn()}
				open={open}
				organizationId="org-1"
				profile={PROFILE}
				storageScope="test"
				target={TARGET}
				{...overrides}
			/>
		</>
	);
}

function clickFolder() {
	fireEvent.click(screen.getByRole("button", { name: "Folder" }));
}

describe("direct Agent Profile folder action", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.desktop.mockReturnValue(null);
		mocks.manage.mockResolvedValue(PERSISTED);
		mocks.clearProject.mockResolvedValue({
			...PROFILE,
			defaultProjectId: null,
		});
	});

	afterEach(cleanup);

	it("opens the native picker directly and saves its chosen or newly created folder", async () => {
		let complete: ((result: LocalFolderPickerResult) => void) | undefined;
		mocks.pick.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		render(<Fixture />, { wrapper: TestQueryClientProvider });
		clickFolder();
		await waitFor(() =>
			expect(mocks.pick).toHaveBeenCalledExactlyOnceWith({
				...TARGET,
				allowMultiple: false,
				purpose: "agent_profile_working_folder",
				timeoutMs: 610_000,
			})
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByText("Folder source")).toBeNull();
		expect(mocks.manage).not.toHaveBeenCalled();
		await act(() =>
			complete?.({
				deviceId: TARGET.deviceId,
				paths: ["/synthetic/New Folder"],
				status: "selected",
			})
		);
		await waitFor(() =>
			expect(mocks.manage).toHaveBeenCalledExactlyOnceWith({
				actorProfileId: "human-1",
				expectedBindingTarget: BINDING,
				operation: {
					folder: { kind: "custom", path: "/synthetic/New Folder" },
					operation: "repair",
				},
				organizationId: "org-1",
				profileId: "agent-1",
			})
		);
		expect(mocks.clearProject).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				defaultProjectId: null,
				expectedBindingTarget: BINDING,
			})
		);
		expect(mocks.manage).toHaveBeenCalledBefore(mocks.clearProject);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("cancels without writes and can open again", async () => {
		mocks.pick.mockResolvedValue({
			deviceId: TARGET.deviceId,
			status: "cancelled",
		});
		render(<Fixture />, { wrapper: TestQueryClientProvider });
		clickFolder();
		await waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(1));
		clickFolder();
		await waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(2));
		expect(mocks.manage).not.toHaveBeenCalled();
		expect(mocks.clearProject).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("does not save a folder when the Agent changes Computer while the picker is open", async () => {
		let complete: ((result: LocalFolderPickerResult) => void) | undefined;
		mocks.pick.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const view = render(<Fixture />, { wrapper: TestQueryClientProvider });
		clickFolder();
		await waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(1));
		view.rerender(<Fixture target={{ ...TARGET, runtimeLane: "canary" }} />);
		await act(() =>
			complete?.({
				deviceId: TARGET.deviceId,
				paths: ["/synthetic/Unchanged"],
				status: "selected",
			})
		);
		expect(
			await screen.findByText(
				"This Agent’s computer or availability changed. No folder change was saved."
			)
		).toBeTruthy();
		expect(mocks.manage).not.toHaveBeenCalled();
	});

	it("retries only the Project clear after the local folder is already saved", async () => {
		mocks.pick.mockResolvedValue({
			deviceId: TARGET.deviceId,
			paths: ["/synthetic/Selected"],
			status: "selected",
		});
		mocks.clearProject.mockRejectedValueOnce(new Error("offline"));
		render(<Fixture />, { wrapper: TestQueryClientProvider });
		clickFolder();
		expect(
			await screen.findByText(
				"The folder was saved, but OpenMeld couldn’t clear the default Project. Try finishing the change."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Finish save" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(mocks.pick).toHaveBeenCalledTimes(1);
		expect(mocks.manage).toHaveBeenCalledTimes(1);
		expect(mocks.clearProject).toHaveBeenCalledTimes(2);
	});

	it("shows a concise error without a source chooser when the picker is unavailable", async () => {
		mocks.pick.mockResolvedValue({
			code: "local.folder_picker.service_offline",
			deviceId: TARGET.deviceId,
			status: "unavailable",
		});
		render(<Fixture />, { wrapper: TestQueryClientProvider });
		clickFolder();
		expect(await screen.findByText("This computer is offline.")).toBeTruthy();
		expect(screen.queryByText("Folder source")).toBeNull();
		expect(screen.queryByText("Add folder")).toBeNull();
		expect(mocks.manage).not.toHaveBeenCalled();
	});

	it("keeps older Services working only after an explicit repair-unsupported result", async () => {
		mocks.pick.mockResolvedValue({
			deviceId: TARGET.deviceId,
			paths: ["/synthetic/Legacy"],
			status: "selected",
		});
		mocks.manage.mockRejectedValueOnce({
			upstreamCode: "local_agent_control.unsupported",
			message: "Not supported",
		});
		render(<Fixture />, { wrapper: TestQueryClientProvider });
		clickFolder();
		await waitFor(() => expect(mocks.clearProject).toHaveBeenCalled());
		expect(
			mocks.manage.mock.calls.map(([request]) => request.operation)
		).toEqual([
			{
				folder: { kind: "custom", path: "/synthetic/Legacy" },
				operation: "repair",
			},
			{ operation: "add_custom", path: "/synthetic/Legacy" },
			{ folderId: "folder-1", operation: "set_default" },
		]);
	});
});
