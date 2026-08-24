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
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { OrganizationHomeInbox } from "./organization-home-inbox";

const getCurrentInboxSummaryMock = vi.hoisted(() => vi.fn());
const inboxPreviewProps = vi.hoisted(() => ({
	current: null as null | { actionLimit?: number; itemLimit?: number },
}));

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

vi.mock("#/components/inbox/organization-inbox-preview", () => ({
	OrganizationInboxPreview: (input: {
		actionLimit?: number;
		itemLimit?: number;
	}) => {
		inboxPreviewProps.current = input;
		return <div>Cached Inbox preview</div>;
	},
}));

vi.mock("#/lib/organizations/inbox", async (importOriginal) => ({
	...(await importOriginal()),
	getCurrentInboxSummary: getCurrentInboxSummaryMock,
}));

describe("OrganizationHomeInbox", () => {
	beforeEach(() => {
		inboxPreviewProps.current = null;
		getCurrentInboxSummaryMock.mockReset().mockResolvedValue(emptySummary());
	});

	afterEach(cleanup);

	it("keeps the Home preview bounded and attention focused", async () => {
		renderHomeInbox();

		expect(await screen.findByText("Cached Inbox preview")).toBeTruthy();
		expect(inboxPreviewProps.current).toEqual(
			expect.objectContaining({ actionLimit: 2, itemLimit: 4 })
		);
		expect(screen.getByTestId("home-inbox-preview").className).toContain(
			"max-h-80"
		);
	});

	it("omits the redundant caught-up status from the panel header", async () => {
		renderHomeInbox();

		expect(await screen.findByText("Cached Inbox preview")).toBeTruthy();
		expect(screen.queryByText("All caught up")).toBeNull();
		const openInboxLink = screen.getByRole("link", { name: "Open Inbox" });
		expect(openInboxLink.className).toContain("size-7");
		expect(openInboxLink.className).toContain("max-lg:size-11");
	});

	it("keeps meaningful Inbox status in the panel header", async () => {
		getCurrentInboxSummaryMock.mockResolvedValue({
			...emptySummary(),
			totalUnreadCount: 2,
		});

		renderHomeInbox();

		expect(await screen.findByText("2 unread")).toBeTruthy();
	});

	it("keeps cached content but surfaces and retries a failed summary refresh", async () => {
		const { queryClient } = renderHomeInbox();

		expect(await screen.findByText("Cached Inbox preview")).toBeTruthy();
		expect(screen.queryByText("All caught up")).toBeNull();

		getCurrentInboxSummaryMock.mockRejectedValue(
			new Error("Inbox summary unavailable.")
		);
		await queryClient.refetchQueries({
			queryKey: inboxQueryKeys.summary("organization-1"),
		});

		expect(await screen.findByText("Inbox may be out of date.")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();
		expect(screen.queryByText("All caught up")).toBeNull();
		expect(screen.getByText("Cached Inbox preview")).toBeTruthy();

		const callsBeforeRetry = getCurrentInboxSummaryMock.mock.calls.length;
		getCurrentInboxSummaryMock.mockResolvedValue(emptySummary());
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(getCurrentInboxSummaryMock.mock.calls.length).toBeGreaterThan(
				callsBeforeRetry
			)
		);
		await waitFor(() =>
			expect(screen.queryByText("Inbox may be out of date.")).toBeNull()
		);
		expect(screen.queryByText("All caught up")).toBeNull();
	});
});

function renderHomeInbox() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<OrganizationHomeInbox
					currentOrganization={{
						id: "organization-1",
						name: "Amplift",
						slug: "amplift",
					}}
				/>
			</QueryClientProvider>
		),
	};
}

function emptySummary() {
	return {
		organizationId: "organization-1",
		totalUnreadCount: 0,
		unresolvedActionCount: 0,
	};
}
