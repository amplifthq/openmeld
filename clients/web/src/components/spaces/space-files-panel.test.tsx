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

const PLAIN_TEXT_FILE = {
	...FILE,
	latestRevision: {
		...FILE.latestRevision,
		mimeType: "text/plain",
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
		renderPanel();

		const upload = await screen.findByLabelText("Upload files");
		const file = new File(["# Launch"], "brief.md", { type: "" });
		fireEvent.change(upload, { target: { files: [file] } });

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

	it("keeps a writer’s draft when another player saved a newer revision", async () => {
		spaceApiMocks.listFiles.mockResolvedValue({
			spaceId: "space-1",
			parentId: null,
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
