import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { OrganizationHomePage } from "./organization-home-page";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

const readCurrentCenterAgentDesignationMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentOperatingStateMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationDirectoryMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-123",
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

vi.mock("#/lib/organizations/center-agent", async (importOriginal) => ({
	...(await importOriginal()),
	readCurrentCenterAgentDesignation: readCurrentCenterAgentDesignationMock,
	readCurrentCenterAgentOperatingState:
		readCurrentCenterAgentOperatingStateMock,
}));

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationDirectory: readCurrentOrganizationDirectoryMock,
}));

vi.mock("./organization-home-activity", () => ({
	OrganizationHomeActivity: () => <div>Agent Activity preview</div>,
}));
vi.mock("./organization-home-directory", () => ({
	OrganizationHomeDirectory: () => <div>Team preview</div>,
}));
vi.mock("./organization-home-inbox", () => ({
	OrganizationHomeInbox: () => <div>Inbox preview</div>,
}));
vi.mock("./organization-home-resources", () => ({
	OrganizationHomeResources: () => <div>Resources preview</div>,
}));
vi.mock("./organization-home-work", () => ({
	OrganizationHomeWork: () => <div>Work preview</div>,
}));

describe("OrganizationHomePage", () => {
	beforeEach(() => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			fillRect: vi.fn(),
			fillStyle: "",
			globalCompositeOperation: "source-over",
		} as unknown as CanvasRenderingContext2D);
		readCurrentOrganizationDirectoryMock.mockReset().mockResolvedValue({
			agentProfiles: [
				{
					isCenterAgent: true,
					managedRole: "center_agent",
					organizationId: "organization-123",
					profileHandle: "atlas",
					profileId: "agent-123",
					profileName: "Atlas",
					readiness: {},
				},
			],
			generatedAt: "2026-08-10T00:00:00.000Z",
			members: [],
			organizationId: "organization-123",
		});
		readCurrentCenterAgentDesignationMock.mockReset().mockResolvedValue({
			designation: {
				agentProfileId: "agent-123",
				createdAt: "2026-08-10T00:00:00.000Z",
				designatedBy: "user-123",
				duty: null,
				organizationId: "organization-123",
			},
			organizationId: "organization-123",
		});
		readCurrentCenterAgentOperatingStateMock.mockReset().mockResolvedValue({
			canChangeOperatingState: true,
			operatingState: "active",
			organizationId: "organization-123",
			pausedAt: null,
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("makes the real Center Agent the first action without inventing a healthy status", async () => {
		renderHome(<OrganizationHomePage />);

		expect(await screen.findByRole("heading", { name: "Atlas" })).toBeTruthy();
		expect(screen.getByText("@atlas")).toBeTruthy();
		expect(screen.queryByText("Available")).toBeNull();
		expect(screen.queryByText("Online")).toBeNull();
		const action = screen.getByRole("link", { name: "Ask Center Agent" });
		expect(action.getAttribute("href")).toBe("/o/amplift/center-agent/chat");
		expect(action.className).toContain("bg-primary");
		expect(action.className).toContain("sm:ms-auto");
		expect(action.className).not.toContain("flex-1");
		expect(action.querySelector("svg")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Ask Center Agent…" })
		).toBeNull();
	});

	it("keeps one stable Home composition for the organization", async () => {
		renderHome(<OrganizationHomePage />);

		expect(
			await screen.findByRole("heading", { name: "Amplift" })
		).toBeTruthy();
		expect(screen.queryByText("Agent Activity preview")).toBeNull();
		const orderedPreviews = [
			screen.getByText("Inbox preview"),
			screen.getByText("Work preview"),
			screen.getByText("Team preview"),
			screen.getByText("Resources preview"),
		];
		for (const [index, preview] of orderedPreviews.entries()) {
			const nextPreview = orderedPreviews[index + 1];
			if (nextPreview) {
				expect(preview.compareDocumentPosition(nextPreview)).toBe(
					Node.DOCUMENT_POSITION_FOLLOWING
				);
			}
		}
	});

	it.each([
		["designation", readCurrentCenterAgentDesignationMock],
		["directory", readCurrentOrganizationDirectoryMock],
	] as const)("fails closed when the Center Agent %s is unavailable", async (_source, failedRead) => {
		failedRead.mockRejectedValueOnce(
			Object.assign(new Error("Identity unavailable."), {
				code: "gateway.invalid_response",
			})
		);
		renderHome(<OrganizationHomePage />);

		expect(
			await screen.findByText("Center Agent is unavailable.")
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Ask Center Agent" })).toBeNull();
		expect(screen.queryByText("@atlas")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(failedRead).toHaveBeenCalledTimes(2));
	});

	it.each([
		[
			"designation",
			readCurrentCenterAgentDesignationMock,
			centerAgentQueryKeys.designation("organization-123"),
		],
		[
			"directory",
			readCurrentOrganizationDirectoryMock,
			organizationQueryKeys.directory("organization-123"),
		],
	] as const)("fails closed when the cached Center Agent %s cannot refresh", async (_source, failedRead, queryKey) => {
		const { queryClient } = renderHome(<OrganizationHomePage />);

		expect(await screen.findByText("@atlas")).toBeTruthy();
		failedRead.mockRejectedValue(
			Object.assign(new Error("Identity refresh unavailable."), {
				code: "gateway.invalid_response",
			})
		);
		await queryClient.refetchQueries({ queryKey });

		expect(
			await screen.findByText("Center Agent is unavailable.")
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Ask Center Agent" })).toBeNull();
		expect(screen.queryByText("@atlas")).toBeNull();
	});

	it("surfaces and retries an unavailable Center Agent operating state", async () => {
		readCurrentCenterAgentOperatingStateMock.mockRejectedValueOnce(
			Object.assign(new Error("Operating state unavailable."), {
				code: "gateway.invalid_response",
			})
		);

		renderHome(<OrganizationHomePage />);

		expect(
			await screen.findByText("Center Agent status is unavailable.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(readCurrentCenterAgentOperatingStateMock).toHaveBeenCalledTimes(2)
		);
		await waitFor(() =>
			expect(
				screen.queryByText("Center Agent status is unavailable.")
			).toBeNull()
		);
	});
});

function renderHome(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	};
}
