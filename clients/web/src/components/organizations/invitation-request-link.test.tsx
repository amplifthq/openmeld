import type { OrganizationJoinLink } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	revoke: vi.fn(),
	request: vi.fn(),
}));
vi.mock("#/lib/organizations/auth-organizations", () => ({
	getOrganizationJoinLink: mocks.get,
	revokeOrganizationJoinLink: mocks.revoke,
	prepareOrganizationJoinLink: mocks.request,
	ensureOrganizationJoinLink: mocks.request,
	resetOrganizationJoinLink: mocks.request,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({ currentUserId: "owner-1" }),
}));

import { InvitationRequestLink } from "./invitation-request-link";

const token = `joinlink_${"a".repeat(64)}`;
const link: OrganizationJoinLink = {
	id: "invite-1",
	token,
	url: `https://example.com/join-organization?token=${token}`,
	organizationId: "org-1",
	spaceId: "space-1",
	mode: "direct",
	role: "member",
	createdBy: "owner-1",
	createdAt: "2026-09-10T00:00:00.000Z",
	expiresAt: "2026-10-10T00:00:00.000Z",
};
function mount(canManage = true) {
	return render(
		<TestQueryClientProvider>
			<InvitationRequestLink
				canManage={canManage}
				organizationId="org-1"
				spaceId="space-1"
			/>
		</TestQueryClientProvider>
	);
}

describe("InvitationRequestLink", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.get.mockResolvedValue(null);
		mocks.request.mockResolvedValue(link);
		mocks.revoke.mockResolvedValue(true);
	});
	afterEach(cleanup);

	it("prepares the server-owned Space invite link on each mount", async () => {
		const view = mount();
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		expect(mocks.request).toHaveBeenCalledTimes(1);
		view.unmount();
		mount();
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		expect(mocks.request).toHaveBeenCalledTimes(2);
		expect(mocks.request.mock.calls[0][0]).toMatchObject({
			spaceId: "space-1",
			mode: "direct",
		});
	});

	it("restores a created link from the server after the panel is discarded", async () => {
		const view = mount();
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		mocks.get.mockResolvedValue(link);
		view.unmount();
		mount();
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		expect(mocks.request).toHaveBeenCalledTimes(2);
		expect(mocks.request.mock.calls[0][0]).toMatchObject({
			mode: "direct",
			spaceId: "space-1",
		});
	});

	it("clears a revoked link and reads its absence after remount", async () => {
		mocks.get.mockResolvedValue(link);
		const view = mount();
		fireEvent.click(await screen.findByRole("button", { name: "Revoke link" }));
		await waitFor(() =>
			expect(screen.queryByDisplayValue(link.url)).toBeNull()
		);
		expect(mocks.revoke).toHaveBeenCalledWith({
			organizationId: "org-1",
			spaceId: "space-1",
			mode: "direct",
		});
		mocks.request.mockResolvedValue(null);
		view.unmount();
		mount();
		expect(
			await screen.findByRole("button", { name: "Renew link" })
		).toBeTruthy();
	});

	it("does not mistake a failed read for an absent link and retries", async () => {
		mocks.request.mockRejectedValueOnce(new Error("Offline"));
		mount();
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Renew link" })).toBeNull();
		mocks.get.mockResolvedValue(link);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
	});

	it("reads only the approval-required link for ordinary members", async () => {
		mocks.request.mockResolvedValue({ ...link, mode: "request" });
		mount(false);
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		expect(mocks.request.mock.calls[0][0]).toMatchObject({
			organizationId: "org-1",
			spaceId: "space-1",
			mode: "request",
		});
		expect(screen.queryByRole("button", { name: "Revoke link" })).toBeNull();
	});
});
