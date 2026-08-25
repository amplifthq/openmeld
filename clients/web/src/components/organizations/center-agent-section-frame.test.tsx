import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentSectionFrame } from "./center-agent-section-frame";

vi.mock("@tanstack/react-router", () => ({
	useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
		select({ location: { pathname: "/o/acme/center-agent/tasks" } }),
}));

vi.mock("#/components/app/app-main-content", () => ({
	AppMainContent: (input: { children: ReactNode; header: ReactNode }) => (
		<main>
			{input.header}
			{input.children}
		</main>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-acme", name: "Acme", slug: "acme" },
	}),
}));

vi.mock("./center-agent-header-navigation", () => ({
	CenterAgentHeaderMenu: () => <button type="button">Center Agent menu</button>,
	CenterAgentHeaderTabs: () => <nav>Center Agent tabs</nav>,
}));

afterEach(cleanup);

describe("CenterAgentSectionFrame", () => {
	it("reuses the Direct Message identity used by the Center Agent chat header", () => {
		const { container } = render(
			<CenterAgentSectionFrame>
				<p>Tasks content</p>
			</CenterAgentSectionFrame>
		);

		expect(
			container.querySelector('[data-space-header-icon="direct-message"]')
		).not.toBeNull();
		expect(
			screen.getByRole("heading", { level: 1, name: "Center Agent" })
		).toBeTruthy();
		expect(screen.queryByText("Direct Message")).toBeNull();
	});
});
