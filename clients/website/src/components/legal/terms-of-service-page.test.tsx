import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TermsOfServicePage } from "./terms-of-service-page";

const CONNECTED_GOOGLE_ACCOUNT_PATTERN = /connected Google account/i;
const SUPPORT_EMAIL_PATTERN = /felix@amplift.ai/i;
const STOP_EFFECT_PATTERN =
	/A stop request does not reverse completed actions/i;
const CONTENT_RIGHTS_PATTERN = /You retain your rights in submitted content/i;
const COST_DISPLAY_PATTERN =
	/A usage display or estimated model cost is not an invoice/i;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("TermsOfServicePage", () => {
	it("publishes authorization, content rights, and cost boundaries", () => {
		render(<TermsOfServicePage />);

		expect(
			screen.getByRole("heading", { name: "Terms of Service" })
		).toBeTruthy();
		expect(screen.getByText(CONNECTED_GOOGLE_ACCOUNT_PATTERN)).toBeTruthy();
		expect(screen.getByText(STOP_EFFECT_PATTERN)).toBeTruthy();
		expect(screen.getByText(CONTENT_RIGHTS_PATTERN)).toBeTruthy();
		expect(screen.getByText(COST_DISPLAY_PATTERN)).toBeTruthy();
		expect(screen.getAllByText(SUPPORT_EMAIL_PATTERN).length).toBeGreaterThan(
			0
		);
		expect(
			screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")
		).toBe("/privacy");
	});
});
