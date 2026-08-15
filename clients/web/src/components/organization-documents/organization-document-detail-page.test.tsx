import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationDocumentDetailPage } from "./organization-document-detail-page";

const getCurrentOrganizationDocumentMock = vi.hoisted(() => vi.fn());
const approveCurrentOrganizationDocumentDraftMock = vi.hoisted(() => vi.fn());
const discardCurrentOrganizationDocumentDraftMock = vi.hoisted(() => vi.fn());
const updateCurrentOrganizationDocumentMock = vi.hoisted(() => vi.fn());
const deleteCurrentOrganizationDocumentMock = vi.hoisted(() => vi.fn());
const APPROVE_DRAFT_BUTTON_NAME = /Approve draft/;

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

// The Plate editor's own behavior (Markdown round-trip, toolbars) is covered
// in src/components/editor/document-editor-markdown.test.ts. Page tests stub
// it with a textarea so they exercise the page's draft/save orchestration.
vi.mock("./organization-document-markdown-editor", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("./organization-document-markdown-editor")
		>();
	return {
		...original,
		OrganizationDocumentMarkdownEditor: (input: {
			ariaLabel?: string;
			disabled?: boolean;
			onChange: (value: string) => void;
			value: string;
		}) => (
			<textarea
				aria-label={input.ariaLabel ?? "Document content"}
				disabled={input.disabled}
				onChange={(event) => input.onChange(event.target.value)}
				value={input.value}
			/>
		),
	};
});

vi.mock(
	"#/lib/organizations/organization-documents",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("#/lib/organizations/organization-documents")
			>();
		return {
			...original,
			approveCurrentOrganizationDocumentDraft:
				approveCurrentOrganizationDocumentDraftMock,
			deleteCurrentOrganizationDocument: deleteCurrentOrganizationDocumentMock,
			discardCurrentOrganizationDocumentDraft:
				discardCurrentOrganizationDocumentDraftMock,
			getCurrentOrganizationDocument: getCurrentOrganizationDocumentMock,
			updateCurrentOrganizationDocument: updateCurrentOrganizationDocumentMock,
		};
	}
);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("OrganizationDocumentDetailPage", () => {
	it("keeps approved content unchanged until the user approves the Center Agent draft", async () => {
		const pending = response({
			content: "Published content",
			draftContent: "Proposed content",
			draftCreatedAt: "2026-07-15T01:00:00.000Z",
			draftCreatedBy: "center_agent",
		});
		const approved = response({ content: "Proposed content" });
		getCurrentOrganizationDocumentMock
			.mockResolvedValueOnce(pending)
			.mockResolvedValue(approved);
		approveCurrentOrganizationDocumentDraftMock.mockResolvedValue(approved);
		renderPage();

		// The pending draft opens read-only in the editor surface while the
		// approved content stays untouched behind the view toggle.
		const draftEditor = (await screen.findByLabelText(
			"Center Agent draft content"
		)) as HTMLTextAreaElement;
		expect(draftEditor.value).toBe("Proposed content");
		expect(draftEditor.disabled).toBe(true);
		expect(
			(screen.getByLabelText("Document content") as HTMLTextAreaElement).value
		).toBe("Published content");
		expect(
			screen.getByRole("heading", { name: "Center Agent draft" })
		).toBeTruthy();
		expect(screen.getByText("Draft waiting for review")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: APPROVE_DRAFT_BUTTON_NAME })
		);
		await waitFor(() =>
			expect(approveCurrentOrganizationDocumentDraftMock).toHaveBeenCalledWith({
				documentId: "document-1",
				expectedDraftCreatedAt: "2026-07-15T01:00:00.000Z",
				expectedOrganizationId: "org-acme",
			})
		);
		// Approval remounts the edit form so the editor reloads the fresh
		// approved content; re-query instead of holding the old node.
		await waitFor(() =>
			expect(
				(screen.getByLabelText("Document content") as HTMLTextAreaElement).value
			).toBe("Proposed content")
		);
		expect(
			screen.queryByRole("heading", { name: "Center Agent draft" })
		).toBeNull();
		expect(screen.queryByLabelText("Center Agent draft content")).toBeNull();
	});

	it("presents a Profile Report as a helpful first look without approval pressure", async () => {
		getCurrentOrganizationDocumentMock.mockResolvedValue(
			response({
				draftContent: "What the Center Agent learned",
				draftCreatedAt: "2026-07-15T01:00:00.000Z",
				draftCreatedBy: "center_agent",
				kind: "member_profile",
				subjectUserId: "user-ada",
				title: "Ada Lovelace Profile Report",
			})
		);
		renderPage();

		const report = (await screen.findByLabelText(
			"Document content"
		)) as HTMLTextAreaElement;
		expect(report.value).toBe("What the Center Agent learned");
		expect(report.disabled).toBe(false);
		expect(
			screen.getByRole("heading", {
				name: "What Center Agent has learned so far",
			})
		).toBeTruthy();
		expect(
			screen.getByText(
				"Center Agent will update this Profile Report as it learns more about your work. If anything feels off, tell Center Agent."
			)
		).toBeTruthy();
		expect(screen.queryByText("Draft waiting for review")).toBeNull();
		expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: APPROVE_DRAFT_BUTTON_NAME })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "View approved" })).toBeNull();

		fireEvent.change(report, {
			target: { value: "What Ada and the Center Agent learned together" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(updateCurrentOrganizationDocumentMock).toHaveBeenCalledWith({
				content: "What Ada and the Center Agent learned together",
				documentId: "document-1",
				expectedDocumentUpdatedAt: "2026-07-15T00:00:00.000Z",
				expectedDraftCreatedAt: "2026-07-15T01:00:00.000Z",
				expectedOrganizationId: "org-acme",
			})
		);
	});

	it("discards the reviewed Center Agent draft without changing approved content", async () => {
		const pending = response({
			content: "Published content",
			draftContent: "Proposal to discard",
			draftCreatedAt: "2026-07-15T01:00:00.000Z",
			draftCreatedBy: "center_agent",
		});
		const discarded = response({ content: "Published content" });
		getCurrentOrganizationDocumentMock
			.mockResolvedValueOnce(pending)
			.mockResolvedValue(discarded);
		discardCurrentOrganizationDocumentDraftMock.mockResolvedValue(discarded);
		renderPage();

		const draftEditor = (await screen.findByLabelText(
			"Center Agent draft content"
		)) as HTMLTextAreaElement;
		expect(draftEditor.value).toBe("Proposal to discard");
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));

		await waitFor(() =>
			expect(discardCurrentOrganizationDocumentDraftMock).toHaveBeenCalledWith({
				documentId: "document-1",
				expectedDraftCreatedAt: "2026-07-15T01:00:00.000Z",
				expectedOrganizationId: "org-acme",
			})
		);
		expect(
			screen.queryByRole("heading", { name: "Center Agent draft" })
		).toBeNull();
		expect(
			(screen.getByLabelText("Document content") as HTMLTextAreaElement).value
		).toBe("Published content");
	});

	it("switches the one editor surface between draft and approved views", async () => {
		const pending = response({
			content: "Published content",
			draftContent: "Proposed content",
			draftCreatedAt: "2026-07-15T01:00:00.000Z",
			draftCreatedBy: "center_agent",
		});
		getCurrentOrganizationDocumentMock.mockResolvedValue(pending);
		updateCurrentOrganizationDocumentMock.mockResolvedValue(
			response({ ...pending.document, content: "Human edit" })
		);
		renderPage();

		// Draft is the default view while a draft is pending.
		await screen.findByLabelText("Center Agent draft content");
		fireEvent.click(screen.getByRole("button", { name: "View approved" }));
		expect(screen.getByRole("button", { name: "View draft" })).toBeTruthy();

		// The approved document stays directly editable while the draft is
		// pending; a human save must not touch the draft.
		fireEvent.change(screen.getByLabelText("Document content"), {
			target: { value: "Human edit" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Save approved content" })
		);
		await waitFor(() =>
			expect(updateCurrentOrganizationDocumentMock).toHaveBeenCalledWith({
				content: "Human edit",
				documentId: "document-1",
				expectedDocumentUpdatedAt: "2026-07-15T00:00:00.000Z",
				expectedDraftCreatedAt: "2026-07-15T01:00:00.000Z",
				expectedOrganizationId: "org-acme",
			})
		);
		expect(discardCurrentOrganizationDocumentDraftMock).not.toHaveBeenCalled();
		expect(approveCurrentOrganizationDocumentDraftMock).not.toHaveBeenCalled();
	});

	it("saves a human edit directly to approved content", async () => {
		getCurrentOrganizationDocumentMock.mockResolvedValue(response());
		updateCurrentOrganizationDocumentMock.mockResolvedValue(
			response({ content: "Human edit" })
		);
		renderPage();

		const editor = (await screen.findByLabelText(
			"Document content"
		)) as HTMLTextAreaElement;
		fireEvent.change(editor, { target: { value: "Human edit" } });
		fireEvent.click(
			screen.getByRole("button", { name: "Save approved content" })
		);

		await waitFor(() =>
			expect(updateCurrentOrganizationDocumentMock).toHaveBeenCalledWith({
				content: "Human edit",
				documentId: "document-1",
				expectedDocumentUpdatedAt: "2026-07-15T00:00:00.000Z",
				expectedDraftCreatedAt: null,
				expectedOrganizationId: "org-acme",
			})
		);
	});

	it("returns to the folder that contains the document", async () => {
		getCurrentOrganizationDocumentMock.mockResolvedValue(
			response({ folderId: "folder-1" })
		);
		renderPage();

		const backLink = await screen.findByRole("link", {
			name: "Back to Documents",
		});
		expect(backLink.getAttribute("href")).toContain("folder=folder-1");
	});
});

function response(overrides: Record<string, unknown> = {}) {
	return {
		document: {
			canEditContent: true,
			canManage: true,
			content: "Published content",
			createdAt: "2026-07-15T00:00:00.000Z",
			draftContent: null,
			draftCreatedAt: null,
			draftCreatedBy: null,
			id: "document-1",
			kind: "brief" as const,
			organizationId: "org-acme",
			subjectUserId: null,
			title: "Organization Brief",
			updatedAt: "2026-07-15T00:00:00.000Z",
			...overrides,
		},
	};
}

function renderPage() {
	const rootRoute = createRootRoute();
	const route = createRoute({
		component: () => <OrganizationDocumentDetailPage documentId="document-1" />,
		getParentRoute: () => rootRoute,
		path: "/o/$orgSlug/documents/$documentId",
	});
	const router = createRouter({
		history: createMemoryHistory({
			initialEntries: ["/o/acme/documents/document-1"],
		}),
		routeTree: rootRoute.addChildren([route]),
	});
	return render(
		<TestQueryClientProvider>
			<RouterProvider router={router} />
		</TestQueryClientProvider>
	);
}
