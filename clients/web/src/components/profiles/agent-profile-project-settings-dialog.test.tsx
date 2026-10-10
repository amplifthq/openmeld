import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
	getAgentExecutionReadinessBatchResponseSchema,
	HOSTED_CENTER_AGENT_CONTROLLER_REF,
	profileWorkspaceReadResultSchema,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessBatchResponse,
	GetAgentProfileControllerChangeEligibilityResponse,
	GetCurrentAgentProfileWorkspaceResponse,
	ProfileWorkspaceMode,
} from "@openmeld/schemas/types";
import { QueryObserver } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkingFolderRecoveryAction } from "#/components/spaces/agent-working-folder-recovery-action";
import {
	readPendingAgentProfileCreationLocalSetup,
	rememberPendingAgentProfileCreationLocalSetup,
} from "#/lib/profiles/agent-profile-creation-local-setup";
import { agentExecutionReadinessQueryKeys } from "#/query/agents/execution-readiness";
import { projectQueryKeys } from "#/query/organizations/projects";
import { agentProfilePrimaryBindingQueryKeys } from "#/query/profiles/primary-binding";
import { startProfilesQueryOptions } from "#/query/profiles/profiles";
import { startQueryKeys } from "#/query/query-keys";
import readinessCapture from "#/test-support/local-agent-readiness.fixture.json";
import workspaceCapture from "#/test-support/profile-workspace-read.fixture.json";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { shouldShowAgentProfileProjectSettings } from "./agent-profile-project-settings";
import { AgentProfileProjectSettingsDialog } from "./agent-profile-project-settings-dialog";

const updateDefaultProjectMock = vi.hoisted(() => vi.fn());
const updateWorkspaceMock = vi.hoisted(() => vi.fn());
const readWorkspaceMock = vi.hoisted(() => vi.fn());
const listProfilesMock = vi.hoisted(() => vi.fn());
const readReadinessMock = vi.hoisted(() => vi.fn());
const readEligibilityMock = vi.hoisted(() => vi.fn());
const spaceEditMock = vi.hoisted(() => vi.fn());
const RECOVERY_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SAVING_BUTTON_NAME = /saving/i;
const ACTIVE_WAKE_FOLDER_CHANGE_MESSAGE =
	/wait until this task finishes to change a folder on this computer/i;
const SERVICE_READ_UPDATE_MESSAGE = /update openmeld service to read/i;
const RETAINED_FOLDER_DRAFT_MESSAGE = /your changes are still here/i;

afterEach(cleanup);

vi.mock("#/lib/agents/agent-execution-readiness", () => ({
	readAgentExecutionReadinessBatch: readReadinessMock,
}));
vi.mock("#/lib/profiles/agent-profile-primary-binding", async () => ({
	...(await vi.importActual<
		typeof import("#/lib/profiles/agent-profile-primary-binding")
	>("#/lib/profiles/agent-profile-primary-binding")),
	readAgentProfileControllerChangeEligibility: readEligibilityMock,
}));
vi.mock("#/components/spaces/space-agent-profile-edit-context", () => ({
	useOptionalSpaceAgentProfileEditContext: spaceEditMock,
}));

vi.mock("#/lib/profiles/update-default-project", () => ({
	updateAgentProfileDefaultProject: updateDefaultProjectMock,
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: listProfilesMock,
}));

vi.mock("#/lib/profiles/update-profile-workspace", () => ({
	updateAgentProfileWorkspace: updateWorkspaceMock,
	readAgentProfileWorkspace: readWorkspaceMock,
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
		readWorkspaceMock.mockReset().mockResolvedValue(workspaceFixture("custom"));
		listProfilesMock.mockReset().mockResolvedValue([profileFixture()]);
	});

	it("does not acquire an Auth read that started before the dialog opened", async () => {
		const previous = [profileFixture({ defaultProjectId: null })];
		const oldRead = deferred<readonly AuthProfileView[]>();
		const freshRead = deferred<readonly AuthProfileView[]>();
		listProfilesMock
			.mockReturnValueOnce(oldRead.promise)
			.mockReturnValueOnce(freshRead.promise);
		const queryClient = createSettingsQueryClient();
		const options = startProfilesQueryOptions({
			enabled: true,
			storageScope: "account-1",
		});
		queryClient.setQueryData(options.queryKey, previous);
		const observer = new QueryObserver(queryClient, {
			...options,
			staleTime: 0,
		});
		const unsubscribe = observer.subscribe(vi.fn());
		await vi.waitFor(() => expect(listProfilesMock).toHaveBeenCalledTimes(1));
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<AgentProfileProjectSettingsDialog
					actorProfileId="human-1"
					agentControllerRef="builtin:codex"
					executionTargetChangeEligibilityStatus="allowed"
					onOpenChange={vi.fn()}
					onProfileUpdated={vi.fn()}
					open={true}
					organizationId="organization-1"
					profile={previous[0]}
					storageScope="account-1"
				/>
			</TestQueryClientProvider>
		);
		act(() => oldRead.resolve(previous));
		await vi.waitFor(() => expect(listProfilesMock).toHaveBeenCalledTimes(2));
		expect(queryClient.getQueryState(options.queryKey)?.status).toBe("success");
		expect(queryClient.getQueryState(options.queryKey)?.error).toBeNull();
		expect(queryClient.getQueryState(options.queryKey)?.isInvalidated).toBe(
			true
		);
		expect(screen.getByText("Loading the saved working folder…")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Save changes" })
				.hasAttribute("disabled")
		).toBe(true);
		await act(async () => {
			freshRead.resolve([profileFixture()]);
			await freshRead.promise;
		});
		await screen.findByRole("combobox", { name: "Project" });
		expect(
			screen.getByRole("combobox", { name: "Project" }).textContent
		).toContain("OpenMeld");
		expect(queryClient.getQueryData(options.queryKey)).toEqual([
			profileFixture(),
		]);
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
		unsubscribe();
		queryClient.clear();
	});

	it("requires a successful saved Project read before editing and retains the draft through later reads", async () => {
		const fresh = deferred<readonly AuthProfileView[]>();
		listProfilesMock.mockReturnValueOnce(fresh.promise);
		const queryClient = createSettingsQueryClient();
		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("account-1"),
			[profileFixture({ defaultProjectId: null })]
		);
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<AgentProfileProjectSettingsDialog
					actorProfileId="human-1"
					agentControllerRef="builtin:codex"
					executionTargetChangeEligibilityStatus="allowed"
					onOpenChange={vi.fn()}
					onProfileUpdated={vi.fn()}
					open={true}
					organizationId="organization-1"
					profile={profileFixture({ defaultProjectId: null })}
					storageScope="account-1"
				/>
			</TestQueryClientProvider>
		);
		expect(screen.getByText("Loading the saved working folder…")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Save changes" })
				.hasAttribute("disabled")
		).toBe(true);
		await act(async () => {
			const failure: StructuredApiClientFailure = {
				code: "auth.unauthenticated",
				upstreamCode: null,
				requestId: "expired-profile-read",
				status: 401,
				message: "Please sign in again.",
			};
			fresh.reject(failure);
			await fresh.promise.catch(() => undefined);
		});
		await screen.findByText("Please sign in again.");
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await screen.findByRole("combobox", { name: "Project" });
		expect(
			screen.getByRole("combobox", { name: "Project" }).textContent
		).toContain("OpenMeld");
		await editCustomFolder("/private/edited-draft");
		listProfilesMock.mockResolvedValue([
			profileFixture({ defaultProjectId: null }),
		]);
		await act(async () => {
			await queryClient.invalidateQueries({
				queryKey: startQueryKeys.profilesForStorageScope("account-1"),
			});
		});
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe("/private/edited-draft");
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
	});

	it("keeps managed and project sources separate", async () => {
		await renderSettings();
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
		await renderSettings(
			"allowed",
			{ defaultProjectId: null },
			"openmeld_managed"
		);
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		const save = screen.getByRole("button", { name: "Save changes" });
		expect((save as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(save);
		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledExactlyOnceWith({
				actorProfileId: "human-1",
				organizationId: "organization-1",
				profileId: "profile-agent",
				target: workspaceFixture().target,
				workspaceMode: "openmeld_managed",
			});
		});
	});

	it("selects a connected project without another folder click and saves only project intent", async () => {
		await renderSettings("allowed", { defaultProjectId: null });
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
		const { onProfileUpdated } = await renderSettings();
		await editCustomFolder("/Users/felix/Private Workspace ");

		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				organizationId: "organization-1",
				profileId: "profile-agent",
				workspaceMode: "custom",
				workspacePath: "/Users/felix/Private Workspace ",
				target: workspaceFixture().target,
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

	it("blocks Save until the Service read completes, keeps its failure visible, and retries from saved configuration", async () => {
		const read = deferred<GetCurrentAgentProfileWorkspaceResponse>();
		readWorkspaceMock
			.mockReturnValueOnce(read.promise)
			.mockResolvedValue(workspaceFixture("custom"));
		listProfilesMock.mockResolvedValue([
			profileFixture({ defaultProjectId: null }),
		]);
		render(
			<TestQueryClientProvider queryClient={createSettingsQueryClient()}>
				<AgentProfileProjectSettingsDialog
					actorProfileId="human-1"
					agentControllerRef="builtin:codex"
					executionTargetChangeEligibilityStatus="allowed"
					onOpenChange={vi.fn()}
					onProfileUpdated={vi.fn()}
					open={true}
					organizationId="organization-1"
					profile={profileFixture()}
					storageScope="account-1"
				/>
			</TestQueryClientProvider>
		);
		await vi.waitFor(() => expect(readWorkspaceMock).toHaveBeenCalledTimes(1));
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(screen.queryByLabelText("Custom working folder path")).toBeNull();
		act(() =>
			read.reject(
				new Error(
					"Update OpenMeld Service to read saved working-folder settings."
				)
			)
		);
		await screen.findByText(SERVICE_READ_UPDATE_MESSAGE);
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		const path = (await screen.findByLabelText(
			"Custom working folder path"
		)) as HTMLInputElement;
		expect(path.value).toBe("/repo");
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
	});

	it.each([
		"binding_changes",
		"route_recovers",
	] as const)("retains the acquired settings draft when %s", async (change) => {
		listProfilesMock.mockResolvedValue([
			profileFixture({ defaultProjectId: null }),
		]);
		const queryClient = createSettingsQueryClient();
		const target = workspaceFixture().target;
		const expectedBindingTarget = {
			bindingId: "binding-original",
			agentControllerRef: "builtin:codex",
			agentControllerConversationId: null,
			openMeldServiceRuntimeId: "runtime-original",
		};
		const props = {
			actorProfileId: "human-1",
			agentControllerRef: "builtin:codex",
			executionTargetChangeEligibilityStatus: "allowed" as const,
			onOpenChange: vi.fn(),
			onProfileUpdated: vi.fn(),
			open: true,
			organizationId: "organization-1",
			profile: profileFixture(),
			storageScope: "account-1",
			target: change === "route_recovers" ? undefined : target,
			expectedBindingTarget,
		};
		const view = render(
			<TestQueryClientProvider queryClient={queryClient}>
				<AgentProfileProjectSettingsDialog {...props} />
			</TestQueryClientProvider>
		);
		await screen.findByLabelText("Custom working folder path");
		await editCustomFolder("/private/retained-draft");
		view.rerender(
			<TestQueryClientProvider queryClient={queryClient}>
				<AgentProfileProjectSettingsDialog
					{...props}
					expectedBindingTarget={
						change === "binding_changes"
							? { ...expectedBindingTarget, bindingId: "binding-second" }
							: expectedBindingTarget
					}
					target={
						change === "binding_changes"
							? { ...target, deviceId: "computer-second" }
							: target
					}
				/>
			</TestQueryClientProvider>
		);
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe("/private/retained-draft");
		expect(readWorkspaceMock).toHaveBeenCalledTimes(1);
		expect(readWorkspaceMock).toHaveBeenCalledWith(
			expect.objectContaining({ target: props.target, expectedBindingTarget })
		);
		if (change === "route_recovers") {
			fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
			await vi.waitFor(() =>
				expect(updateWorkspaceMock).toHaveBeenCalledWith(
					expect.objectContaining({
						target,
						expectedBindingTarget,
						workspacePath: "/private/retained-draft",
					})
				)
			);
			return;
		}
		await screen.findByText(RETAINED_FOLDER_DRAFT_MESSAGE);
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
	});

	it("switches to the managed workspace before clearing the Default Project", async () => {
		const { onProfileUpdated } = await renderSettings();

		selectSource("Let OpenMeld choose");
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await vi.waitFor(() => {
			expect(updateWorkspaceMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				organizationId: "organization-1",
				profileId: "profile-agent",
				workspaceMode: "openmeld_managed",
				target: workspaceFixture().target,
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

	it("shows the local save receipt in Profile settings when the Default Project update fails", async () => {
		const { onProfileUpdated } = await renderSettings();
		updateDefaultProjectMock.mockRejectedValueOnce(
			toStructuredApiClientFailure(new TypeError("Failed to fetch"))
		);
		const draft = "/private/chosen-folder";
		await editCustomFolder(draft);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await screen.findByText(
			"The folder was saved on the original Computer, but the Default Project update could not be confirmed. Close and reopen Working folder to check its current settings."
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe(draft);
		expect(onProfileUpdated).not.toHaveBeenCalled();
	});

	it("allows a future Project choice while blocking local folder changes during work", async () => {
		await renderSettings("blocked");

		expect(screen.getByText(ACTIVE_WAKE_FOLDER_CHANGE_MESSAGE)).toBeTruthy();
		expect(
			(
				screen.getByRole("combobox", {
					name: "Folder source",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
		expect(
			screen
				.getByRole("option", { name: "On this computer" })
				.getAttribute("aria-disabled")
		).toBe("true");
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));

		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await vi.waitFor(() => expect(updateDefaultProjectMock).toHaveBeenCalled());
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
	});

	it("keeps an unknown local folder unselected and blocks a local write during work", async () => {
		await renderSettings("blocked", { defaultProjectId: null }, null);
		expect(
			screen.getByRole("combobox", { name: "Folder source" }).textContent
		).toContain("Choose a folder source");
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
				executionTargetChangeEligibilityStatus="allowed"
				onOpenChange={vi.fn()}
				onProfileUpdated={vi.fn()}
				open={true}
				organizationId="organization-1"
				profile={profileFixture({ managedRole: "center_agent" })}
				storageScope="account-1"
			/>
		);
		expect(container.childElementCount).toBe(0);
	});
});

describe("Working folder recovery Query lifecycle", () => {
	beforeEach(() => {
		updateWorkspaceMock.mockReset().mockResolvedValue(undefined);
		readWorkspaceMock
			.mockReset()
			.mockImplementation(
				async (input: {
					profileId: string;
					target?: GetCurrentAgentProfileWorkspaceResponse["target"];
				}) => ({
					...workspaceFixture("custom"),
					agentProfileId: input.profileId,
					target: input.target ?? workspaceFixture().target,
				})
			);
		updateDefaultProjectMock
			.mockReset()
			.mockResolvedValue(profileFixture({ defaultProjectId: null }));
		readReadinessMock.mockReset().mockResolvedValue(readinessFixture());
		readEligibilityMock.mockReset().mockResolvedValue(eligibilityFixture());
		listProfilesMock.mockReset().mockResolvedValue([
			profileFixture({
				openMeldProfileId: RECOVERY_PROFILE_ID,
				defaultProjectId: null,
			}),
		]);
		spaceEditMock.mockReturnValue({
			context: {
				actorProfileId: "human-1",
				deviceId: "device-current",
				executionTarget: null,
				organizationId: "organization-1",
				runtimeLane: "dev-local",
				storageScope: "account-1",
				onSaved: vi.fn(async () => undefined),
			},
			profilesById: new Map([
				[
					RECOVERY_PROFILE_ID,
					profileFixture({
						openMeldProfileId: RECOVERY_PROFILE_ID,
						defaultProjectId: null,
					}),
				],
			]),
		});
	});

	it("retains the edited draft, pending save and failed-save error through real Query refetches", async () => {
		const queryClient = await renderRecovery();
		const draft = "/private/chosen-folder";
		await editCustomFolder(draft);
		const readiness = deferred<GetAgentExecutionReadinessBatchResponse>();
		const eligibility =
			deferred<GetAgentProfileControllerChangeEligibilityResponse>();
		readReadinessMock.mockReturnValueOnce(readiness.promise);
		readEligibilityMock.mockReturnValueOnce(eligibility.promise);
		let refresh!: Promise<unknown>;
		await act(async () => {
			refresh = refreshRecovery(queryClient);
			await Promise.resolve();
		});
		await screen.findByText("Checking this Agent’s current Computer…");
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe(draft);
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		await act(async () => {
			readiness.resolve(readinessFixture());
			eligibility.resolve(eligibilityFixture());
			await refresh;
		});
		await vi.waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Save changes",
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);

		const save = deferred<void>();
		updateWorkspaceMock.mockReturnValueOnce(save.promise);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await vi.waitFor(() =>
			expect(updateWorkspaceMock).toHaveBeenCalledTimes(1)
		);
		await act(async () => {
			await refreshRecovery(queryClient);
		});
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe(draft);
		expect(
			(
				screen.getByRole("button", {
					name: SAVING_BUTTON_NAME,
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		act(() => {
			save.reject(new Error("The chosen folder is unavailable."));
		});
		await screen.findByText("The chosen folder is unavailable.");
		await act(async () => {
			await refreshRecovery(queryClient);
		});
		expect(screen.getByText("The chosen folder is unavailable.")).toBeTruthy();
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe(draft);
		expect(updateDefaultProjectMock).not.toHaveBeenCalled();
	});

	it.each([
		"computer",
		"binding",
	] as const)("blocks an old draft after a %s change and requires reopening before saving", async (change) => {
		const queryClient = await renderRecovery();
		await editCustomFolder("/private/old-draft");
		const changed = readinessFixture();
		const current = changed.items[0];
		if (!current?.primaryBinding) {
			throw new Error("Missing captured Binding");
		}
		if (change === "computer") {
			current.routeDeviceId = "device-second";
		}
		current.primaryBinding.bindingId = "binding-second";
		readReadinessMock.mockResolvedValue(changed);
		await act(async () => {
			await refreshRecovery(queryClient);
		});
		await screen.findByText(
			"This Agent’s Computer or local agent changed. Close and reopen Working folder to review its current settings."
		);
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe("/private/old-draft");
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(updateWorkspaceMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Review working folder" })
		);
		await screen.findByRole("combobox", { name: "Folder source" });
		await vi.waitFor(() =>
			expect(screen.queryByText("Loading the saved working folder…")).toBeNull()
		);
		await editCustomFolder("/private/new-draft");
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await vi.waitFor(() =>
			expect(updateWorkspaceMock).toHaveBeenCalledWith(
				expect.objectContaining({
					workspacePath: "/private/new-draft",
					target: {
						deviceId:
							change === "computer" ? "device-second" : "device-current",
						runtimeLane: "dev-local",
					},
				})
			)
		);
	});

	it.each([
		"before_local_save",
		"after_local_save",
	] as const)("keeps the frozen Binding during an in-flight save (%s)", async (changeAt) => {
		const queryClient = await renderRecovery();
		await editCustomFolder("/private/retained-draft");
		const save = deferred<void>();
		updateWorkspaceMock.mockReturnValueOnce(save.promise);
		const captured = readinessFixture().items[0]?.primaryBinding;
		if (!(captured?.executionTarget && captured.bindingId)) {
			throw new Error("Missing captured Binding");
		}
		const expected = {
			bindingId: captured.bindingId,
			openMeldServiceRuntimeId:
				captured.executionTarget.openMeldServiceRuntimeId.value,
			agentControllerRef: captured.executionTarget.agentControllerRef,
			agentControllerConversationId:
				captured.executionTarget.agentControllerConversationId ?? null,
		};
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await vi.waitFor(() =>
			expect(updateWorkspaceMock).toHaveBeenCalledWith(
				expect.objectContaining({ expectedBindingTarget: expected })
			)
		);
		const changed = readinessFixture();
		if (!changed.items[0]?.primaryBinding) {
			throw new Error("Missing captured Binding");
		}
		changed.items[0].primaryBinding.bindingId = "binding-after-click";
		readReadinessMock.mockResolvedValue(changed);
		await act(async () => {
			await refreshRecovery(queryClient);
		});
		await screen.findByText(
			"This Agent’s Computer or local agent changed. Close and reopen Working folder to review its current settings."
		);
		const targetChanged: StructuredApiClientFailure = {
			code: "upstream_error",
			upstreamCode: "agent_profile_binding.target_changed",
			requestId: "binding-target-check",
			status: 409,
			message: "Binding changed",
		};
		if (changeAt === "before_local_save") {
			act(() => save.reject(targetChanged));
			await vi.waitFor(() =>
				expect(screen.getByRole("alert").textContent).toContain(
					"This Agent’s Computer or local agent changed."
				)
			);
			expect(updateDefaultProjectMock).not.toHaveBeenCalled();
		} else {
			updateDefaultProjectMock.mockRejectedValueOnce(targetChanged);
			act(() => save.resolve(undefined));
			await screen.findByText(
				"The folder was saved on the original Computer. This Agent’s Default Project is unchanged. Close and reopen Working folder to review its current settings."
			);
			expect(updateDefaultProjectMock).toHaveBeenCalledWith(
				expect.objectContaining({
					expectedBindingTarget: expected,
					defaultProjectId: null,
				})
			);
		}
		expect(
			(screen.getByLabelText("Custom working folder path") as HTMLInputElement)
				.value
		).toBe("/private/retained-draft");
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});

function readinessFixture() {
	// Captured from the isolated Core HTTP response on 2026-10-09. Only synthetic
	// identifiers and display names are replaced; the shared schema guards drift.
	return getAgentExecutionReadinessBatchResponseSchema.parse(
		structuredClone(readinessCapture)
	);
}
function eligibilityFixture(): GetAgentProfileControllerChangeEligibilityResponse {
	return {
		agentProfileId: RECOVERY_PROFILE_ID,
		reasonCode: "agent_profile_binding.controller_change_allowed",
		status: "allowed",
	};
}
async function renderRecovery() {
	const queryClient = createSettingsQueryClient();
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AgentWorkingFolderRecoveryAction profileId={RECOVERY_PROFILE_ID} />
		</TestQueryClientProvider>
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Review working folder" })
	);
	await screen.findByRole("combobox", { name: "Folder source" });
	await vi.waitFor(() => {
		if (screen.queryByText("Loading the saved working folder…")) {
			throw new Error("The saved working folder has not been acquired.");
		}
	});
	return queryClient;
}
function refreshRecovery(
	queryClient: ReturnType<typeof createTestQueryClient>
) {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: startQueryKeys.profilesForStorageScope("account-1"),
		}),
		queryClient.invalidateQueries({
			queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
				"account-1",
				"organization-1"
			),
		}),
		queryClient.invalidateQueries({
			queryKey: agentProfilePrimaryBindingQueryKeys.controllerChangeEligibility(
				"account-1",
				RECOVERY_PROFILE_ID
			),
		}),
	]);
}
async function editCustomFolder(path: string) {
	selectSource("On this computer");
	if (!screen.queryByLabelText("Custom working folder path")) {
		fireEvent.click(
			await screen.findByRole("button", { name: "Enter path manually" })
		);
	}
	fireEvent.change(await screen.findByLabelText("Custom working folder path"), {
		target: { value: path },
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

async function renderSettings(
	executionTargetChangeEligibilityStatus:
		| "allowed"
		| "blocked"
		| "unavailable" = "allowed",
	overrides: Partial<AuthProfileView> = {},
	workspaceMode: ProfileWorkspaceMode | null = "custom"
) {
	const queryClient = createSettingsQueryClient();
	readWorkspaceMock.mockResolvedValue(workspaceFixture(workspaceMode));
	listProfilesMock.mockResolvedValue([profileFixture(overrides)]);
	const onProfileUpdated = vi.fn();
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AgentProfileProjectSettingsDialog
				actorProfileId="human-1"
				agentControllerRef="builtin:codex"
				executionTargetChangeEligibilityStatus={
					executionTargetChangeEligibilityStatus
				}
				onOpenChange={vi.fn()}
				onProfileUpdated={onProfileUpdated}
				open={true}
				organizationId="organization-1"
				profile={profileFixture(overrides)}
				storageScope="account-1"
			/>
		</TestQueryClientProvider>
	);
	await vi.waitFor(() => {
		if (screen.queryByText("Loading the saved working folder…")) {
			throw new Error("The saved working folder has not been acquired.");
		}
	});
	return { onProfileUpdated };
}

// Captured from the actual account-admitted Service reader in the isolated lane.
// Profile identity and paths are sanitized; variants use the shared wire type.
function workspaceFixture(
	mode: ProfileWorkspaceMode | null = "openmeld_managed"
): GetCurrentAgentProfileWorkspaceResponse {
	const captured = profileWorkspaceReadResultSchema.parse(
		workspaceCapture.workspace
	);
	if (captured.status !== "configured") {
		throw new Error("Expected captured saved configuration");
	}
	return {
		agentProfileId: "profile-agent",
		target: { deviceId: "device-current", runtimeLane: "canary" },
		workspace: mode
			? {
					...captured,
					workspaceMode: mode,
					workspacePath: mode === "custom" ? "/repo" : captured.workspacePath,
				}
			: { status: "missing" },
	};
}

function createSettingsQueryClient() {
	const queryClient = createTestQueryClient();
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
	return queryClient;
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
