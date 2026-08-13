import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PrivacyPolicyPage } from "./privacy-policy-page";

const EXPERIMENTAL_TEXT_PATTERN = /experimental/i;
const MIT_LICENSE_TEXT_PATTERN = /MIT-licensed open-source software/i;
const NO_SALE_TEXT_PATTERN = /We do not sell personal information/i;
const LOCAL_SERVICE_TEXT_PATTERN = /local OpenMeld Service/i;
const PRIVACY_EMAIL_TEXT_PATTERN = /felix@amplift.ai/i;
const GOOGLE_WORKSPACE_TEXT_PATTERN =
	/Gmail, Google Calendar, or Google Drive/i;
const GOOGLE_LIMITED_USE_TEXT_PATTERN =
	/Google API Services User Data Policy, including the Limited Use requirements/i;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("PrivacyPolicyPage", () => {
	it("publishes the experimental, open-source, and data-use boundaries", () => {
		render(<PrivacyPolicyPage />);

		expect(
			screen.getByRole("heading", { name: "Privacy Policy" })
		).toBeTruthy();
		expect(
			screen.getAllByText(EXPERIMENTAL_TEXT_PATTERN).length
		).toBeGreaterThan(0);
		expect(screen.getByText(MIT_LICENSE_TEXT_PATTERN)).toBeTruthy();
		expect(screen.getByText(NO_SALE_TEXT_PATTERN)).toBeTruthy();
		expect(
			screen.getAllByText(LOCAL_SERVICE_TEXT_PATTERN).length
		).toBeGreaterThan(0);
		expect(
			screen.getAllByText(PRIVACY_EMAIL_TEXT_PATTERN).length
		).toBeGreaterThan(0);
		expect(screen.getByText(GOOGLE_WORKSPACE_TEXT_PATTERN)).toBeTruthy();
		expect(screen.getByText(GOOGLE_LIMITED_USE_TEXT_PATTERN)).toBeTruthy();
	});
});
