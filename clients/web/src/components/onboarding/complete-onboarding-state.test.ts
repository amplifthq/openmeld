import { describe, expect, it } from "vitest";
import { shouldLoadTeamOnboardingState } from "./complete-onboarding-state";

describe("shouldLoadTeamOnboardingState", () => {
	it("keeps team-only queries disabled for Personal Workspace", () => {
		expect(
			shouldLoadTeamOnboardingState({
				enabled: true,
				isPersonal: true,
			})
		).toBe(false);
	});

	it("loads team-only state for an organization Ready screen", () => {
		expect(
			shouldLoadTeamOnboardingState({
				enabled: true,
				isPersonal: false,
			})
		).toBe(true);
	});
});
