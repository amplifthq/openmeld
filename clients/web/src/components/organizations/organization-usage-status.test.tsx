import type { OrganizationUsageOverviewResponse } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationUsageStatus } from "./organization-usage-status";

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

describe("OrganizationUsageStatus", () => {
	it("shows a visible loading state", () => {
		readOverviewMock.mockReturnValue(new Promise(() => undefined));

		renderUsagePage();

		expect(screen.getByText("Loading usage.")).toBeTruthy();
	});

	it("shows the AI allowance with local and UTC reset time, without Routine counts", async () => {
		readOverviewMock.mockResolvedValue(usageOverview());

		renderUsagePage();

		expect(await screen.findByText("$0.12 / $1.00")).toBeTruthy();
		expect(screen.queryByText("Routines")).toBeNull();
		expect(screen.queryByText("7 / 50")).toBeNull();
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

	it("leaves no empty section when no AI allowance is configured", async () => {
		readOverviewMock.mockResolvedValue(
			usageOverview({
				aiSpend: { usedNanoUsd: 0, dailyLimitNanoUsd: null },
				routines: { count: 0 },
			})
		);

		const view = renderUsagePage();
		await waitFor(() => expect(view.container.childElementCount).toBe(0));
	});

	it("shows a retryable error state", async () => {
		readOverviewMock.mockRejectedValue(new Error("Network unavailable"));

		renderUsagePage();

		expect((await screen.findByRole("alert")).textContent).toBe(
			"OpenMeld could not load usage. Try again."
		);
		readOverviewMock.mockResolvedValue(usageOverview());
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("$0.12 / $1.00")).toBeTruthy();
	});
});

function renderUsagePage() {
	return render(
		<TestQueryClientProvider>
			<OrganizationUsageStatus organizationId="org-1" />
		</TestQueryClientProvider>
	);
}

function usageOverview(
	overrides: {
		aiSpend?: { usedNanoUsd: number; dailyLimitNanoUsd?: number | null };
		routines?: { count: number };
	} = {}
): OrganizationUsageOverviewResponse {
	return {
		aiSpend: {
			dailyLimitNanoUsd:
				overrides.aiSpend?.dailyLimitNanoUsd === undefined
					? 1_000_000_000
					: overrides.aiSpend.dailyLimitNanoUsd,
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
