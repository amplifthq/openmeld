import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceFilesPanel } from "./space-files-panel";

const spaceApiMocks = vi.hoisted(() => ({
	createFolder: vi.fn(),
	downloadFileContent: vi.fn(),
	getFile: vi.fn(),
	listFileRevisions: vi.fn(),
	listFiles: vi.fn(),
	trashFileEntry: vi.fn(),
	updateFileContent: vi.fn(),
	updateFileEntry: vi.fn(),
	uploadFile: vi.fn(),
}));

vi.mock("#/lib/spaces/api", () => ({
	createOrganizationScopedWebSpaceApi: () => spaceApiMocks,
	createUnscopedWebSpaceApi: () => spaceApiMocks,
}));

const ACTOR = {
	profileId: "human-files-test",
	profileKind: "human" as const,
	displayName: "Mira Stone",
	ownerUserId: "owner-files-test",
};

const FILE = {
	id: "file-1",
	spaceId: "space-1",
	parentId: null,
	name: "launch-notes.md",
	path: "/launch-notes.md",
	kind: "file" as const,
	createdAt: "2026-08-22T08:00:00.000Z",
	updatedAt: "2026-08-22T08:00:00.000Z",
	createdBy: ACTOR,
	updatedBy: ACTOR,
	latestRevision: {
		id: "revision-1",
		fileId: "file-1",
		revision: 1,
		mimeType: "text/markdown",
		sizeBytes: 13,
		createdAt: "2026-08-22T08:00:00.000Z",
		createdBy: ACTOR,
	},
};

describe("SpaceFilesPanel", () => {
	afterEach(cleanup);

	beforeEach(() => {
		vi.clearAllMocks();
		spaceApiMocks.listFiles.mockResolvedValue({
			spaceId: "space-1",
			parentId: null,
			breadcrumbs: [{ id: null, name: "Files" }],
			entries: [FILE],
			capabilities: { canRead: true, canWrite: true },
		});
		spaceApiMocks.downloadFileContent.mockResolvedValue({
			bytes: new TextEncoder().encode("Launch notes\n").buffer,
			mimeType: "text/markdown",
			revision: 1,
		});
		spaceApiMocks.listFileRevisions.mockResolvedValue({
			file: FILE,
			revisions: [FILE.latestRevision],
		});
	});

	it("shows the Space-owned file system as view only to public visitors", async () => {
		renderPanel({ readOnly: true });

		expect(await screen.findByText("launch-notes.md")).toBeTruthy();
		expect(screen.getByText("View only")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "New" })).toBeNull();
		expect(
			screen.getByText("Shared with the people and agents in this Space.")
		).toBeTruthy();
	});

	it("lets an active member create a folder with the shared contract", async () => {
		spaceApiMocks.createFolder.mockResolvedValue({
			folder: {
				...FILE,
				id: "folder-1",
				name: "Research",
				path: "/Research",
				kind: "folder",
				latestRevision: undefined,
			},
		});
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "New" }));
		fireEvent.click(await screen.findByText("Folder"));
		fireEvent.change(screen.getByLabelText("Folder name"), {
			target: { value: "Research" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

		await waitFor(() =>
			expect(spaceApiMocks.createFolder).toHaveBeenCalledOnce()
		);
		expect(spaceApiMocks.createFolder).toHaveBeenCalledWith(
			expect.objectContaining({
				spaceId: "space-1",
				body: expect.objectContaining({ name: "Research", parentId: null }),
			})
		);
	});

	it("keeps a writer’s draft when another player saved a newer revision", async () => {
		spaceApiMocks.updateFileContent.mockRejectedValue(
			Object.assign(new Error("This file changed after you opened it."), {
				code: "space_file.conflict",
				status: 409,
			})
		);
		renderPanel();

		fireEvent.click(await screen.findByText("launch-notes.md"));
		const editor = await screen.findByLabelText("File contents");
		fireEvent.change(editor, { target: { value: "My unsaved revision" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(
			await screen.findByText("A newer version was saved by someone else.")
		).toBeTruthy();
		expect(
			(screen.getByLabelText("File contents") as HTMLTextAreaElement).value
		).toBe("My unsaved revision");
	});
});

function renderPanel(input?: { readOnly?: boolean }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<SpaceFilesPanel
				openMeldProfileId="human-files-test"
				organizationSlug="ampli-lift"
				readOnly={input?.readOnly}
				spaceId="space-1"
			/>
		</QueryClientProvider>
	);
}
