import type { OrganizationUsageOverviewResponse } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { CenterAgentUsageSection } from "./center-agent-usage-section";

const { readOverviewMock } = vi.hoisted(() => ({
	readOverviewMock: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-usage", () => ({
	readCurrentOrganizationUsageOverview: readOverviewMock,
}));

afterEach(() => {
	cleanup();
	readOverviewMock.mockReset();
});

describe("CenterAgentUsageSection", () => {
	it("shows a visible loading state", () => {
		readOverviewMock.mockReturnValue(new Promise(() => undefined));

		renderUsagePage();

		expect(screen.getByText("Loading usage.")).toBeTruthy();
	});

	it("shows current model costs and Routine usage with local and UTC reset time", async () => {
		readOverviewMock.mockResolvedValue(usageOverview());

		renderUsagePage();

		expect(await screen.findByText("$0.12")).toBeTruthy();
		expect(screen.getByText("7 / 50")).toBeTruthy();
		expect(screen.getByText("All 50 Routines can be enabled.")).toBeTruthy();
		const expectedLocalResetTime = new Date(
			"2026-07-17T00:00:00.000Z"
		).toLocaleTimeString("en-US", {
			hour: "2-digit",
			hourCycle: "h23",
			minute: "2-digit",
		});
		expect(
			screen.getByText(`Resets at ${expectedLocalResetTime} (00:00 UTC)`)
		).toBeTruthy();
		expect(screen.getAllByRole("progressbar")).toHaveLength(1);
	});

	it("explains the zero-usage state instead of rendering an empty card", async () => {
		readOverviewMock.mockResolvedValue(
			usageOverview({
				aiSpend: { usedNanoUsd: 0 },
				routines: { count: 0 },
			})
		);

		renderUsagePage();

		expect(await screen.findByText("$0.00")).toBeTruthy();
		expect(screen.getByText("No routines created yet.")).toBeTruthy();
	});

	it("shows a retryable error state", async () => {
		readOverviewMock.mockRejectedValue(new Error("Network unavailable"));

		renderUsagePage();

		expect((await screen.findByRole("alert")).textContent).toBe(
			"OpenMeld could not load usage. Try again."
		);
		readOverviewMock.mockResolvedValue(usageOverview());
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("$0.12")).toBeTruthy();
	});
});

function renderUsagePage() {
	return render(
		<TestQueryClientProvider>
			<CenterAgentUsageSection
				isPersonalWorkspace={false}
				organizationId="org-1"
			/>
		</TestQueryClientProvider>
	);
}

function usageOverview(
	overrides: {
		aiSpend?: { usedNanoUsd: number };
		routines?: { count: number };
	} = {}
): OrganizationUsageOverviewResponse {
	return {
		aiSpend: {
			dailyLimitNanoUsd: null,
			resetsAt: "2026-07-17T00:00:00.000Z",
			usedNanoUsd: overrides.aiSpend?.usedNanoUsd ?? 120_000_000,
			missingCostRequests: 0,
			exhausted: false,
		},
		routines: {
			count: overrides.routines?.count ?? 7,
			limit: 50,
		},
	};
}
