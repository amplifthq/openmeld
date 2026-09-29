import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationAccessDeniedPage } from "./organization-access-denied-page";

const desktop = vi.hoisted(() => ({ available: false }));

vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: () => (desktop.available ? {} : null),
}));
vi.mock("#/desktop/desktop-account-actions", () => ({
	DesktopAccountLogOutButton: () => <button type="button">Log out</button>,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

describe("Organization access recovery", () => {
	afterEach(() => {
		cleanup();
		desktop.available = false;
	});

	it.each([false, true])("uses the %s Desktop sign-out path", (native) => {
		desktop.available = native;
		render(
			<OrganizationAccessDeniedPage
				scope={{
					access: "denied",
					account: {},
					activeOrganization: null,
					currentUserId: "account-a",
					organizations: [],
					storageScope: "account-a",
				}}
			/>
		);
		expect(screen.queryByRole("link", { name: "Sign out" }) !== null).toBe(
			!native
		);
		expect(screen.queryByRole("button", { name: "Log out" }) !== null).toBe(
			native
		);
	});
});
