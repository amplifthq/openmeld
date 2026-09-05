import type {
	LocalProjectControlConnection,
	LocalProjectControlProjectDiscovery,
	Project,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectLocalFolders } from "#/lib/connect/local-folder-picker";
import { ProjectComputerSection } from "./project-computer-section";

const REPLACEMENT_PATH_PATTERN = /\/work\/openmeld-feature/iu;

const {
	connectCandidate,
	connectPath,
	discoveryController,
	removeConnection,
	setDefaultConnection,
} = vi.hoisted(() => ({
	connectCandidate: vi.fn(),
	connectPath: vi.fn(),
	discoveryController: {
		applyConnectionSnapshot: vi.fn(),
		claimMutationGeneration: vi.fn(() => 2),
		computer: {
			deviceDisplayName: "Felix’s Mac",
		} as {
			deviceDisplayName: string;
			deviceId?: string;
			localFolderPicker?: { selectFolders: true };
		},
		isRefreshing: false,
		projectView: vi.fn(),
		refresh: vi.fn(),
		refreshErrorMessage: null,
		serviceState: "connected",
		target: {},
	},
	removeConnection: vi.fn(),
	setDefaultConnection: vi.fn(),
}));

vi.mock("./use-project-discovery", () => ({
	useProjectDiscovery: () => discoveryController,
}));
vi.mock("#/lib/connect/local-folder-picker", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/connect/local-folder-picker")>();
	return { ...original, selectLocalFolders: vi.fn() };
});
vi.mock("#/lib/organizations/local-project-control", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("#/lib/organizations/local-project-control")
		>();
	return {
		...original,
		connectCurrentComputerProjectCandidate: connectCandidate,
		connectCurrentComputerProjectPath: connectPath,
		removeCurrentComputerMissingProjectConnections: vi.fn(),
		removeCurrentComputerProjectConnection: removeConnection,
		setCurrentComputerProjectDefaultConnection: setDefaultConnection,
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	discoveryController.serviceState = "connected";
	discoveryController.isRefreshing = false;
	discoveryController.refreshErrorMessage = null;
	discoveryController.computer = { deviceDisplayName: "Felix’s Mac" };
});

describe("ProjectComputerSection", () => {
	it("fills the Project folder from this Computer’s native picker", async () => {
		discoveryController.computer = {
			deviceDisplayName: "Felix’s Mac",
			deviceId: "device-current",
			localFolderPicker: { selectFolders: true },
		};
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("found"),
			status: "ready",
		});
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-current",
			paths: ["/Users/felix/Design Work "],
			status: "selected",
		});
		connectPath.mockResolvedValue({
			bindingGeneration: "binding-1",
			canonicalPath: "/Users/felix/Design Work ",
			isDefault: true,
			status: "connected",
		});

		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect folder" }));
		expect(screen.queryByLabelText("Folder path")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Enter path manually" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose a folder on this computer" })
		);

		await waitFor(() => expect(selectLocalFolders).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(
				screen.getByTestId("project-selected-folder").textContent
			).toContain("/Users/felix/Design Work ")
		);
		fireEvent.click(screen.getByRole("button", { name: "Check and connect" }));
		await waitFor(() =>
			expect(connectPath).toHaveBeenCalledWith(
				expect.objectContaining({
					declaredPath: "/Users/felix/Design Work ",
				})
			)
		);
	});

	it("keeps manual Project paths as an explicit final fallback", () => {
		discoveryController.computer = {
			deviceDisplayName: "Felix’s Mac",
			deviceId: "device-current",
			localFolderPicker: { selectFolders: true },
		};
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("not_found"),
			status: "ready",
		});

		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect folder" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Enter path manually" })
		);

		expect(screen.getByLabelText("Folder path")).toBeTruthy();
	});

	it.each([
		[
			"checking",
			null,
			"Checking this computer",
			"Looking for matching folders and worktrees.",
		],
		[
			"service_unavailable",
			null,
			"Computer unavailable",
			"This computer isn't connected to OpenMeld right now. Reconnect it, then try again.",
		],
		[
			"ready",
			discovery("found"),
			"Matching folders found",
			"Choose where agents should work.",
		],
		[
			"ready",
			discovery("connected"),
			"Folder connected",
			"Agents will start in the default folder below.",
		],
		[
			"ready",
			discovery("connected_folder_missing"),
			"Default folder unavailable",
			"Locate it or choose another default folder.",
		],
		[
			"ready",
			discovery("not_found"),
			"No matching folders found",
			"Connect a folder so agents can work on this Project.",
		],
		[
			"ready",
			discovery("verification_unavailable"),
			"Couldn’t verify folders",
			"OpenMeld couldn’t verify repositories with Git.",
		],
	] as const)("renders %s with a concise next step", (status, projectDiscovery, expectedTitle, expectedDescription) => {
		discoveryController.projectView.mockReturnValue({
			connections: projectDiscovery?.connections ?? [],
			discovery: projectDiscovery,
			status,
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		expect(screen.getByRole("heading", { name: expectedTitle })).toBeTruthy();
		expect(screen.getByText(expectedDescription)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Connect folder" })).toBeTruthy();
	});

	it("describes an unreachable computer without claiming the Service is disconnected", () => {
		discoveryController.serviceState = "service_unavailable";
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: null,
			status: "service_unavailable",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		expect(
			screen.getByText(
				"This computer isn't connected to OpenMeld right now. Reconnect it, then try again."
			)
		).toBeTruthy();
		expect(
			screen.queryByText(
				"OpenMeld Service is not connected on this computer. Reconnect it, then try again."
			)
		).toBeNull();
	});

	it("separates a connected Service from a failed Project check and offers retry", () => {
		discoveryController.serviceState = "connected";
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: null,
			errorMessage:
				"OpenMeld couldn’t check this Project on this computer. Try again.",
			status: "discovery_failed",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		expect(screen.getByText("Computer connected")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Couldn’t check this computer" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Check again" }));
		expect(discoveryController.refresh).toHaveBeenCalledOnce();
	});

	it("offers Check again after a successful check", () => {
		discoveryController.projectView.mockReturnValue({
			connections: discovery("connected").connections,
			discovery: discovery("connected"),
			status: "ready",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Check again" }));
		expect(discoveryController.refresh).toHaveBeenCalledOnce();
		expect(screen.getAllByText("Connected")).toHaveLength(1);
		expect(screen.queryByText("Computer connected")).toBeNull();
	});

	it("keeps Service state visible until the Project is connected", () => {
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("found"),
			status: "ready",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		expect(screen.getByText("Computer connected")).toBeTruthy();
	});

	it("retries a non-Git folder only after explicit Connect anyway confirmation", async () => {
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("not_found"),
			status: "ready",
		});
		connectPath
			.mockRejectedValueOnce({
				code: "upstream_error",
				message: "confirmation required",
				requestId: "request-1",
				status: 409,
				upstreamCode: "needs_confirmation",
			})
			.mockResolvedValueOnce({
				bindingGeneration: "binding-1",
				canonicalPath: "/work/notes",
				isDefault: true,
				status: "connected",
			});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect folder" }));
		fireEvent.change(screen.getByLabelText("Folder path"), {
			target: { value: "/work/notes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Check and connect" }));

		expect(
			await screen.findByText(
				"OpenMeld couldn’t verify this folder with Git. You can still connect it, but automatic matching and worktree discovery won’t be available."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Connect anyway" }));

		await waitFor(() => expect(connectPath).toHaveBeenCalledTimes(2));
		expect(connectPath.mock.calls[0]?.[0]).not.toHaveProperty("confirmNonGit");
		expect(connectPath.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({
				confirmNonGit: true,
				declaredPath: "/work/notes",
			})
		);
	});

	it("moves a folder only after explaining the cross-Organization impact", async () => {
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("found"),
			status: "ready",
		});
		connectCandidate
			.mockResolvedValueOnce({
				code: "path_conflict",
				conflictingProjectSlug: "client-app",
				conflictScope: "another_organization",
				message:
					"This folder is already connected to the “client-app” Project in another Organization.",
				moveConfirmationToken: "move-confirmation-1",
				moveImpact: "only_connection",
				status: "rejected",
			})
			.mockResolvedValueOnce({
				bindingGeneration: "binding-moved",
				canonicalPath: "/work/openmeld",
				isDefault: true,
				status: "connected",
			});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		fireEvent.click(screen.getByRole("button", { name: "Connect 1 folder" }));

		expect(
			await screen.findByRole("heading", {
				name: "Move this folder to OpenMeld?",
			})
		).toBeTruthy();
		expect(
			screen.getByText(
				"This folder is currently connected to the “client-app” Project in another Organization. Moving it here disconnects it there."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Agents using that Project on this computer won’t be able to start until another folder is connected."
			)
		).toBeTruthy();
		expect(connectCandidate.mock.calls[0]?.[0]).not.toHaveProperty(
			"moveConfirmationToken"
		);

		fireEvent.click(screen.getByRole("button", { name: "Move folder" }));

		await waitFor(() => expect(connectCandidate).toHaveBeenCalledTimes(2));
		expect(connectCandidate.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({
				candidateId: "candidate-1",
				moveConfirmationToken: "move-confirmation-1",
			})
		);
		await waitFor(() =>
			expect(discoveryController.refresh).toHaveBeenCalledTimes(1)
		);
	});

	it("defers refresh until a later conflicting folder is confirmed", async () => {
		const candidates = [
			{
				candidateId: "candidate-repository",
				candidateKind: "repository",
				canonicalPath: "/work/openmeld",
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
			},
			{
				candidateId: "candidate-worktree",
				candidateKind: "worktree",
				canonicalPath: "/work/openmeld-feature",
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
			},
		] as const;
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: { ...discovery("found"), candidates },
			status: "ready",
		});
		connectCandidate
			.mockResolvedValueOnce({
				bindingGeneration: "binding-repository",
				canonicalPath: "/work/openmeld",
				isDefault: true,
				status: "connected",
			})
			.mockResolvedValueOnce({
				code: "path_conflict",
				conflictingProjectSlug: "client-app",
				conflictScope: "another_organization",
				message:
					"This folder is already connected to the “client-app” Project in another Organization.",
				moveConfirmationToken: "move-confirmation-1",
				moveImpact: "additional_connection",
				status: "rejected",
			})
			.mockResolvedValueOnce({
				bindingGeneration: "binding-worktree",
				canonicalPath: "/work/openmeld-feature",
				isDefault: false,
				status: "connected",
			});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		fireEvent.click(
			screen.getByRole("checkbox", { name: "/work/openmeld-feature" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect 2 folders" }));
		await screen.findByRole("heading", {
			name: "Move this folder to OpenMeld?",
		});

		expect(connectCandidate).toHaveBeenCalledTimes(2);
		expect(discoveryController.refresh).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Move folder" }));

		await waitFor(() => expect(connectCandidate).toHaveBeenCalledTimes(3));
		await waitFor(() =>
			expect(discoveryController.refresh).toHaveBeenCalledTimes(1)
		);
		expect(
			screen.queryByRole("heading", {
				name: "Move this folder to OpenMeld?",
			})
		).toBeNull();
	});

	it("rechecks and replaces stale move impact before accepting confirmation", async () => {
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("found"),
			status: "ready",
		});
		connectCandidate
			.mockResolvedValueOnce({
				code: "path_conflict",
				conflictingProjectSlug: "client-app",
				conflictScope: "another_organization",
				message: "path conflict",
				moveConfirmationToken: "move-confirmation-1",
				moveImpact: "only_connection",
				status: "rejected",
			})
			.mockRejectedValueOnce({
				code: "gateway.upstream_error",
				message: "connection changed",
				requestId: "request-2",
				status: 409,
				upstreamCode: "binding_generation_stale",
			})
			.mockResolvedValueOnce({
				code: "path_conflict",
				conflictingProjectSlug: "client-app",
				conflictScope: "another_organization",
				message: "path conflict",
				moveConfirmationToken: "move-confirmation-2",
				moveImpact: "default_connection",
				status: "rejected",
			});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		fireEvent.click(screen.getByRole("button", { name: "Connect 1 folder" }));
		await screen.findByText(
			"Agents using that Project on this computer won’t be able to start until another folder is connected."
		);
		fireEvent.click(screen.getByRole("button", { name: "Move folder" }));

		expect(
			await screen.findByText(
				"OpenMeld will make another connected folder the default for that Project."
			)
		).toBeTruthy();
		expect(connectCandidate).toHaveBeenCalledTimes(3);
		expect(connectCandidate.mock.calls[2]?.[0]).not.toHaveProperty(
			"moveConfirmationToken"
		);
		expect(
			screen.queryByText(
				"Agents using that Project on this computer won’t be able to start until another folder is connected."
			)
		).toBeNull();
	});

	it("closes a completed move confirmation when a later selected folder fails", async () => {
		const candidates = [
			{
				candidateId: "candidate-repository",
				candidateKind: "repository",
				canonicalPath: "/work/openmeld",
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
			},
			{
				candidateId: "candidate-worktree",
				candidateKind: "worktree",
				canonicalPath: "/work/openmeld-feature",
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
			},
		] as const;
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: { ...discovery("found"), candidates },
			status: "ready",
		});
		connectCandidate
			.mockResolvedValueOnce({
				code: "path_conflict",
				conflictingProjectSlug: "client-app",
				conflictScope: "another_organization",
				message:
					"This folder is already connected to the “client-app” Project in another Organization.",
				moveConfirmationToken: "move-confirmation-1",
				moveImpact: "additional_connection",
				status: "rejected",
			})
			.mockResolvedValueOnce({
				bindingGeneration: "binding-moved",
				canonicalPath: "/work/openmeld",
				isDefault: true,
				status: "connected",
			})
			.mockRejectedValueOnce({
				code: "gateway.upstream_error",
				message: "folder missing",
				requestId: "request-2",
				status: 409,
				upstreamCode: "path_not_found",
			});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		fireEvent.click(
			screen.getByRole("checkbox", { name: "/work/openmeld-feature" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect 2 folders" }));
		await screen.findByRole("heading", {
			name: "Move this folder to OpenMeld?",
		});

		fireEvent.click(screen.getByRole("button", { name: "Move folder" }));

		expect(
			await screen.findByText(
				"1 of 2 folders connected. OpenMeld couldn’t find that folder on this computer. Check the path and try again."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", {
				name: "Move this folder to OpenMeld?",
			})
		).toBeNull();
	});

	it("connects multiple selected folders in sequence and refreshes once", async () => {
		const candidates = [
			{
				candidateId: "candidate-repository",
				candidateKind: "repository",
				canonicalPath: "/work/openmeld",
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
			},
			{
				candidateId: "candidate-worktree",
				candidateKind: "worktree",
				canonicalPath: "/work/openmeld-feature",
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
			},
		] as const;
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: { ...discovery("found"), candidates },
			status: "ready",
		});
		const firstConnection = deferred<{
			bindingGeneration: string;
			canonicalPath: string;
			isDefault: boolean;
			status: "connected";
		}>();
		connectCandidate
			.mockImplementationOnce(async () => await firstConnection.promise)
			.mockResolvedValueOnce({
				bindingGeneration: "binding-worktree",
				canonicalPath: "/work/openmeld-feature",
				isDefault: false,
				status: "connected",
			});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		expect(screen.getAllByRole("checkbox")).toHaveLength(2);
		expect(screen.getByText("Worktree")).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		fireEvent.click(
			screen.getByRole("checkbox", { name: REPLACEMENT_PATH_PATTERN })
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect 2 folders" }));

		expect(connectCandidate).toHaveBeenCalledTimes(1);
		expect(connectCandidate).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				candidateId: "candidate-repository",
				candidatePath: "/work/openmeld",
				clientGeneration: 2,
			})
		);
		firstConnection.resolve({
			bindingGeneration: "binding-repository",
			canonicalPath: "/work/openmeld",
			isDefault: true,
			status: "connected",
		});

		await waitFor(() => expect(connectCandidate).toHaveBeenCalledTimes(2));
		expect(connectCandidate).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				candidateId: "candidate-worktree",
				candidatePath: "/work/openmeld-feature",
				clientGeneration: 2,
			})
		);
		await waitFor(() =>
			expect(discoveryController.refresh).toHaveBeenCalledTimes(1)
		);
	});

	it("drops selections from an earlier discovery result", () => {
		let currentDiscovery: LocalProjectControlProjectDiscovery = {
			...discovery("found"),
			candidates: [
				{
					candidateId: "candidate-old",
					candidateKind: "repository",
					canonicalPath: "/work/openmeld",
					repositoryFingerprint: `sha256:${"a".repeat(64)}`,
				},
			],
		};
		discoveryController.projectView.mockImplementation(() => ({
			connections: [],
			discovery: currentDiscovery,
			status: "ready",
		}));
		const rendered = render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "/work/openmeld" }));
		expect(
			screen.getByRole("button", { name: "Connect 1 folder" })
		).toBeTruthy();

		currentDiscovery = {
			...currentDiscovery,
			candidates: [
				{
					candidateId: "candidate-new",
					candidateKind: "worktree",
					canonicalPath: "/work/openmeld-feature",
					repositoryFingerprint: `sha256:${"a".repeat(64)}`,
				},
			],
		};
		rendered.rerender(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		const connectButton = screen.getByRole("button", {
			name: "Connect selected folders",
		}) as HTMLButtonElement;
		expect(connectButton.disabled).toBe(true);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "/work/openmeld-feature" })
		);
		expect(
			screen.getByRole("button", { name: "Connect 1 folder" })
		).toBeTruthy();
	});

	it("rejects an empty or relative folder path in the browser", async () => {
		discoveryController.projectView.mockReturnValue({
			connections: [],
			discovery: discovery("not_found"),
			status: "ready",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Connect folder" }));
		fireEvent.change(screen.getByLabelText("Folder path"), {
			target: { value: "work/openmeld" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Check and connect" }));

		expect(
			await screen.findByText("Enter the full folder path on this computer.")
		).toBeTruthy();
		expect(connectPath).not.toHaveBeenCalled();
	});

	it("adopts the server connection snapshot after changing the default", async () => {
		const currentConnections = [
			connection({
				bindingGeneration: "binding-default",
				isDefault: true,
				path: "/work/openmeld",
			}),
			connection({
				bindingGeneration: "binding-worktree",
				isDefault: false,
				path: "/work/openmeld-feature",
			}),
		];
		const responseConnections = [
			{ ...currentConnections[0], isDefault: false },
			{ ...currentConnections[1], isDefault: true },
		];
		discoveryController.projectView.mockReturnValue({
			connections: currentConnections,
			discovery: { ...discovery("connected"), connections: currentConnections },
			status: "ready",
		});
		setDefaultConnection.mockResolvedValueOnce({
			connections: responseConnections,
			status: "updated",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Make default" }));

		await waitFor(() =>
			expect(discoveryController.applyConnectionSnapshot).toHaveBeenCalledWith(
				"project-1",
				responseConnections
			)
		);
		expect(discoveryController.refresh).toHaveBeenCalledTimes(1);
	});

	it("requires and submits an atomic replacement when removing the default", async () => {
		const currentConnections = [
			connection({
				bindingGeneration: "binding-default",
				isDefault: true,
				path: "/work/openmeld",
			}),
			connection({
				bindingGeneration: "binding-replacement",
				path: "/work/openmeld-feature",
			}),
		];
		const responseConnections = [{ ...currentConnections[1], isDefault: true }];
		discoveryController.projectView.mockReturnValue({
			connections: currentConnections,
			discovery: { ...discovery("connected"), connections: currentConnections },
			status: "ready",
		});
		removeConnection.mockResolvedValueOnce({
			connections: responseConnections,
			status: "removed",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Remove connection",
			})[0] as HTMLElement
		);
		const confirm = screen
			.getAllByRole("button", {
				name: "Remove connection",
			})
			.at(-1) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		fireEvent.click(
			screen.getByRole("radio", { name: REPLACEMENT_PATH_PATTERN })
		);
		expect(confirm.disabled).toBe(false);
		fireEvent.click(confirm);

		await waitFor(() =>
			expect(removeConnection).toHaveBeenCalledWith(
				expect.objectContaining({
					bindingGeneration: "binding-default",
					replacementBindingGeneration: "binding-replacement",
				})
			)
		);
		expect(discoveryController.applyConnectionSnapshot).toHaveBeenCalledWith(
			"project-1",
			responseConnections
		);
	});

	it("blocks bulk missing cleanup until a healthy connection becomes default", () => {
		const currentConnections = [
			connection({
				bindingGeneration: "binding-missing-default",
				isDefault: true,
				path: "/work/missing-default",
				status: "missing",
			}),
			connection({
				bindingGeneration: "binding-missing",
				path: "/work/missing",
				status: "missing",
			}),
			connection({
				bindingGeneration: "binding-healthy",
				path: "/work/healthy",
			}),
		];
		discoveryController.projectView.mockReturnValue({
			connections: currentConnections,
			discovery: {
				...discovery("connected_folder_missing"),
				connections: currentConnections,
			},
			status: "ready",
		});
		render(
			<ProjectComputerSection
				organizationId="org-1"
				project={project()}
				projects={[project()]}
			/>
		);

		expect(
			screen.getByText(
				"Choose an available connected folder as the default before removing missing connections."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Remove missing connections" })
		).toBeNull();
	});
});

function connection(
	overrides: Partial<LocalProjectControlConnection>
): LocalProjectControlConnection {
	return {
		bindingGeneration: "binding-1",
		isDefault: false,
		path: "/work/openmeld",
		status: "available",
		...overrides,
	};
}

function discovery(
	status: LocalProjectControlProjectDiscovery["status"]
): LocalProjectControlProjectDiscovery {
	const connection = {
		bindingGeneration: "binding-1",
		isDefault: true,
		path: "/work/openmeld",
		status: status === "connected_folder_missing" ? "missing" : "available",
	} as const;
	const candidate = {
		candidateId: "candidate-1",
		candidateKind: "repository",
		canonicalPath: "/work/openmeld",
		repositoryFingerprint: `sha256:${"a".repeat(64)}`,
	} as const;
	return {
		candidates: status === "found" ? [candidate] : [],
		connections:
			status === "connected" || status === "connected_folder_missing"
				? [connection]
				: [],
		projectId: "project-1",
		status,
	} as LocalProjectControlProjectDiscovery;
}

function project(): Project {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: "project-1",
		name: "OpenMeld",
		organizationId: "org-1",
		repositoryFingerprint: null,
		repositoryUrl: null,
		slug: "openmeld",
		updatedAtMs: 1,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
