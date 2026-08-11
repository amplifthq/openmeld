import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	type RenderResult,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import {
	type OrganizationScopedQueryLike,
	useOrganizationMembershipSelfHeal,
} from "./organization-membership-self-heal";

const listOrganizationsMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/auth-organizations", () => ({
	listOrganizations: () => listOrganizationsMock(),
}));

const CURRENT_ORGANIZATION: OrganizationSummary = {
	id: "org-beta",
	name: "Beta",
	slug: "beta",
};

const activeRenders = new Set<RenderResult>();

function membershipFailure(): StructuredApiClientFailure {
	return {
		code: "organization.membership_required",
		message: "You are not a member of the requested organization.",
		requestId: "req-1",
		status: 403,
		upstreamCode: null,
	};
}

function genericFailure(): StructuredApiClientFailure {
	return {
		code: "space_index.store_unavailable",
		message: "The Space index is temporarily unavailable.",
		requestId: "req-2",
		status: 503,
		upstreamCode: null,
	};
}

function healthyQuery(
	refetch: () => Promise<unknown> = vi.fn()
): OrganizationScopedQueryLike {
	return { error: null, errorUpdatedAt: 0, isError: false, refetch };
}

function failingQuery(input: {
	error: StructuredApiClientFailure;
	errorUpdatedAt?: number;
	refetch: () => Promise<unknown>;
}): OrganizationScopedQueryLike {
	return {
		error: input.error,
		errorUpdatedAt: input.errorUpdatedAt ?? 1,
		isError: true,
		refetch: input.refetch,
	};
}

function Harness(input: { query: OrganizationScopedQueryLike }) {
	const { status } = useOrganizationMembershipSelfHeal({
		currentOrganization: CURRENT_ORGANIZATION,
		query: input.query,
	});
	return <output data-testid="status">{status}</output>;
}

function renderHarness(query: OrganizationScopedQueryLike) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrap = (child: ReactNode) => (
		<QueryClientProvider client={client}>{child}</QueryClientProvider>
	);
	const result = render(wrap(<Harness query={query} />));
	activeRenders.add(result);
	const readStatus = () =>
		within(result.container).getByTestId("status").textContent;
	return {
		readStatus,
		rerender: (next: OrganizationScopedQueryLike) =>
			result.rerender(wrap(<Harness query={next} />)),
	};
}

describe("useOrganizationMembershipSelfHeal", () => {
	beforeEach(() => {
		listOrganizationsMock.mockReset();
	});

	afterEach(() => {
		for (const result of activeRenders) {
			result.unmount();
		}
		activeRenders.clear();
		vi.restoreAllMocks();
	});

	it("stays inactive for a healthy query", () => {
		const { readStatus } = renderHarness(healthyQuery());

		expect(readStatus()).toBe("inactive");
		expect(listOrganizationsMock).not.toHaveBeenCalled();
	});

	it("revalidates exactly once when the URL organization is still a membership", async () => {
		listOrganizationsMock.mockResolvedValue([CURRENT_ORGANIZATION]);
		const refetch = vi.fn().mockResolvedValue(undefined);

		const { readStatus } = renderHarness(
			failingQuery({ error: membershipFailure(), refetch })
		);

		await waitFor(() => {
			expect(readStatus()).toBe("recovering");
		});
		expect(listOrganizationsMock).toHaveBeenCalledTimes(1);
		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it("reports access-denied when the URL organization is no longer a membership", async () => {
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-other", name: "Other", slug: "other" },
		]);
		const refetch = vi.fn().mockResolvedValue(undefined);

		const { readStatus } = renderHarness(
			failingQuery({ error: membershipFailure(), refetch })
		);

		await waitFor(() => {
			expect(readStatus()).toBe("access-denied");
		});
		expect(refetch).not.toHaveBeenCalled();
	});

	it("reports failed when the repair itself throws", async () => {
		listOrganizationsMock.mockRejectedValue(new Error("network down"));
		const refetch = vi.fn().mockResolvedValue(undefined);

		const { readStatus } = renderHarness(
			failingQuery({ error: membershipFailure(), refetch })
		);

		await waitFor(() => {
			expect(readStatus()).toBe("failed");
		});
	});

	it("does not self-heal a non-membership failure", () => {
		const { readStatus } = renderHarness(
			failingQuery({ error: genericFailure(), refetch: vi.fn() })
		);

		expect(readStatus()).toBe("inactive");
		expect(listOrganizationsMock).not.toHaveBeenCalled();
	});

	it("settles on a terminal error and does not loop when a post-repair refetch still fails", async () => {
		listOrganizationsMock.mockResolvedValue([CURRENT_ORGANIZATION]);
		const refetch = vi.fn().mockResolvedValue(undefined);

		const { readStatus, rerender } = renderHarness(
			failingQuery({ error: membershipFailure(), errorUpdatedAt: 1, refetch })
		);

		await waitFor(() => {
			expect(readStatus()).toBe("recovering");
		});

		// The refetch resolved but the query still reports the same membership
		// mismatch (a newer errorUpdatedAt): the repair must not run a second time.
		act(() => {
			rerender(
				failingQuery({ error: membershipFailure(), errorUpdatedAt: 2, refetch })
			);
		});

		await waitFor(() => {
			expect(readStatus()).toBe("failed");
		});
		expect(listOrganizationsMock).toHaveBeenCalledTimes(1);
	});

	it("returns to inactive when a repaired query starts succeeding", async () => {
		listOrganizationsMock.mockResolvedValue([CURRENT_ORGANIZATION]);
		const refetch = vi.fn().mockResolvedValue(undefined);

		const { readStatus, rerender } = renderHarness(
			failingQuery({ error: membershipFailure(), refetch })
		);

		await waitFor(() => {
			expect(readStatus()).toBe("recovering");
		});

		act(() => {
			rerender(healthyQuery(refetch));
		});

		await waitFor(() => {
			expect(readStatus()).toBe("inactive");
		});
	});
});
