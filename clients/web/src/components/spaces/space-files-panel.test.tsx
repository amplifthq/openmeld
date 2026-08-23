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
	restoreFileEntry: vi.fn(),
	restoreFileRevision: vi.fn(),
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
	trashedAt: null,
	trashedBy: null,
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

const PLAIN_TEXT_FILE = {
	...FILE,
	latestRevision: {
		...FILE.latestRevision,
		mimeType: "text/plain",
	},
};

const IMAGE_FILE = {
	...FILE,
	id: "image-1",
	name: "launch-diagram.png",
	path: "/launch-diagram.png",
	latestRevision: {
		...FILE.latestRevision,
		fileId: "image-1",
		id: "image-revision-1",
		mimeType: "image/png",
		sizeBytes: 4,
	},
};

const FOLDER = {
	id: "folder-1",
	spaceId: "space-1",
	parentId: null,
	name: "Research",
	path: "/Research",
	kind: "folder" as const,
	createdAt: "2026-08-22T08:00:00.000Z",
	updatedAt: "2026-08-22T08:00:00.000Z",
	createdBy: ACTOR,
	updatedBy: ACTOR,
	trashedAt: null,
	trashedBy: null,
};

describe("SpaceFilesPanel", () => {
	afterEach(cleanup);

	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:space-file-preview"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
		spaceApiMocks.listFiles.mockResolvedValue({
			spaceId: "space-1",
			parentId: null,
			view: "active",
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

	it("opens Markdown files in the shared WYSIWYG editor", async () => {
		renderPanel();

		fireEvent.click(await screen.findByText("launch-notes.md"));

		const editor = await screen.findByLabelText("File contents");
		expect(editor.getAttribute("contenteditable")).toBe("true");
		expect(screen.getByRole("toolbar")).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("opens a linked chat image directly in the Space Files preview", async () => {
		spaceApiMocks.getFile.mockResolvedValue({ file: IMAGE_FILE });
		spaceApiMocks.downloadFileContent.mockResolvedValue({
			bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
			mimeType: "image/png",
			revision: 1,
		});
		spaceApiMocks.listFileRevisions.mockResolvedValue({
			file: IMAGE_FILE,
			revisions: [IMAGE_FILE.latestRevision],
		});

		renderPanel({ fileToOpen: { fileId: IMAGE_FILE.id, requestId: "open-1" } });

		expect(
			await screen.findByRole("img", { name: "launch-diagram.png" })
		).toBeTruthy();
		expect(spaceApiMocks.getFile).toHaveBeenCalledWith({
			fileId: "image-1",
			spaceId: "space-1",
		});
	});

	it("shows image thumbnails instead of generic file icons in Files", async () => {
		spaceApiMocks.listFiles.mockResolvedValue({
			spaceId: "space-1",
			parentId: null,
			view: "active",
			breadcrumbs: [{ id: null, name: "Files" }],
			entries: [IMAGE_FILE, FILE],
			capabilities: { canRead: true, canWrite: true },
		});
		spaceApiMocks.downloadFileContent.mockResolvedValue({
			bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer,
			mimeType: "image/png",
			revision: 1,
		});

		const view = renderPanel();

		await screen.findByText("launch-diagram.png");
		await waitFor(() => {
			expect(
				view.container.querySelector('[data-slot="space-file-image-thumbnail"]')
			).not.toBeNull();
		});
		expect(spaceApiMocks.downloadFileContent).toHaveBeenCalledWith(
			expect.objectContaining({
				fileId: "image-1",
				revision: 1,
				spaceId: "space-1",
			})
		);
	});

	it("uses the shared WYSIWYG editor when creating a Markdown file", async () => {
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "New" }));
		fireEvent.click(await screen.findByText("Markdown file"));

		expect(await screen.findByText("New Markdown file")).toBeTruthy();
		expect(
			screen.getByLabelText("File contents").getAttribute("contenteditable")
		).toBe("true");
		expect(screen.getByRole("toolbar")).toBeTruthy();
	});

	it("infers Markdown uploads through the shared file contract", async () => {
		spaceApiMocks.uploadFile.mockResolvedValue(FILE);
		const view = renderPanel();

		await screen.findByText("launch-notes.md");
		const upload = view.container.querySelector('input[type="file"]');
		expect(upload).not.toBeNull();
		const file = new File(["# Launch"], "brief.md", { type: "" });
		fireEvent.change(upload as HTMLInputElement, { target: { files: [file] } });

		await waitFor(() =>
			expect(spaceApiMocks.uploadFile).toHaveBeenCalledOnce()
		);
		expect(spaceApiMocks.uploadFile).toHaveBeenCalledWith(
			expect.objectContaining({
				mimeType: "text/markdown",
				name: "brief.md",
			})
		);
	});

	it("uploads files dropped anywhere on the Files surface", async () => {
		spaceApiMocks.uploadFile.mockResolvedValue(FILE);
		renderPanel();

		await screen.findByText("launch-notes.md");
		const surface = await screen.findByLabelText("Space files");
		const file = new File(["research"], "research.txt", {
			type: "text/plain",
		});
		fireEvent.dragEnter(surface, {
			dataTransfer: { files: [file], types: ["Files"] },
		});
		expect(screen.getByText("Drop files to upload")).toBeTruthy();
		fireEvent.drop(surface, {
			dataTransfer: { files: [file], types: ["Files"] },
		});

		await waitFor(() =>
			expect(spaceApiMocks.uploadFile).toHaveBeenCalledWith(
				expect.objectContaining({ name: "research.txt" })
			)
		);
	});

	it("keeps deleted entries in one recoverable Trash view", async () => {
		const trashedFile = {
			...FILE,
			trashedAt: "2026-08-23T09:30:00.000Z",
			trashedBy: ACTOR,
		};
		spaceApiMocks.listFiles.mockImplementation(
			async ({ query }: { query: { view?: "active" | "trash" } }) =>
				query.view === "trash"
					? {
							breadcrumbs: [
								{ id: null, name: "Files" },
								{ id: null, name: "Trash" },
							],
							capabilities: { canRead: true as const, canWrite: true },
							entries: [trashedFile],
							parentId: null,
							spaceId: "space-1",
							view: "trash" as const,
						}
					: {
							breadcrumbs: [{ id: null, name: "Files" }],
							capabilities: { canRead: true as const, canWrite: true },
							entries: [FILE],
							parentId: null,
							spaceId: "space-1",
							view: "active" as const,
						}
		);
		spaceApiMocks.restoreFileEntry.mockResolvedValue(FILE);
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "Trash" }));
		expect(await screen.findByText("Deleted by Mira Stone")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Restore launch-notes.md" })
		);

		await waitFor(() =>
			expect(spaceApiMocks.restoreFileEntry).toHaveBeenCalledWith(
				expect.objectContaining({ entryId: FILE.id, spaceId: "space-1" })
			)
		);
	});

	it("previews and restores an older version without erasing history", async () => {
		const currentFile = {
			...PLAIN_TEXT_FILE,
			latestRevision: {
				...PLAIN_TEXT_FILE.latestRevision,
				id: "revision-2",
				revision: 2,
			},
		};
		const firstRevision = {
			...PLAIN_TEXT_FILE.latestRevision,
			id: "revision-1",
			revision: 1,
		};
		spaceApiMocks.listFiles.mockResolvedValue({
			breadcrumbs: [{ id: null, name: "Files" }],
			capabilities: { canRead: true, canWrite: true },
			entries: [currentFile],
			parentId: null,
			spaceId: "space-1",
			view: "active",
		});
		spaceApiMocks.listFileRevisions.mockResolvedValue({
			file: currentFile,
			revisions: [currentFile.latestRevision, firstRevision],
		});
		spaceApiMocks.downloadFileContent.mockImplementation(
			async ({ revision }: { revision?: number }) => ({
				bytes: new TextEncoder().encode(
					revision === 1 ? "Original version" : "Current version"
				).buffer,
				mimeType: "text/plain",
				revision: revision ?? 2,
			})
		);
		spaceApiMocks.restoreFileRevision.mockResolvedValue({
			...currentFile,
			latestRevision: {
				...currentFile.latestRevision,
				id: "revision-3",
				revision: 3,
			},
		});
		renderPanel();

		fireEvent.click(await screen.findByText("launch-notes.md"));
		fireEvent.click(await screen.findByRole("button", { name: "History" }));
		expect(
			await screen.findByRole("heading", { name: "Version history" })
		).toBeTruthy();
		fireEvent.click(
			await screen.findByRole("button", { name: "Preview version 1" })
		);
		expect(await screen.findByText("Viewing version 1")).toBeTruthy();
		expect(
			(await screen.findByLabelText("File contents")).textContent
		).toContain("Original version");
		fireEvent.click(await screen.findByText("Restore this version"));

		await waitFor(() =>
			expect(spaceApiMocks.restoreFileRevision).toHaveBeenCalledWith(
				expect.objectContaining({
					baseRevision: 2,
					fileId: FILE.id,
					revision: 1,
					spaceId: "space-1",
				})
			)
		);
	});

	it("reopens the exact chat revision after returning to the current file", async () => {
		const currentFile = {
			...FILE,
			latestRevision: {
				...FILE.latestRevision,
				id: "revision-2",
				revision: 2,
			},
		};
		const firstRevision = {
			...FILE.latestRevision,
			id: "revision-1",
			revision: 1,
		};
		spaceApiMocks.getFile.mockResolvedValue({ file: currentFile });
		spaceApiMocks.listFileRevisions.mockResolvedValue({
			file: currentFile,
			revisions: [currentFile.latestRevision, firstRevision],
		});
		spaceApiMocks.downloadFileContent.mockImplementation(
			async ({ revision }: { revision?: number }) => ({
				bytes: new TextEncoder().encode(
					revision === 1 ? "Original version" : "Current version"
				).buffer,
				mimeType: "text/markdown",
				revision: revision ?? 2,
			})
		);
		const view = renderPanel({
			fileToOpen: { fileId: FILE.id, requestId: "open-1", revision: 1 },
		});

		expect(
			(await screen.findByLabelText("File contents")).textContent
		).toContain("Original version");
		fireEvent.click(screen.getByRole("button", { name: "Back to current" }));
		await waitFor(() =>
			expect(screen.getByLabelText("File contents").textContent).toContain(
				"Current version"
			)
		);

		view.rerenderPanel({
			fileToOpen: { fileId: FILE.id, requestId: "open-2", revision: 1 },
		});
		await waitFor(() =>
			expect(screen.getByLabelText("File contents").textContent).toContain(
				"Original version"
			)
		);
	});

	it("keeps a writer’s draft when another player saved a newer revision", async () => {
		spaceApiMocks.listFiles.mockResolvedValue({
			spaceId: "space-1",
			parentId: null,
			view: "active",
			breadcrumbs: [{ id: null, name: "Files" }],
			entries: [PLAIN_TEXT_FILE],
			capabilities: { canRead: true, canWrite: true },
		});
		spaceApiMocks.listFileRevisions.mockResolvedValue({
			file: PLAIN_TEXT_FILE,
			revisions: [PLAIN_TEXT_FILE.latestRevision],
		});
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

	it("protects an unsaved draft before returning to the file list", async () => {
		spaceApiMocks.listFiles.mockResolvedValue({
			spaceId: "space-1",
			parentId: null,
			view: "active",
			breadcrumbs: [{ id: null, name: "Files" }],
			entries: [PLAIN_TEXT_FILE],
			capabilities: { canRead: true, canWrite: true },
		});
		renderPanel();

		fireEvent.click(await screen.findByText("launch-notes.md"));
		fireEvent.change(await screen.findByLabelText("File contents"), {
			target: { value: "Keep this draft" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Back to files" }));

		expect(
			await screen.findByRole("heading", {
				name: "Save changes before leaving?",
			})
		).toBeTruthy();
		expect(screen.getByText("launch-notes.md")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
		expect(
			await screen.findByText(
				"Shared with the people and agents in this Space."
			)
		).toBeTruthy();
	});

	it("lets a member move a file to a visible Space folder", async () => {
		spaceApiMocks.listFiles.mockImplementation(
			async ({ query }: { query: { parentId: string | null } }) => ({
				spaceId: "space-1",
				parentId: query.parentId,
				view: "active" as const,
				breadcrumbs: [{ id: null, name: "Files" }],
				entries: query.parentId === null ? [FOLDER, FILE] : [],
				capabilities: { canRead: true, canWrite: true },
			})
		);
		spaceApiMocks.updateFileEntry.mockResolvedValue({
			...FILE,
			parentId: FOLDER.id,
			path: "/Research/launch-notes.md",
		});
		renderPanel();

		fireEvent.click(
			await screen.findByRole("button", { name: "Actions for launch-notes.md" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Move to folder…" }));
		const destination = await screen.findByLabelText("Destination folder");
		await waitFor(() =>
			expect(screen.getByRole("option", { name: "/Research" })).toBeTruthy()
		);
		fireEvent.change(destination, { target: { value: FOLDER.id } });
		fireEvent.click(screen.getByRole("button", { name: "Move" }));

		await waitFor(() =>
			expect(spaceApiMocks.updateFileEntry).toHaveBeenCalledOnce()
		);
		expect(spaceApiMocks.updateFileEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				entryId: FILE.id,
				spaceId: "space-1",
				body: expect.objectContaining({ parentId: FOLDER.id }),
			})
		);
	});
});

type RenderPanelInput = {
	fileToOpen?: { fileId: string; requestId: string; revision?: number };
	readOnly?: boolean;
};

function renderPanel(input?: RenderPanelInput) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const renderTree = (nextInput?: RenderPanelInput) => (
		<QueryClientProvider client={queryClient}>
			<SpaceFilesPanel
				fileToOpen={nextInput?.fileToOpen}
				openMeldProfileId="human-files-test"
				organizationSlug="ampli-lift"
				readOnly={nextInput?.readOnly}
				spaceId="space-1"
			/>
		</QueryClientProvider>
	);
	const result = render(renderTree(input));
	return {
		...result,
		rerenderPanel: (nextInput?: RenderPanelInput) =>
			result.rerender(renderTree(nextInput)),
	};
}
