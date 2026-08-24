import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationHomeEmpty } from "./organization-home-ui";

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

afterEach(cleanup);

describe("OrganizationHomeEmpty", () => {
	it("keeps the empty-state action touchable without changing desktop density", () => {
		render(
			<OrganizationHomeEmpty
				actionHref="/projects"
				actionLabel="Open Projects"
				icon={<span aria-hidden="true" />}
				label="No projects yet"
			/>
		);

		const action = screen.getByRole("link", { name: "Open Projects" });
		expect(action.className).toContain("max-lg:min-h-11");
	});
});
