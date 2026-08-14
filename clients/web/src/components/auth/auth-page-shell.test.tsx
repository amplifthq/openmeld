import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthPageShell } from "./auth-page-shell";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("AuthPageShell", () => {
	it("keeps the public legal pages available before login", () => {
		render(
			<AuthPageShell>
				<div>Login card</div>
			</AuthPageShell>
		);

		expect(screen.getByText("Login card")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")
		).toBe("/privacy");
		expect(
			screen
				.getByRole("link", { name: "Terms of Service" })
				.getAttribute("href")
		).toBe("/terms");
	});
});
