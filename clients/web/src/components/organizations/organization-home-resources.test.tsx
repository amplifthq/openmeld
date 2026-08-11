import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationDocumentQueryKeys } from "#/query/organizations/organization-documents";
import { projectQueryKeys } from "#/query/organizations/projects";
import { OrganizationHomeResources } from "./organization-home-resources";

const listCurrentOrganizationDocumentsMock = vi.hoisted(() => vi.fn());
const listCurrentProjectsMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

vi.mock("./organization-home-activity", () => ({
	OrganizationHomeActivity: () => <div>Agent Activity preview</div>,
}));

vi.mock(
	"#/lib/organizations/organization-documents",
	async (importOriginal) => ({
		...(await importOriginal()),
		listCurrentOrganizationDocuments: listCurrentOrganizationDocumentsMock,
	})
);

vi.mock("#/lib/organizations/projects", async (importOriginal) => ({
	...(await importOriginal()),
	listCurrentProjects: listCurrentProjectsMock,
}));

describe("OrganizationHomeResources", () => {
	beforeEach(() => {
		listCurrentProjectsMock.mockReset().mockResolvedValue(createProjects());
		listCurrentOrganizationDocumentsMock
			.mockReset()
			.mockResolvedValue(createDocuments());
	});

	afterEach(cleanup);

	it("places Agent Activity before Projects and Documents", async () => {
		renderResources();

		const activity = screen.getByText("Agent Activity preview");
		const projects = await screen.findByText("Projects");
		const documents = screen.getByText("Documents");
		expect(activity.compareDocumentPosition(projects)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(projects.compareDocumentPosition(documents)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("keeps Projects visible and retries when their refresh fails", async () => {
		const { queryClient } = renderResources();

		expect(await screen.findByText("OpenMeld")).toBeTruthy();

		listCurrentProjectsMock.mockRejectedValue(
			new Error("Projects refresh failed.")
		);
		await queryClient.refetchQueries({
			queryKey: projectQueryKeys.organization("organization-1"),
		});

		expect(
			await screen.findByText("Resources may be out of date.")
		).toBeTruthy();
		expect(screen.getByText("OpenMeld")).toBeTruthy();

		listCurrentProjectsMock.mockResolvedValue(createProjects());
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Resources may be out of date.")).toBeNull()
		);
	});

	it("keeps Documents visible and retries when their refresh fails", async () => {
		const { queryClient } = renderResources();

		expect(await screen.findByText("Launch Brief")).toBeTruthy();

		listCurrentOrganizationDocumentsMock.mockRejectedValue(
			new Error("Documents refresh failed.")
		);
		await queryClient.refetchQueries({
			queryKey: organizationDocumentQueryKeys.list("organization-1"),
		});

		expect(
			await screen.findByText("Resources may be out of date.")
		).toBeTruthy();
		expect(screen.getByText("Launch Brief")).toBeTruthy();

		listCurrentOrganizationDocumentsMock.mockResolvedValue(createDocuments());
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Resources may be out of date.")).toBeNull()
		);
	});

	it("does not present cached empty Resources as current after refresh failure", async () => {
		listCurrentProjectsMock.mockResolvedValue(createProjects([]));
		listCurrentOrganizationDocumentsMock.mockResolvedValue(createDocuments([]));
		const { queryClient } = renderResources();

		expect(await screen.findByText("No Projects yet")).toBeTruthy();
		expect(screen.getByText("No Documents yet")).toBeTruthy();

		listCurrentProjectsMock.mockRejectedValue(
			new Error("Projects refresh failed.")
		);
		listCurrentOrganizationDocumentsMock.mockRejectedValue(
			new Error("Documents refresh failed.")
		);
		await Promise.all([
			queryClient.refetchQueries({
				queryKey: projectQueryKeys.organization("organization-1"),
			}),
			queryClient.refetchQueries({
				queryKey: organizationDocumentQueryKeys.list("organization-1"),
			}),
		]);

		expect(
			await screen.findByText("Resources may be out of date.")
		).toBeTruthy();
		expect(screen.queryByText("No Projects yet")).toBeNull();
		expect(screen.queryByText("No Documents yet")).toBeNull();
	});
});

function renderResources() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<OrganizationHomeResources />
			</QueryClientProvider>
		),
	};
}

function createProjects(
	projects = [
		{
			archivedAtMs: null,
			id: "project-1",
			name: "OpenMeld",
		},
	]
) {
	return { organizationId: "organization-1", projects };
}

function createDocuments(
	documents = [
		{
			id: "document-1",
			kind: "brief" as const,
			title: "Launch Brief",
		},
	]
) {
	return {
		canManage: true,
		currentUserId: "user-1",
		documents,
		folders: [],
		organizationId: "organization-1",
	};
}
