import type { ComputerFileAccessPolicyResponse } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readComputerFileAccessPolicy,
	updateComputerFileAccessPolicy,
} from "#/lib/connect/computer-file-access";
import { selectLocalFolders } from "#/lib/connect/local-folder-picker";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { ComputerFileAccessCard } from "./computer-file-access-card";

const projectApi = vi.hoisted(() => ({
	discoverCurrentComputerProjects: vi.fn(),
	listCurrentProjects: vi.fn(),
	readLocalRuntimes: vi.fn(),
}));

vi.mock("#/lib/connect/computer-file-access", () => ({
	readComputerFileAccessPolicy: vi.fn(),
	updateComputerFileAccessPolicy: vi.fn(),
}));

vi.mock("#/lib/connect/local-folder-picker", () => ({
	selectLocalFolders: vi.fn(),
}));

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "owner-user-1" }),
}));

vi.mock("#/lib/connect/local-runtimes", () => ({
	readCurrentLocalRuntimeReplyReadiness: vi.fn(),
	readLocalRuntimes: projectApi.readLocalRuntimes,
}));

vi.mock(
	"#/lib/organizations/local-project-control",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/organizations/local-project-control")
		>()),
		discoverCurrentComputerProjects: projectApi.discoverCurrentComputerProjects,
	})
);

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-1", name: "Acme", slug: "acme" },
	}),
}));

vi.mock("#/lib/organizations/projects", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/organizations/projects")>()),
	listCurrentProjects: projectApi.listCurrentProjects,
}));

const DEFAULT_POLICY: ComputerFileAccessPolicyResponse = {
	deviceId: "device-office",
	policy: {
		mode: "local_agent_settings",
		revision: 1,
		updatedAtMs: 1_700_000_000_000,
	},
};

describe("ComputerFileAccessCard", () => {
	beforeEach(() => {
		vi.mocked(readComputerFileAccessPolicy).mockResolvedValue(DEFAULT_POLICY);
		projectApi.listCurrentProjects.mockResolvedValue({
			organizationId: "org-1",
			projects: [],
		});
		projectApi.readLocalRuntimes.mockResolvedValue(currentLocalRuntimes());
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the existing local-agent behavior as the default", async () => {
		renderCard();

		expect(
			await screen.findByRole("heading", { name: "File access" })
		).toBeTruthy();
		expect(
			(
				await screen.findByRole("radio", {
					name: "Use each local agent’s settings",
				})
			).getAttribute("aria-checked")
		).toBe("true");
		expect(
			screen.getByText(
				"This applies only to runs started by OpenMeld. Your direct use of local agents is unchanged."
			)
		).toBeTruthy();
		expect(screen.queryByLabelText("Folder 1")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")
		).toBe(true);
	});

	it("requires an absolute folder path before saving a selected-folder mode", async () => {
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);
		expect(screen.queryByLabelText("Folder 1")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Add from Projects" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Enter a folder path" })
		);
		fireEvent.change(screen.getByLabelText("Folder 1"), {
			target: { value: "Documents" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(
			await screen.findByText("Enter the full folder path on this computer.")
		).toBeTruthy();
		expect(updateComputerFileAccessPolicy).not.toHaveBeenCalled();
	});

	it("uses the Computer picker as the easiest way to add folder paths", async () => {
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-office",
			paths: ["/Users/felix/Design Work"],
			status: "selected",
		});
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Choose folders on this computer" })
		);

		expect(
			await screen.findByDisplayValue("/Users/felix/Design Work")
		).toBeTruthy();
		expect(updateComputerFileAccessPolicy).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
	});

	it("rejects a blank folder path without normalizing the draft", async () => {
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Enter a folder path" })
		);
		fireEvent.change(screen.getByLabelText("Folder 1"), {
			target: { value: "   " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(
			await screen.findByText("Enter the full folder path on this computer.")
		).toBeTruthy();
		expect(updateComputerFileAccessPolicy).not.toHaveBeenCalled();
	});

	it("keeps an edited folder row stable when an earlier row is removed", async () => {
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Enter a folder path" })
		);
		fireEvent.change(screen.getByLabelText("Folder 1"), {
			target: { value: "/Users/felix/First" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Enter another folder path" })
		);
		const secondFolder = screen.getByLabelText("Folder 2");
		fireEvent.change(secondFolder, {
			target: { value: "/Users/felix/Second" },
		});
		secondFolder.focus();

		fireEvent.click(screen.getByRole("button", { name: "Remove folder 1" }));

		expect(screen.getByLabelText("Folder 1")).toBe(secondFolder);
		expect(document.activeElement).toBe(secondFolder);
		expect((secondFolder as HTMLInputElement).value).toBe(
			"/Users/felix/Second"
		);
	});

	it("saves a Computer-wide whitelist only after explicit confirmation", async () => {
		vi.mocked(updateComputerFileAccessPolicy).mockResolvedValueOnce({
			deviceId: "device-office",
			policy: {
				folders: ["/Users/felix/Desktop/work"],
				mode: "only_selected_folders",
				revision: 2,
				updatedAtMs: 1_700_000_100_000,
			},
		});
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Enter a folder path" })
		);
		fireEvent.change(screen.getByLabelText("Folder 1"), {
			target: { value: "/Users/felix/Desktop/work" },
		});
		expect(updateComputerFileAccessPolicy).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(updateComputerFileAccessPolicy).toHaveBeenCalledWith({
				deviceId: "device-office",
				runtimeLane: "dev-local",
				expectedRevision: 1,
				idempotencyKey: expect.any(String),
				policy: {
					folders: ["/Users/felix/Desktop/work"],
					mode: "only_selected_folders",
				},
			})
		);
		expect(
			screen.getByRole("button", { name: "Saved" }).hasAttribute("disabled")
		).toBe(true);
	});

	it("preserves a valid trailing space in a manually entered folder path", async () => {
		const folder = "/Users/felix/Private ";
		vi.mocked(updateComputerFileAccessPolicy).mockResolvedValueOnce({
			deviceId: "device-office",
			policy: {
				folders: [folder],
				mode: "only_selected_folders",
				revision: 2,
				updatedAtMs: 1_700_000_100_000,
			},
		});
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Enter a folder path" })
		);
		fireEvent.change(screen.getByLabelText("Folder 1"), {
			target: { value: folder },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(updateComputerFileAccessPolicy).toHaveBeenCalledWith({
				deviceId: "device-office",
				runtimeLane: "dev-local",
				expectedRevision: 1,
				idempotencyKey: expect.any(String),
				policy: {
					folders: [folder],
					mode: "only_selected_folders",
				},
			})
		);
	});

	it("adds folders already found through Projects without asking for paths", async () => {
		projectApi.listCurrentProjects.mockResolvedValueOnce({
			organizationId: "org-1",
			projects: [
				project("project-openmeld", "OpenMeld"),
				project("project-reply", "Reply"),
			],
		});
		projectApi.discoverCurrentComputerProjects.mockResolvedValueOnce({
			checkedAtMs: 1_700_000_000_000,
			clientGeneration: 1,
			deviceId: "device-office",
			gitStatus: "available",
			projects: [
				{
					candidates: [],
					connections: [
						{
							bindingGeneration: "binding-1",
							isDefault: true,
							path: "/Users/felix/Desktop/work/openmeld",
							status: "available",
						},
					],
					projectId: "project-openmeld",
					status: "connected",
				},
				{
					candidates: [
						{
							candidateId: "candidate-reply",
							candidateKind: "repository",
							canonicalPath: "/Users/felix/Desktop/work/reply",
							repositoryFingerprint: `sha256:${"a".repeat(64)}`,
						},
					],
					connections: [],
					projectId: "project-reply",
					status: "found",
				},
			],
			requestId: "request-1",
		});
		vi.mocked(updateComputerFileAccessPolicy).mockResolvedValueOnce({
			deviceId: "device-office",
			policy: {
				folders: [
					"/Users/felix/Desktop/work/openmeld",
					"/Users/felix/Desktop/work/reply",
				],
				mode: "only_selected_folders",
				revision: 2,
				updatedAtMs: 1_700_000_100_000,
			},
		});
		renderCard();
		fireEvent.click(
			await screen.findByRole("radio", { name: "Only selected folders" })
		);

		expect(projectApi.listCurrentProjects).not.toHaveBeenCalled();
		expect(projectApi.readLocalRuntimes).not.toHaveBeenCalled();
		expect(projectApi.discoverCurrentComputerProjects).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Add from Projects" }));
		expect(
			await screen.findByRole("dialog", { name: "Add folders from Projects" })
		).toBeTruthy();
		fireEvent.click(
			await screen.findByRole("checkbox", {
				name: "/Users/felix/Desktop/work/openmeld",
			})
		);
		fireEvent.click(
			await screen.findByRole("checkbox", {
				name: "/Users/felix/Desktop/work/reply",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Add 2 folders" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(updateComputerFileAccessPolicy).toHaveBeenCalledWith({
				deviceId: "device-office",
				runtimeLane: "dev-local",
				expectedRevision: 1,
				idempotencyKey: expect.any(String),
				policy: {
					folders: [
						"/Users/felix/Desktop/work/openmeld",
						"/Users/felix/Desktop/work/reply",
					],
					mode: "only_selected_folders",
				},
			})
		);
	});

	it("explains that an unverifiable boundary pauses only the affected run", async () => {
		renderCard();

		expect(
			await screen.findByText(
				"If OpenMeld can’t verify this boundary for a local agent, it will pause only that run and ask you."
			)
		).toBeTruthy();
	});

	it("focuses the card after a Privacy & Safety deep link", async () => {
		const onFocusConsumed = vi.fn();
		const scrollIntoView = vi.fn();
		HTMLElement.prototype.scrollIntoView = scrollIntoView;

		renderCard({ focusFileAccess: true, onFocusConsumed });

		const heading = await screen.findByRole("heading", { name: "File access" });
		await waitFor(() => expect(onFocusConsumed).toHaveBeenCalledOnce());
		expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
		expect(document.activeElement).toBe(heading);
	});
});

function renderCard(
	input: { focusFileAccess?: boolean; onFocusConsumed?: () => void } = {}
) {
	return render(
		<TestQueryClientProvider>
			<ComputerFileAccessCard
				canChooseFolders
				canChooseProjects
				deviceId="device-office"
				focusFileAccess={input.focusFileAccess ?? false}
				onFocusConsumed={input.onFocusConsumed}
				runtimeLane="dev-local"
				storageScope="owner-user-1"
			/>
		</TestQueryClientProvider>
	);
}

function currentLocalRuntimes() {
	return {
		currentDeviceId: "device-office",
		currentRuntimeLane: "dev-local",
		localRuntimes: [
			{
				connectionStatus: "connected",
				deviceId: "device-office",
				executionTargets: [
					{
						capabilities: [],
						deviceId: "device-office",
						isCurrent: true,
						localProjectControl: {
							connectCandidate: true,
							connectDeclaredPath: true,
							discoverProjects: true,
							removeConnection: true,
							removeMissingConnections: true,
							setDefaultConnection: true,
						},
						runtimeLane: "dev-local",
						status: "ready",
					},
				],
			},
		],
	};
}

function project(id: string, name: string) {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1_700_000_000_000,
		createdByUserId: "owner-user-1",
		id,
		name,
		organizationId: "org-1",
		repositoryFingerprint: null,
		repositoryUrl: null,
		slug: id,
		updatedAtMs: 1_700_000_000_000,
	};
}
