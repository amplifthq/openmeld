import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TermsOfServicePage } from "./terms-of-service-page";

const EXPERIMENTAL_SERVICE_PATTERN = /experimental service/i;
const CONNECTED_GOOGLE_ACCOUNT_PATTERN = /connected Google account/i;
const SUPPORT_EMAIL_PATTERN = /felix@amplift.ai/i;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("TermsOfServicePage", () => {
	it("publishes the experimental-service and connected-account boundaries", () => {
		render(<TermsOfServicePage />);

		expect(
			screen.getByRole("heading", { name: "Terms of Service" })
		).toBeTruthy();
		expect(
			screen.getAllByText(EXPERIMENTAL_SERVICE_PATTERN).length
		).toBeGreaterThan(0);
		expect(screen.getByText(CONNECTED_GOOGLE_ACCOUNT_PATTERN)).toBeTruthy();
		expect(screen.getAllByText(SUPPORT_EMAIL_PATTERN).length).toBeGreaterThan(
			0
		);
	});
});
