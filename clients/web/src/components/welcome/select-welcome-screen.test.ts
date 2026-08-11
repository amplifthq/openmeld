import { buildOnboardingPlan } from "@openmeld/start";
import {
	firstRunChooseSpaceOnboardingFacts,
	firstRunNameMissingOnboardingFacts,
	fullySetUpOnboardingFacts,
} from "@openmeld/start/testing";
import { describe, expect, it } from "vitest";
import { selectWelcomeScreen } from "./select-welcome-screen";

describe("selectWelcomeScreen", () => {
	it("shows the name screen when the display name is still missing", () => {
		const plan = buildOnboardingPlan(firstRunNameMissingOnboardingFacts());
		expect(selectWelcomeScreen(plan)).toBe("name");
	});

	it("shows the space screen when named but no place to work yet", () => {
		const plan = buildOnboardingPlan(firstRunChooseSpaceOnboardingFacts());
		expect(selectWelcomeScreen(plan)).toBe("space");
	});

	it("is done when nothing is actionable", () => {
		const plan = buildOnboardingPlan(fullySetUpOnboardingFacts());
		expect(selectWelcomeScreen(plan)).toBe("done");
	});
});
