import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CenterAgentDirectMessageRouteData } from "#/lib/organizations/center-agent-route-loader";
import { CenterAgentCompactConversation } from "./center-agent-compact-conversation";

const loadCenterAgentDirectMessageRouteDataMock = vi.hoisted(() => vi.fn());
const readCachedCenterAgentDirectMessageRouteDataMock = vi.hoisted(() =>
	vi.fn()
);

vi.mock("#/lib/organizations/center-agent-route-loader", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent-route-loader")
	>("#/lib/organizations/center-agent-route-loader");
	return {
		...actual,
		loadCenterAgentDirectMessageRouteData:
			loadCenterAgentDirectMessageRouteDataMock,
		readCachedCenterAgentDirectMessageRouteData:
			readCachedCenterAgentDirectMessageRouteDataMock,
	};
});

vi.mock("./center-agent-page", () => ({
	CenterAgentPage: ({
		directMessageRouteData,
		presentation,
	}: {
		directMessageRouteData: CenterAgentDirectMessageRouteData;
		presentation: string;
	}) => (
		<section aria-label="Center Agent result">
			{directMessageRouteData.status} / {presentation}
		</section>
	),
}));

const READY_ROUTE_DATA: CenterAgentDirectMessageRouteData = {
	directMessage: {
		centerAgentProfileId: "agent-center",
		created: false,
		memberProfileId: "human-1",
		organizationId: "org-acme",
		spaceId: "space-center-agent",
	},
	status: "ready",
};

describe("CenterAgentCompactConversation", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it("renders cached route data on the first frame while it revalidates", () => {
		readCachedCenterAgentDirectMessageRouteDataMock.mockReturnValue(
			READY_ROUTE_DATA
		);
		loadCenterAgentDirectMessageRouteDataMock.mockReturnValue(
			new Promise(() => undefined)
		);

		renderCompactConversation();

		expect(
			screen.getByRole("region", { name: "Center Agent result" }).textContent
		).toContain("ready / compact");
		expect(screen.queryByText("Loading Center Agent conversation")).toBeNull();
		expect(loadCenterAgentDirectMessageRouteDataMock).toHaveBeenCalledOnce();
	});

	it("keeps cached route data visible when background revalidation throws", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		readCachedCenterAgentDirectMessageRouteDataMock.mockReturnValue(
			READY_ROUTE_DATA
		);
		loadCenterAgentDirectMessageRouteDataMock.mockRejectedValue(
			new Error("temporary projection failure")
		);

		renderCompactConversation();

		await waitFor(() => {
			expect(console.error).toHaveBeenCalled();
		});
		expect(
			screen.getByRole("region", { name: "Center Agent result" }).textContent
		).toContain("ready / compact");
		expect(
			screen.queryByText("Couldn’t load the Center Agent conversation.")
		).toBeNull();
	});
});

function renderCompactConversation() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<CenterAgentCompactConversation organizationId="org-acme" />
		</QueryClientProvider>
	);
}
