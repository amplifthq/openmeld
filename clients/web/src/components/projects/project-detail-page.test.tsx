import type { Project } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	archiveCurrentProject,
	listCurrentProjects,
} from "#/lib/organizations/projects";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { ProjectDetailPage } from "./project-detail-page";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
const VIEW_ACTIVITY_LINK_PATTERN = /View Activity for this Project/;

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
	useNavigate: () => navigate,
}));

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

vi.mock("#/lib/organizations/projects", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/organizations/projects")>();
	return {
		...original,
		archiveCurrentProject: vi.fn(),
		listCurrentProjects: vi.fn(),
		updateCurrentProject: vi.fn(),
	};
});

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationDirectory: vi.fn(async () => ({
		agentProfiles: [],
		generatedAt: "2026-07-14T00:00:00.000Z",
		members: [
			{
				humanProfile: null,
				joinedAt: "2026-07-01T00:00:00.000Z",
				memberId: "member-1",
				organizationId: "org-acme",
				role: "owner",
				user: {
					email: "felix@example.test",
					id: "user-1",
					image: null,
					name: "Felix",
				},
				userId: "user-1",
			},
		],
		organizationId: "org-acme",
	})),
}));

vi.mock("./project-computer-section", () => ({
	ProjectComputerSection: () => <h2>This computer controls</h2>,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ProjectDetailPage", () => {
	it("renders the three detail sections and the server-projected archive boundary", async () => {
		vi.mocked(listCurrentProjects).mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [project({ canArchive: false, canManage: false })],
		});
		renderPage();

		expect(
			await screen.findByRole("heading", { name: "OpenMeld" })
		).toBeTruthy();
		expect(screen.getByText("Felix")).toBeTruthy();
		expect(
			screen
				.getByRole("link", {
					name: "https://github.com/amplifthq/openmeld",
				})
				.getAttribute("href")
		).toBe("https://github.com/amplifthq/openmeld");
		expect(
			screen.getByRole("heading", { name: "This computer controls" })
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: VIEW_ACTIVITY_LINK_PATTERN })
				.getAttribute("href")
		).toBe("/o/acme/agent-activity/sessions?project=project-1");
		const backLink = screen.getByRole("link", { name: "All Projects" });
		expect(backLink.className).toContain("touch-manipulation");
		expect(backLink.className).toContain("max-lg:min-h-11");
		expect(
			screen.getByText("Only the organization owner can remove this Project.")
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Remove Project" })).toBeNull();
	});

	it("shows the approved Activity restriction when archive is rejected", async () => {
		vi.mocked(listCurrentProjects).mockResolvedValueOnce({
			organizationId: "org-acme",
			projects: [project({ canArchive: true, canManage: true })],
		});
		vi.mocked(archiveCurrentProject).mockRejectedValueOnce({
			code: "gateway.upstream_error",
			message: "Project already has Activity",
			requestId: "request-1",
			status: 409,
			upstreamCode: "project.has_activity",
		});
		renderPage();
		await screen.findByRole("heading", { name: "OpenMeld" });
		fireEvent.click(screen.getByRole("button", { name: "Remove Project" }));
		fireEvent.click(
			screen
				.getAllByRole("button", { name: "Remove Project" })
				.at(-1) as HTMLElement
		);

		await waitFor(() =>
			expect(archiveCurrentProject).toHaveBeenCalledWith({
				expectedOrganizationId: "org-acme",
				projectId: "project-1",
			})
		);
		expect(
			await screen.findByText(
				"This Project already has Activity. Only the organization owner can remove it."
			)
		).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});
});

function project(overrides: Partial<Project>): Project {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: "project-1",
		name: "OpenMeld",
		organizationId: "org-acme",
		repositoryFingerprint: `sha256:${"a".repeat(64)}`,
		repositoryUrl: "https://github.com/amplifthq/openmeld",
		slug: "openmeld",
		updatedAtMs: 1,
		...overrides,
	};
}

function renderPage() {
	return render(
		<TestQueryClientProvider>
			<ProjectDetailPage projectId="project-1" />
		</TestQueryClientProvider>
	);
}
