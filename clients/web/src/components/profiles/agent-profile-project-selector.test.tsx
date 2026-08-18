import type { Project } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectLocalFolders } from "#/lib/connect/local-folder-picker";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";

const RECOMMENDED_COPY_PATTERN = /Recommended/u;

const { connectCandidate, connectPath, discoveryController } = vi.hoisted(
	() => ({
		connectCandidate: vi.fn(),
		connectPath: vi.fn(),
		discoveryController: {
			applyConnectionSnapshot: vi.fn(),
			claimMutationGeneration: vi.fn(() => 2),
			computer: {
				deviceDisplayName: "Felix’s Mac",
				deviceId: "device-current",
				localFolderPicker: { selectFolders: true },
			},
			projectView: vi.fn(() => ({
				connections: [],
				discovery: {
					candidates: [
						{
							candidateId: "candidate-1",
							candidateKind: "repository",
							canonicalPath: "/work/openmeld",
							repositoryFingerprint: `sha256:${"a".repeat(64)}`,
						},
					],
					connections: [],
					projectId: "project-1",
					status: "found",
				},
				errorMessage: null,
				status: "ready",
			})),
			refresh: vi.fn(),
		},
	})
);

vi.mock("#/components/projects/use-project-discovery", () => ({
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
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	discoveryController.projectView.mockImplementation(() => ({
		connections: [],
		discovery: {
			candidates: [
				{
					candidateId: "candidate-1",
					candidateKind: "repository",
					canonicalPath: "/work/openmeld",
					repositoryFingerprint: `sha256:${"a".repeat(64)}`,
				},
			],
			connections: [],
			projectId: "project-1",
			status: "found",
		},
		errorMessage: null,
		status: "ready",
	}));
});

describe("AgentProfileProjectSelector folder moves", () => {
	it("puts Project paths first in one Working folder selector", async () => {
		discoveryController.projectView.mockReturnValue({
			connections: [
				{
					bindingGeneration: "binding-openmeld",
					isDefault: true,
					path: "/Users/felix/Desktop/work/openmeld",
					status: "available",
				},
			],
			discovery: null,
			errorMessage: null,
			status: "ready",
		});
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={vi.fn()}
				onManualPathChange={vi.fn()}
				onProjectChange={vi.fn()}
				onUseAdvancedWorkspace={vi.fn()}
				onUseManagedWorkspace={vi.fn()}
				organizationId="org-1"
				projectId=""
				projects={[project()]}
				selectedBindingGeneration={null}
				workspaceFallbackMode="managed"
			/>
		);

		fireEvent.click(screen.getByRole("combobox", { name: "Working folder" }));
		const options = within(await screen.findByRole("listbox")).getAllByRole(
			"option"
		);

		expect(options.map((option) => option.textContent)).toEqual([
			"OpenMeld/Users/felix/Desktop/work/openmeld",
			"Let OpenMeld choose",
			"Choose a folder on this computer…",
		]);
		expect(screen.queryByText(RECOMMENDED_COPY_PATTERN)).toBeNull();
	});

	it("contains long Project paths inside the selector instead of widening the form", () => {
		const longPath =
			"/workspace/projects/a-deliberately-long-project-folder-that-must-scroll-inside-the-control";
		discoveryController.projectView.mockReturnValue({
			connections: [
				{
					bindingGeneration: "binding-openmeld",
					isDefault: true,
					path: longPath,
					status: "available",
				},
			],
			discovery: null,
			errorMessage: null,
			status: "ready",
		});
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={vi.fn()}
				onManualPathChange={vi.fn()}
				onProjectChange={vi.fn()}
				onUseAdvancedWorkspace={vi.fn()}
				onUseManagedWorkspace={vi.fn()}
				organizationId="org-1"
				projectId="project-1"
				projects={[project()]}
				selectedBindingGeneration={null}
				workspaceFallbackMode={null}
			/>
		);

		expect(
			screen.getByTestId("agent-profile-project-selector").className
		).toContain("min-w-0");
		expect(
			screen.getByTestId("working-folder-display-value").className
		).toContain("overflow-x-auto");
		expect(
			screen.getByTestId("default-working-folder-path").className
		).toContain("overflow-x-auto");
	});

	it("fills a Project working folder from the native picker before connecting it", async () => {
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-current",
			paths: ["/Users/felix/Design Work "],
			status: "selected",
		});
		connectPath.mockResolvedValue({
			bindingGeneration: "binding-picked",
			canonicalPath: "/Users/felix/Design Work ",
			isDefault: true,
			status: "connected",
		});
		const onConnectionReady = vi.fn();
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={onConnectionReady}
				onManualPathChange={vi.fn()}
				onProjectChange={vi.fn()}
				organizationId="org-1"
				projectId="project-1"
				projects={[project()]}
				selectedBindingGeneration={null}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Choose a Project folder on this computer",
			})
		);
		await waitFor(() =>
			expect(
				screen.getByTestId("agent-profile-project-selector").textContent
			).toContain("/Users/felix/Design Work ")
		);
		expect(selectLocalFolders).toHaveBeenCalledWith(
			expect.objectContaining({ purpose: "project_connection" })
		);
		expect(connectPath).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Connect" }));
		await waitFor(() =>
			expect(connectPath).toHaveBeenCalledWith(
				expect.objectContaining({
					declaredPath: "/Users/felix/Design Work ",
				})
			)
		);
		await waitFor(() =>
			expect(onConnectionReady).toHaveBeenCalledWith({
				bindingGeneration: "binding-picked",
				isDefault: true,
				path: "/Users/felix/Design Work ",
				status: "available",
			})
		);
	});

	it("lets a profile choose a custom working folder without selecting a Project", async () => {
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-current",
			paths: ["/Users/felix/Private Workspace"],
			status: "selected",
		});
		const onManualPathChange = vi.fn();
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={vi.fn()}
				onManualPathChange={onManualPathChange}
				onProjectChange={vi.fn()}
				onUseAdvancedWorkspace={vi.fn()}
				onUseManagedWorkspace={vi.fn()}
				organizationId="org-1"
				projectId=""
				projects={[project()]}
				selectedBindingGeneration={null}
				workspaceFallbackMode="advanced"
			/>
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Choose folder on this computer",
			})
		);

		await waitFor(() =>
			expect(onManualPathChange).toHaveBeenCalledWith(
				"/Users/felix/Private Workspace"
			)
		);
		expect(selectLocalFolders).toHaveBeenCalledWith(
			expect.objectContaining({ purpose: "agent_profile_working_folder" })
		);
	});

	it("fills an advanced workspace draft from the native picker", async () => {
		discoveryController.projectView.mockReturnValueOnce({
			connections: [],
			discovery: {
				candidates: [],
				connections: [],
				projectId: "project-1",
				status: "not_found",
			},
			errorMessage: null,
			status: "ready",
		});
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-current",
			paths: ["/Users/felix/Private Workspace"],
			status: "selected",
		});
		const onManualPathChange = vi.fn();
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={vi.fn()}
				onManualPathChange={onManualPathChange}
				onProjectChange={vi.fn()}
				onUseAdvancedWorkspace={vi.fn()}
				onUseManagedWorkspace={vi.fn()}
				organizationId="org-1"
				projectId="project-1"
				projects={[project()]}
				selectedBindingGeneration={null}
				workspaceFallbackMode="advanced"
			/>
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Choose folder on this computer",
			})
		);

		await waitFor(() =>
			expect(onManualPathChange).toHaveBeenCalledWith(
				"/Users/felix/Private Workspace"
			)
		);
	});

	it("requires the same explained confirmation before moving a candidate", async () => {
		const onConnectionReady = vi.fn();
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
			.mockResolvedValueOnce({
				bindingGeneration: "binding-moved",
				canonicalPath: "/work/openmeld",
				isDefault: true,
				status: "connected",
			});
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={onConnectionReady}
				onManualPathChange={vi.fn()}
				onProjectChange={vi.fn()}
				organizationId="org-1"
				projectId="project-1"
				projects={[project()]}
				selectedBindingGeneration={null}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Connect and continue" })
		);
		expect(
			await screen.findByRole("heading", {
				name: "Move this folder to OpenMeld?",
			})
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
			expect(onConnectionReady).toHaveBeenCalledWith({
				bindingGeneration: "binding-moved",
				isDefault: true,
				path: "/work/openmeld",
				status: "available",
			})
		);
	});

	it("rechecks stale move impact before showing a new confirmation", async () => {
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
				moveImpact: "additional_connection",
				status: "rejected",
			});
		render(
			<AgentProfileProjectSelector
				disabled={false}
				manualPath=""
				onConnectionReady={vi.fn()}
				onManualPathChange={vi.fn()}
				onProjectChange={vi.fn()}
				organizationId="org-1"
				projectId="project-1"
				projects={[project()]}
				selectedBindingGeneration={null}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Connect and continue" })
		);
		await screen.findByText(
			"Agents using that Project on this computer won’t be able to start until another folder is connected."
		);
		fireEvent.click(screen.getByRole("button", { name: "Move folder" }));

		expect(
			await screen.findByText("That Project’s default folder won’t change.")
		).toBeTruthy();
		expect(connectCandidate).toHaveBeenCalledTimes(3);
		expect(connectCandidate.mock.calls[2]?.[0]).not.toHaveProperty(
			"moveConfirmationToken"
		);
	});
});

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
