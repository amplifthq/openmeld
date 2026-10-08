import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PrivacyPolicyPage } from "./privacy-policy-page";

const NO_SALE_TEXT_PATTERN = /We do not sell personal information/i;
const PRIVACY_EMAIL_TEXT_PATTERN = /felix@amplift.ai/i;
const GOOGLE_WORKSPACE_TEXT_PATTERN =
	/Gmail, Google Calendar, or Google Drive/i;
const GOOGLE_LIMITED_USE_TEXT_PATTERN =
	/Google API Services User Data Policy, including the Limited Use requirements/i;
const GOOGLE_READ_ONLY_TEXT_PATTERN =
	/read-only access to Gmail, Google Calendar, and Google Drive/i;
const HOSTED_PROCESSING_PATTERN =
	/Relevant content is sent to the selected model/i;
const ACTIVITY_EXCLUSION_PATTERN =
	/Agent Activity does not upload full prompts/i;
const DELETION_PENDING_PATTERN =
	/Storage or provider failures can leave cleanup pending/i;
const RETAINED_TEAM_CONTENT_PATTERN =
	/Shared messages, published Files, Skills, revisions, and audit attribution remain/i;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("PrivacyPolicyPage", () => {
	it("publishes AI processing, Google access, and deletion disclosures", () => {
		render(<PrivacyPolicyPage />);

		expect(
			screen.getByRole("heading", { name: "Privacy Policy" })
		).toBeTruthy();
		expect(screen.getByText(NO_SALE_TEXT_PATTERN)).toBeTruthy();
		expect(
			screen.getAllByText(PRIVACY_EMAIL_TEXT_PATTERN).length
		).toBeGreaterThan(0);
		expect(screen.getByText(GOOGLE_WORKSPACE_TEXT_PATTERN)).toBeTruthy();
		expect(screen.getByText(GOOGLE_LIMITED_USE_TEXT_PATTERN)).toBeTruthy();
		expect(screen.getByText(GOOGLE_READ_ONLY_TEXT_PATTERN)).toBeTruthy();
		expect(screen.getByText(HOSTED_PROCESSING_PATTERN)).toBeTruthy();
		expect(screen.getByText(ACTIVITY_EXCLUSION_PATTERN)).toBeTruthy();
		expect(screen.getByText(DELETION_PENDING_PATTERN)).toBeTruthy();
		expect(screen.getByText(RETAINED_TEAM_CONTENT_PATTERN)).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Terms of Service" })
				.getAttribute("href")
		).toBe("/terms");
		expect(
			screen.getByRole("link", { name: "Contact us" }).getAttribute("href")
		).toBe("mailto:felix@amplift.ai");
	});
});
