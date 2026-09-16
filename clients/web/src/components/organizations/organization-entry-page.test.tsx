import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import {
	NewOrganizationPage,
	OrganizationEntryPage,
} from "./organization-entry-page";

const createOrganizationMock = vi.hoisted(() => vi.fn());
const prepareOrganizationDestinationMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const CREATE_AN_ORGANIZATION_LABEL = /Create an organization/;
const WAKE_ACCESS_PATTERN = /Wake access/i;

let currentOrganization: OrganizationSummary = {
	id: "org-solo",
	isPersonal: true,
	name: "Solo",
	slug: "solo",
};
let organizations: OrganizationSummary[] = [currentOrganization];
let consoleErrorMock: ReturnType<typeof vi.spyOn>;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		search,
		to,
		...props
	}: {
		children: ReactNode;
		search?: Record<string, string | undefined>;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={buildTestHref(to, search)} {...props}>
			{children}
		</a>
	),
	Navigate: ({
		replace,
		search,
		to,
	}: {
		replace?: boolean;
		search?: Record<string, string | undefined>;
		to: string;
	}) => (
		<div
			data-replace={String(Boolean(replace))}
			data-testid="navigate"
			data-to={buildTestHref(to, search)}
		/>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: () => <div data-testid="outer-rail" />,
}));

vi.mock("#/components/app/app-global-controls", () => ({
	AppGlobalControls: () => <div data-testid="global-controls" />,
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization,
		organizations,
	}),
	useAppOrganization: () => ({
		currentOrganization,
		organizations,
	}),
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	createOrganization: createOrganizationMock,
}));

vi.mock("#/lib/organizations/prepare-organization-destination", () => ({
	prepareOrganizationDestination: prepareOrganizationDestinationMock,
}));

describe("OrganizationEntryPage", () => {
	beforeEach(() => {
		consoleErrorMock = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		createOrganizationMock.mockReset();
		createOrganizationMock.mockResolvedValue({
			id: "org-acme",
			name: "Acme Labs",
			slug: "acme-labs",
		});
		prepareOrganizationDestinationMock.mockReset().mockResolvedValue(undefined);
		navigateMock.mockReset().mockResolvedValue(undefined);
		currentOrganization = {
			id: "org-solo",
			isPersonal: true,
			name: "Solo",
			slug: "solo",
		};
		organizations = [currentOrganization];
	});

	afterEach(() => {
		cleanup();
		consoleErrorMock.mockRestore();
	});

	it("redirects the empty organization picker to the new organization page", () => {
		renderPage();

		expect(screen.getByTestId("outer-rail")).toBeTruthy();
		const redirect = screen.getByTestId("navigate");
		expect(redirect.getAttribute("data-to")).toBe("/o/solo/new-organization");
		expect(redirect.getAttribute("data-replace")).toBe("true");
		expect(
			screen.queryByRole("heading", {
				name: "Create an organization",
			})
		).toBeNull();
	});

	it("renders the organization guide on the new organization page", () => {
		renderNewOrganizationPage();

		expect(
			screen.getByRole("heading", {
				name: "Create an organization",
			})
		).toBeTruthy();
		expect(
			screen.getByText(
				"When you're ready to work with other people, create an organization to share agents, see people and agents in one directory, and let a Center Agent coordinate the loop."
			)
		).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Create organization",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(
			screen.queryByText(
				"Available after the organization creation and bulk Wake access contract lands."
			)
		).toBeNull();
		expect(
			screen.queryByText("No invitations are ready for this account yet.")
		).toBeNull();
		expect(screen.queryByTestId("navigate")).toBeNull();
	});

	it("places an icon back button in a quiet top-left header", () => {
		renderNewOrganizationPage();

		const backButton = screen.getByRole("button", {
			name: "Back to Spaces",
		});
		const header = document.querySelector(
			'[data-slot="organization-entry-content-header"]'
		);

		expect(header?.contains(backButton)).toBe(true);
		expect(header?.className).toContain("border-b-0");
		expect(header?.classList.contains("border-b")).toBe(false);
		expect(backButton.querySelector("svg")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "back" })).toBeNull();
	});

	it("prioritizes available organizations before the create organization form", () => {
		organizations = [
			currentOrganization,
			{
				id: "org-acme",
				name: "Acme Labs",
				slug: "acme-labs",
			},
		];

		renderPage();

		expect(
			screen.getByRole("heading", {
				name: "Organizations",
			})
		).toBeTruthy();
		const organizationLink = screen.getByRole("link", {
			name: "Open Acme Labs organization",
		});
		expect(organizationLink.getAttribute("href")).toBe("/o/acme-labs/spaces");
		expect(screen.getByText("/acme-labs")).toBeTruthy();
		expect(screen.queryByLabelText("Organization name")).toBeNull();

		expect(
			screen
				.getByRole("link", {
					name: CREATE_AN_ORGANIZATION_LABEL,
				})
				.getAttribute("href")
		).toBe("/o/solo/new-organization");
		expect(screen.queryByLabelText("Organization name")).toBeNull();
	});

	it("opens the selected organization through its URL", async () => {
		organizations = [
			currentOrganization,
			{
				id: "org-acme",
				name: "Acme Labs",
				slug: "acme-labs",
			},
		];
		renderPage();

		fireEvent.click(
			screen.getByRole("link", {
				name: "Open Acme Labs organization",
			})
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-labs/spaces",
			});
		});
	});

	it("excludes Personal Workspaces and preserves intent on the create link in Slack install mode", async () => {
		organizations = [
			currentOrganization,
			{
				id: "org-acme",
				name: "Acme Labs",
				slug: "acme-labs",
			},
		];

		renderSlackInstallPage();

		expect(
			screen.getByText(
				"Choose the organization to connect to your Slack workspace — usually your team's organization. Or create a new one."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Open Solo organization" })
		).toBeNull();
		const acmeLink = screen.getByRole("link", {
			name: "Open Acme Labs organization",
		});
		expect(acmeLink.getAttribute("href")).toBe(
			"/o/acme-labs/center-agent/channels"
		);
		expect(
			screen
				.getByRole("link", { name: CREATE_AN_ORGANIZATION_LABEL })
				.getAttribute("href")
		).toBe("/o/solo/new-organization?intent=slack-install");

		fireEvent.click(acmeLink);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-labs/center-agent/channels",
			});
		});
	});

	it("returns from the organization setup guide to Spaces without organizations", () => {
		renderNewOrganizationPage();

		fireEvent.click(screen.getByRole("button", { name: "Back to Spaces" }));

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/solo/spaces",
		});
	});

	it("returns from the organization setup guide to the picker when organizations exist", () => {
		organizations = [
			currentOrganization,
			{
				id: "org-acme",
				name: "Acme Labs",
				slug: "acme-labs",
			},
		];

		renderNewOrganizationPage();

		fireEvent.click(
			screen.getByRole("button", { name: "Back to Organizations" })
		);

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/solo/organizations",
		});
	});

	it("returns first-time Slack installers to Spaces instead of an ineligible Personal Workspace picker", () => {
		renderSlackInstallNewOrganizationPage();

		fireEvent.click(screen.getByRole("button", { name: "Back to Spaces" }));

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/solo/spaces",
		});
	});

	it("keeps setup decisions out of the creation form", () => {
		renderNewOrganizationPage();

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Acme Labs" },
		});
		expect(screen.queryByLabelText("Slug")).toBeNull();
		expect(screen.queryByText(WAKE_ACCESS_PATTERN)).toBeNull();
		expect(screen.queryByLabelText("Organization memory")).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(createOrganizationMock).not.toHaveBeenCalled();
	});

	it("creates and opens an organization without answering onboarding decisions", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		renderNewOrganizationPage(queryClient);

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Acme Labs" },
		});
		expect(screen.queryByLabelText("Slug")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Create organization",
			})
		);

		await waitFor(() => {
			expect(createOrganizationMock).toHaveBeenCalledWith({
				name: "Acme Labs",
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: ["organization-scope"],
			});
			expect(prepareOrganizationDestinationMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				queryClient: expect.any(Object),
			});
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-labs/spaces",
			});
		});
		expect(
			prepareOrganizationDestinationMock.mock.invocationCallOrder[0]
		).toBeLessThan(navigateMock.mock.invocationCallOrder[0] ?? 0);
	});

	it("opens Channels after creating an organization in Slack install mode", async () => {
		renderSlackInstallNewOrganizationPage();

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Acme Labs" },
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Create organization",
			})
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-labs/center-agent/channels",
			});
		});
	});

	it("shows the current organization setup step while work is pending", async () => {
		let resolveCreateOrganization: (organization: OrganizationSummary) => void =
			() => undefined;
		let resolveNavigation: () => void = () => undefined;
		createOrganizationMock.mockReturnValueOnce(
			new Promise<OrganizationSummary>((resolve) => {
				resolveCreateOrganization = resolve;
			})
		);
		navigateMock.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				resolveNavigation = resolve;
			})
		);
		renderNewOrganizationPage();

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Acme Labs" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create organization" })
		);
		expect(
			await screen.findByRole("button", { name: "Creating organization" })
		).toBeTruthy();

		act(() => {
			resolveCreateOrganization({
				id: "org-acme",
				name: "Acme Labs",
				slug: "acme-labs",
			});
		});
		expect(
			await screen.findByRole("button", { name: "Opening Acme Labs" })
		).toBeTruthy();

		act(() => {
			resolveNavigation();
		});
	});

	it("retries opening a created organization without creating a duplicate", async () => {
		navigateMock
			.mockRejectedValueOnce(new Error("Organization navigation failed."))
			.mockResolvedValueOnce(undefined);
		renderNewOrganizationPage();

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Acme Labs" },
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Create organization",
			})
		);

		expect(
			await screen.findByText(
				"OpenMeld created this organization but could not open it."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Try again. OpenMeld will continue from the organization it already created."
			)
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Retry opening" }));

		await waitFor(() => {
			expect(createOrganizationMock).toHaveBeenCalledTimes(1);
			expect(navigateMock).toHaveBeenCalledTimes(2);
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme-labs/spaces",
			});
		});
	});

	it("retries Center Agent initialization without creating a duplicate organization", async () => {
		prepareOrganizationDestinationMock
			.mockRejectedValueOnce(new Error("Internal initialization detail."))
			.mockResolvedValueOnce(undefined);
		renderNewOrganizationPage();

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Acme Labs" },
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Create organization",
			})
		);

		expect(
			await screen.findByText(
				"OpenMeld created this organization but could not open it."
			)
		).toBeTruthy();
		expect(screen.queryByText("Internal initialization detail.")).toBeNull();
		expect(navigateMock).not.toHaveBeenCalled();
		expect(consoleErrorMock).toHaveBeenCalledWith(
			"Organization setup did not finish.",
			expect.objectContaining({ organizationId: "org-acme" })
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry opening" }));

		await waitFor(() => {
			expect(createOrganizationMock).toHaveBeenCalledTimes(1);
			expect(prepareOrganizationDestinationMock).toHaveBeenCalledTimes(2);
			expect(navigateMock).toHaveBeenCalledTimes(1);
		});
	});

	it("keeps the organization limit refusal visible without leaving the page", async () => {
		createOrganizationMock.mockRejectedValue(
			Object.assign(
				new Error("You have reached the maximum number of organizations"),
				{
					code: "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS",
					status: 403,
				}
			)
		);
		renderNewOrganizationPage();

		fireEvent.change(screen.getByLabelText("Organization name"), {
			target: { value: "Organization 6" },
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Create organization",
			})
		);

		expect(
			await screen.findByText(
				"You have reached the maximum number of organizations"
			)
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Create organization" })
		).toBeTruthy();
		expect(createOrganizationMock).toHaveBeenCalledTimes(1);
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("renders the organization picker inside a collaboration organization context", () => {
		currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		organizations = [currentOrganization];

		renderPage();

		expect(screen.queryByTestId("navigate")).toBeNull();
		expect(
			screen.getByRole("heading", {
				name: "Organizations",
			})
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", {
					name: "Open Acme organization",
				})
				.getAttribute("href")
		).toBe("/o/acme/spaces");
	});
});

function renderPage() {
	return render(
		<TestQueryClientProvider>
			<OrganizationEntryPage />
		</TestQueryClientProvider>
	);
}

function renderSlackInstallPage() {
	return render(
		<TestQueryClientProvider>
			<OrganizationEntryPage intent="slack-install" />
		</TestQueryClientProvider>
	);
}

function renderNewOrganizationPage(
	queryClient?: ReturnType<typeof createTestQueryClient>
) {
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<NewOrganizationPage />
		</TestQueryClientProvider>
	);
}

function renderSlackInstallNewOrganizationPage() {
	return render(
		<TestQueryClientProvider>
			<NewOrganizationPage intent="slack-install" />
		</TestQueryClientProvider>
	);
}

function buildTestHref(
	path: string,
	search?: Record<string, string | undefined>
): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search ?? {})) {
		if (value) {
			params.set(key, value);
		}
	}
	const query = params.toString();
	return query ? `${path}?${query}` : path;
}
