import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";

const preview = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
const accept = vi.hoisted(() => vi.fn());
const organizations = vi.hoisted(() => vi.fn());
let session = vi.hoisted(() => ({
	data: { user: { id: "user-1", email: "alex@example.com" } } as {
		user: { id: string; email: string };
	} | null,
	isPending: false,
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (config: unknown) => config,
	useLocation: () => ({ href: "/join-organization" }),
	Link: ({
		children,
		to,
		search,
	}: {
		children: ReactNode;
		to: string;
		search?: { redirect?: string };
	}) => (
		<a data-redirect={search?.redirect} href={to}>
			{children}
		</a>
	),
}));
vi.mock("#/components/auth/auth-page-shell", () => ({
	AuthPageShell: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));
vi.mock("#/hooks/auth.hooks", () => ({ useAuthSession: () => session }));
vi.mock("#/lib/organizations/auth-organizations", () => ({
	previewOrganizationJoinLink: preview,
	listOrganizations: organizations,
	acceptOrganizationJoinLink: accept,
}));
vi.mock("#/lib/organizations/organization-join-requests", () => ({
	requestOrganizationJoinRequests: request,
}));

import { JoinOrganizationPage } from "./join-organization";

const token = `joinlink_${"a".repeat(64)}`;
const href = `/join-organization?token=${token}`;
const submittedText = /We’ve notified the owners and admins/;
const inactiveText = /no longer active/;
function page() {
	render(
		<TestQueryClientProvider>
			<JoinOrganizationPage locationHref={href} token={token} />
		</TestQueryClientProvider>
	);
}
describe("approval-required link entry", () => {
	beforeEach(() => {
		preview.mockReset().mockResolvedValue({
			ok: true,
			active: true,
			organizationName: "Harbor Design",
			organizationSlug: "harbor",
		});
		organizations.mockReset().mockResolvedValue([]);
		request
			.mockReset()
			.mockResolvedValue([{ id: "request-1", status: "pending" }]);
		session = {
			data: { user: { id: "user-1", email: "alex@example.com" } },
			isPending: false,
		};
	});
	afterEach(cleanup);
	it("preserves the destination across sign-in without submitting a request", async () => {
		session.data = null;
		page();
		expect(
			(
				await screen.findByRole("link", {
					name: "Sign in to request to join",
				})
			).getAttribute("data-redirect")
		).toBe(href);
		expect(request).not.toHaveBeenCalled();
	});
	it("requires an explicit request and does not turn submission into membership navigation", async () => {
		page();
		const button = await screen.findByRole("button", {
			name: "Request to join",
		});
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
		expect(request).not.toHaveBeenCalled();
		fireEvent.click(button);
		await screen.findByText(submittedText);
		expect(request).toHaveBeenCalledWith({ token });
		expect(
			screen.getByRole("link", { name: "View request" }).getAttribute("href")
		).toBe("/invitation-requests?requestId=request-1");
		expect(
			screen.queryByRole("link", { name: "Open organization" })
		).toBeNull();
	});
	it("offers existing members their organization without creating an invitation", async () => {
		organizations.mockResolvedValue([
			{ id: "org-1", name: "Harbor Design", slug: "harbor" },
		]);
		page();
		expect(
			(
				await screen.findByRole("link", { name: "Open organization" })
			).getAttribute("href")
		).toBe("/o/harbor/spaces");
		expect(request).not.toHaveBeenCalled();
	});
	it("does not offer an action for a revoked link", async () => {
		preview.mockResolvedValue({ ok: true, active: false });
		page();
		await screen.findByText(inactiveText);
		expect(
			screen.queryByRole("button", { name: "Request to join" })
		).toBeNull();
		expect(request).not.toHaveBeenCalled();
	});
});
