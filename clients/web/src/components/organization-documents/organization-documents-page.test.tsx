import type { QueryClient } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationDocumentQueryKeys } from "#/query/organizations/organization-documents";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OrganizationDocumentsPage } from "./organization-documents-page";

const listCurrentOrganizationDocumentsMock = vi.hoisted(() => vi.fn());
const createCurrentOrganizationDocumentFolderMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationDirectoryMock = vi.hoisted(() => vi.fn());
const NEW_DOCUMENT_LINK_NAME = /New document/;
const NEW_FOLDER_BUTTON_NAME = /New folder/;
const FOLDER_ACTIONS_BUTTON_NAME = /Folder actions/;
const DOCUMENT_ACTIONS_BUTTON_NAME = /Document actions/;

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
	}),
}));

vi.mock(
	"#/lib/organizations/organization-documents",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("#/lib/organizations/organization-documents")
			>();
		return {
			...original,
			createCurrentOrganizationDocumentFolder:
				createCurrentOrganizationDocumentFolderMock,
			listCurrentOrganizationDocuments: listCurrentOrganizationDocumentsMock,
		};
	}
);

vi.mock(
	"#/lib/organizations/organization-directory",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("#/lib/organizations/organization-directory")
			>();
		return {
			...original,
			readCurrentOrganizationDirectory: readCurrentOrganizationDirectoryMock,
		};
	}
);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("OrganizationDocumentsPage", () => {
	it("keeps the saved document list visible when a background refresh fails", async () => {
		const queryClient = createTestQueryClient();
		const cachedDocuments = listResponse();
		const queryKey = organizationDocumentQueryKeys.list("org-acme");
		queryClient.setQueryData(queryKey, cachedDocuments);
		listCurrentOrganizationDocumentsMock.mockRejectedValue(
			new Error("documents refresh failed")
		);
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-07-15T00:00:00.000Z",
			members: [],
			organizationId: "org-acme",
		});

		renderPage(undefined, queryClient);

		expect(
			await screen.findByRole("list", { name: "Documents and folders" })
		).toBeTruthy();
		await act(async () => {
			await queryClient.invalidateQueries({ queryKey });
		});

		expect(
			await screen.findByText(
				"Couldn't refresh Documents. Showing the last saved view from this browser."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("list", { name: "Documents and folders" })
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("uses the shared rounded empty-state surface and icon container", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue(
			listResponse({ documents: [], folders: [] })
		);
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-07-15T00:00:00.000Z",
			members: [],
			organizationId: "org-acme",
		});

		renderPage();

		const heading = await screen.findByRole("heading", {
			name: "No documents yet",
		});
		const emptyState = heading.closest("section");
		expect(emptyState?.className).toContain("rounded-md");
		expect(emptyState?.className).toContain("bg-card/25");
		expect(emptyState?.querySelector(".rounded-md")).toBeTruthy();
	});

	it("renders files in the shared icon-card grid with the brief first, member attribution, and draft state", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: true,
			currentUserId: "user-owner",
			documents: [
				summary({
					hasDraft: true,
					id: "brief-1",
					kind: "brief",
					title: "Organization Brief",
				}),
				summary({
					id: "profile-1",
					kind: "member_profile",
					subjectUserId: "user-ada",
					title: "Ada Lovelace Profile Report",
				}),
				summary({ id: "knowledge-1", title: "Support Runbook" }),
			],
			folders: [],
			organizationId: "org-acme",
		});
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-07-15T00:00:00.000Z",
			members: [
				{
					humanProfile: null,
					memberId: "member-ada",
					role: "member",
					user: {
						id: "user-ada",
						email: "ada@example.com",
						name: "Ada Lovelace",
					},
				},
			],
			organizationId: "org-acme",
		});
		renderPage();

		const list = await screen.findByRole("list", {
			name: "Documents and folders",
		});
		const rows = within(list).getAllByRole("listitem");
		expect(rows).toHaveLength(3);
		expect(
			within(rows[0] as HTMLElement).getByText("Organization Brief")
		).toBeTruthy();
		expect(within(rows[0] as HTMLElement).getByText("Brief")).toBeTruthy();
		expect(within(rows[0] as HTMLElement).getByText("Draft")).toBeTruthy();
		expect(
			within(rows[1] as HTMLElement).getByText("Profile Report · Ada Lovelace")
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: NEW_DOCUMENT_LINK_NAME })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Shared with Center Agent" })
		).toBeTruthy();
		expect(screen.getByText("Stays in sync")).toBeTruthy();
		expect(document.querySelectorAll("[data-fluid-card-group]")).toHaveLength(
			1
		);
		expect(document.querySelectorAll("[data-fluid-card-item]")).toHaveLength(3);
		expect(rows[0]?.querySelector("a")?.className).toContain("min-h-40");
	});

	it("shows folders and files together and browses nested folders with a full breadcrumb", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue(listResponse());
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-07-15T00:00:00.000Z",
			members: [],
			organizationId: "org-acme",
		});
		renderPage();

		const rootItems = await screen.findByRole("list", {
			name: "Documents and folders",
		});
		expect(within(rootItems).getByText("Runbooks")).toBeTruthy();
		expect(within(rootItems).getByText("2 items")).toBeTruthy();
		expect(within(rootItems).getByText("Root doc")).toBeTruthy();
		expect(within(rootItems).queryByText("Production")).toBeNull();
		expect(within(rootItems).queryByText("Folder doc")).toBeNull();

		cleanup();
		renderPage("folder-1");
		const folderView = await screen.findByRole("list", {
			name: "Documents and folders",
		});
		expect(within(folderView).getByText("Production")).toBeTruthy();
		expect(within(folderView).getByText("Folder doc")).toBeTruthy();
		expect(within(folderView).queryByText("Root doc")).toBeNull();

		cleanup();
		renderPage("folder-2");
		const nestedView = await screen.findByRole("list", {
			name: "Documents and folders",
		});
		expect(within(nestedView).getByText("Nested doc")).toBeTruthy();
		const breadcrumb = screen.getByRole("navigation", { name: "Folder path" });
		expect(
			within(breadcrumb).getByRole("link", { name: "Documents" })
		).toBeTruthy();
		expect(
			within(breadcrumb).getByRole("link", { name: "Runbooks" })
		).toBeTruthy();
		expect(within(breadcrumb).getByText("Production")).toBeTruthy();
	});

	it("creates a new folder inside the folder being viewed", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue(listResponse());
		createCurrentOrganizationDocumentFolderMock.mockResolvedValue({
			folder: {
				createdAt: "2026-07-16T00:00:00.000Z",
				id: "folder-new",
				name: "Checklists",
				organizationId: "org-acme",
				parentFolderId: "folder-1",
				updatedAt: "2026-07-16T00:00:00.000Z",
			},
		});
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-07-15T00:00:00.000Z",
			members: [],
			organizationId: "org-acme",
		});
		renderPage("folder-1");

		fireEvent.click(
			await screen.findByRole("button", { name: NEW_FOLDER_BUTTON_NAME })
		);
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Checklists" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

		await waitFor(() => {
			expect(createCurrentOrganizationDocumentFolderMock).toHaveBeenCalledWith({
				expectedOrganizationId: "org-acme",
				name: "Checklists",
				parentFolderId: "folder-1",
			});
		});
	});

	it("hides folder and document management from members", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue(
			listResponse({ canManage: false })
		);
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-07-15T00:00:00.000Z",
			members: [],
			organizationId: "org-acme",
		});
		renderPage();

		await screen.findByRole("list", { name: "Documents and folders" });
		expect(
			screen.queryByRole("button", { name: NEW_FOLDER_BUTTON_NAME })
		).toBeNull();
		expect(
			screen.queryByRole("link", { name: NEW_DOCUMENT_LINK_NAME })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: FOLDER_ACTIONS_BUTTON_NAME })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: DOCUMENT_ACTIONS_BUTTON_NAME })
		).toBeNull();
	});
});

function listResponse(overrides: Record<string, unknown> = {}) {
	return {
		canManage: true,
		currentUserId: "user-owner",
		documents: [
			summary({ id: "root-doc", title: "Root doc" }),
			summary({
				folderId: "folder-1",
				id: "folder-doc",
				title: "Folder doc",
			}),
			summary({
				folderId: "folder-2",
				id: "nested-doc",
				title: "Nested doc",
			}),
		],
		folders: [
			{
				createdAt: "2026-07-14T00:00:00.000Z",
				id: "folder-1",
				name: "Runbooks",
				organizationId: "org-acme",
				parentFolderId: null,
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
			{
				createdAt: "2026-07-14T00:00:00.000Z",
				id: "folder-2",
				name: "Production",
				organizationId: "org-acme",
				parentFolderId: "folder-1",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
		],
		organizationId: "org-acme",
		...overrides,
	};
}

function summary(overrides: Record<string, unknown> = {}) {
	return {
		canEditContent: true,
		canManage: true,
		createdAt: "2026-07-15T00:00:00.000Z",
		folderId: null,
		hasDraft: false,
		id: "knowledge-1",
		kind: "knowledge" as const,
		organizationId: "org-acme",
		subjectUserId: null,
		title: "Knowledge",
		updatedAt: "2026-07-15T00:00:00.000Z",
		...overrides,
	};
}

function renderPage(folderId?: string, queryClient?: QueryClient) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		component: () => <OrganizationDocumentsPage folderId={folderId} />,
		getParentRoute: () => rootRoute,
		path: "/o/$orgSlug/documents",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/o/acme/documents"] }),
		routeTree: rootRoute.addChildren([route]),
	});
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<RouterProvider router={router} />
		</TestQueryClientProvider>
	);
}
