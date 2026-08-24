import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrossPageHeader } from "./cross-page-header";

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

describe("CrossPageHeader", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders the app status label by default", () => {
		render(<CrossPageHeader showNavigation={false} />);

		expect(screen.getByText("Experimental")).toBeTruthy();
		expect(screen.getByRole("img", { name: "OpenMeld" })).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Go to OpenMeld homepage" }).className
		).toContain("max-lg:min-h-11");
	});

	it("allows Space chrome to hide the app status label", () => {
		render(<CrossPageHeader brandStatusLabel={null} showNavigation={false} />);

		expect(screen.queryByText("Experimental")).toBeNull();
	});
});
