import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenterAgentRoutinesPage } from "./center-agent-routines-page";

const readCurrentCenterAgentDesignationMock = vi.hoisted(() => vi.fn());
const routinesPanelSpy = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
	}: {
		children: ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		readCurrentCenterAgentDesignation: readCurrentCenterAgentDesignationMock,
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
		currentUserId: "user-1",
	}),
}));

vi.mock("./center-agent-routines-panel", () => ({
	CenterAgentRoutinesPanel: (props: unknown) => {
		routinesPanelSpy(props);
		return <div>Routine list</div>;
	},
}));

describe("CenterAgentRoutinesPage", () => {
	beforeEach(() => {
		readCurrentCenterAgentDesignationMock.mockReset();
		routinesPanelSpy.mockReset();
	});

	afterEach(cleanup);

	it("guides the user to connect a Center Agent before creating Routines", async () => {
		readCurrentCenterAgentDesignationMock.mockResolvedValue({
			designation: null,
			organizationId: "org-acme",
			remoteRuntimeAvailability: { selectable: true },
		});

		renderPage();

		expect(await screen.findByText("Organization")).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 1, name: "Routines" })
		).toBeTruthy();
		expect(
			await screen.findByRole("heading", {
				name: "Connect a Center Agent to run Routines",
			})
		).toBeTruthy();
		expect(
			screen.getByText(
				"Routines are carried out by your Center Agent. Connect one before scheduling recurring work."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Connect Center Agent" })
				.getAttribute("href")
		).toBe("/o/acme/center-agent/settings");
		expect(routinesPanelSpy).not.toHaveBeenCalled();
	});

	it("renders the existing Routines panel after the organization has a designation", async () => {
		readCurrentCenterAgentDesignationMock.mockResolvedValue({
			designation: {
				agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
				designatedAt: "2026-07-13T00:00:00.000Z",
				designatedByUserId: "user-1",
				organizationId: "org-acme",
				profileHandle: "center-agent",
				profileName: "Center Agent",
				runtime: "remote_agent",
			},
			organizationId: "org-acme",
			remoteRuntimeAvailability: { selectable: true },
		});

		renderPage();

		expect(await screen.findByText("Routine list")).toBeTruthy();
		await waitFor(() => {
			expect(routinesPanelSpy).toHaveBeenCalledWith({
				currentUserId: "user-1",
				isPersonalWorkspace: false,
				organizationId: "org-acme",
				orgSlug: "acme",
			});
		});
	});

	it("shows the shared Center Agent error copy instead of raw service details", async () => {
		readCurrentCenterAgentDesignationMock.mockRejectedValue({
			code: "auth.unauthenticated",
			message: "raw upstream details",
			requestId: "req-routines",
			status: 401,
		});

		renderPage();

		expect(
			(
				await screen.findByRole("alert", {
					name: "",
				})
			).textContent
		).toBe(
			"Sign in again before managing the Center Agent. Error code: auth.unauthenticated. Request ID: req-routines."
		);
		expect(screen.queryByText("raw upstream details")).toBeNull();
	});
});

function renderPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<CenterAgentRoutinesPage />
		</QueryClientProvider>
	);
}
