import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationHomeActivity } from "./organization-home-activity";

const TILDE_VALUE_PATTERN = /^~/u;
const activityState = vi.hoisted(() => ({
	data: null as unknown,
	providerProps: null as null | {
		organizationId: string;
		projectFilterMode?: "organization" | "url";
		statsEnabled?: boolean;
	},
	view: null as unknown,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock("./agent-activity-page", () => ({
	AgentActivityDataProvider: (input: {
		children: ReactNode;
		organizationId: string;
		projectFilterMode?: "organization" | "url";
		statsEnabled?: boolean;
	}) => {
		activityState.providerProps = {
			organizationId: input.organizationId,
			projectFilterMode: input.projectFilterMode,
			statsEnabled: input.statsEnabled,
		};
		return input.children;
	},
	useAgentActivityData: () => activityState.data,
	useAgentActivityView: () => activityState.view,
}));

vi.mock("./agent-activity-rhythm", () => ({
	AgentActivityRhythm: () => <div>Activity rhythm</div>,
}));

describe("OrganizationHomeActivity", () => {
	beforeEach(() => {
		activityState.data = createActivityData();
		activityState.providerProps = null;
		activityState.view = createActivityView();
	});

	afterEach(cleanup);

	it("requests Organization-wide Activity instead of inheriting a URL Project filter", () => {
		renderActivity();

		expect(activityState.providerProps).toEqual({
			organizationId: "organization-1",
			projectFilterMode: "organization",
			statsEnabled: false,
		});
	});

	it("uses plain totals and explains truncated snapshot coverage", () => {
		activityState.data = createActivityData({ sessionsTruncated: true });

		renderActivity();

		expect(screen.getAllByText("1")).toHaveLength(2);
		expect(screen.queryByText(TILDE_VALUE_PATTERN)).toBeNull();
		expect(
			screen.getByText("Totals reflect the newest 500 sessions.")
		).toBeTruthy();
	});

	it("keeps cached Activity visible and names a background refresh failure", () => {
		activityState.data = createActivityData({ isError: true });

		renderActivity();

		expect(screen.getByText("Last known working")).toBeTruthy();
		expect(screen.getByText("Activity rhythm")).toBeTruthy();
		expect(
			screen.getByText(
				"Agent Activity couldn’t refresh. Showing the latest available data."
			)
		).toBeTruthy();
	});

	it("marks a successful but stale Activity snapshot as last-known data", () => {
		const refetch = vi.fn();
		activityState.data = createActivityData({ refetch });
		activityState.view = createActivityView({ isStale: true });

		renderActivity();

		expect(screen.queryByText("Working now")).toBeNull();
		expect(screen.getByText("Last known working")).toBeTruthy();
		expect(screen.getByText("Agent Activity may be out of date.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(refetch).toHaveBeenCalledOnce();
	});
});

function renderActivity() {
	return render(
		<OrganizationHomeActivity
			organizationId="organization-1"
			organizationSlug="amplift"
		/>
	);
}

function createActivityData(input?: {
	isError?: boolean;
	refetch?: () => void;
	sessionsTruncated?: boolean;
}) {
	return {
		currentTimeMs: Date.parse("2026-08-10T12:00:00.000Z"),
		snapshotQuery: {
			data: {
				asOfMs: Date.parse("2026-08-10T12:00:00.000Z"),
				digests: [],
				digestsTruncated: false,
				organizationId: "organization-1",
				projects: [],
				recentEvents: [],
				sessions: [],
				sessionsTruncated: input?.sessionsTruncated ?? false,
				stalenessThresholdMs: 300_000,
			},
			isError: input?.isError ?? false,
			isPending: false,
			refetch: input?.refetch ?? vi.fn(),
		},
	};
}

function createActivityView(input?: { isStale?: boolean }) {
	return {
		freshness: {
			asOfMs: Date.parse("2026-08-10T12:00:00.000Z"),
			isStale: input?.isStale ?? false,
			stalenessThresholdMs: 300_000,
		},
		setupState: "ready",
		stats: {
			agentTimeTodayMs: 60_000,
			sessionsToday: 1,
			workingNow: 1,
		},
	};
}
