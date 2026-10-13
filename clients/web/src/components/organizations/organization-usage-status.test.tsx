import type { OrganizationAiBilling } from "@openmeld/schemas/types";
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

const { readBilling, updateBilling } = vi.hoisted(() => ({
	readBilling: vi.fn(),
	updateBilling: vi.fn(),
}));
vi.mock("#/lib/organizations/organization-usage", () => ({
	readOrganizationAiBilling: readBilling,
	updateOrganizationAiBilling: updateBilling,
}));
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

const free: OrganizationAiBilling = {
	plan: "free",
	source: "free",
	policyVersion: "2026-10-v1",
	monthlyCredits: 5000,
	usedCredits: 2,
	remainingCredits: 4998,
	resetsAt: "2026-11-01T00:00:00.000Z",
	keySuffix: null,
	canManage: true,
	status: "available",
};
function renderBilling(billing = free) {
	readBilling.mockResolvedValue(billing);
	return render(
		<TestQueryClientProvider>
			<OrganizationUsageStatus organizationId="org-1" />
		</TestQueryClientProvider>
	);
}

describe("workspace funding settings", () => {
	it("changes the active source only after saving, clears the draft, and restores the retained allowance on removal", async () => {
		renderBilling();
		fireEvent.click(
			await screen.findByRole("button", { name: "Use your own key" })
		);
		fireEvent.change(screen.getByLabelText("API key"), {
			target: { value: "sk-or-disposable-test-1234" },
		});
		updateBilling.mockResolvedValueOnce({
			...free,
			source: "byok",
			keySuffix: "1234",
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));
		expect(await screen.findByText("BYOK")).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByText("OpenRouter · ••••1234")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Manage key" }));
		expect(
			(screen.getByLabelText("Replace API key") as HTMLInputElement).value
		).toBe("");
		updateBilling.mockResolvedValueOnce(free);
		fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
		expect(await screen.findByText("4,998 / 5,000 credits left")).toBeTruthy();
		expect(screen.queryByText("BYOK")).toBeNull();
		expect(updateBilling).toHaveBeenLastCalledWith({
			organizationId: "org-1",
			settings: { source: "free" },
		});
	});
	it("keeps the active funding source and dialog when saving fails", async () => {
		renderBilling();
		fireEvent.click(
			await screen.findByRole("button", { name: "Use your own key" })
		);
		fireEvent.change(screen.getByLabelText("API key"), {
			target: { value: "sk-or-invalid-test" },
		});
		updateBilling.mockRejectedValueOnce(new Error("Network unavailable"));
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.queryByText("BYOK")).toBeNull();
	});
	it("does not offer key mutation to a member without billing permission", async () => {
		renderBilling({
			...free,
			canManage: false,
			source: "byok",
			keySuffix: "1234",
			status: "unavailable",
		});
		expect(await screen.findByText("BYOK")).toBeTruthy();
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Manage key" })).toBeNull();
		expect(updateBilling).not.toHaveBeenCalled();
	});
});
