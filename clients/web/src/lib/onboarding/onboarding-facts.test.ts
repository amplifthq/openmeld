import { buildOnboardingPlan } from "@openmeld/start";
import {
	firstRunChooseSpaceOnboardingFacts,
	firstRunNameMissingOnboardingFacts,
	fullySetUpOnboardingFacts,
	joinedWithAddableAgentOnboardingFacts,
	joinedZeroAgentsOnboardingFacts,
	ONBOARDING_FIXTURE_AGENT_PROFILE_ID,
	ONBOARDING_FIXTURE_DISPLAY_NAME,
	ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
	ONBOARDING_FIXTURE_SPACE_ID,
	ONBOARDING_FIXTURE_USER_ID,
	onboardingAgentProfileFixture,
	onboardingHumanProfileFixture,
	signedOutOnboardingFacts,
} from "@openmeld/start/testing";
import { describe, expect, it } from "vitest";
import {
	type OnboardingFactsInput,
	resolveOnboardingFacts,
} from "./onboarding-facts";

const signedInSession = {
	signedIn: true,
	userId: ONBOARDING_FIXTURE_USER_ID,
	actingProfileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
	actingDisplayName: ONBOARDING_FIXTURE_DISPLAY_NAME,
} satisfies OnboardingFactsInput["session"];

// Each case: a normalized Web input that must resolve to the matching shared
// fixture. This pins renderer parity (onboarding.md Acceptance #10/#13) — the
// Web mapping produces the exact facts the CLI/agent renderers also build, so
// all surfaces render the same plan from one engine.
const PARITY_CASES: ReadonlyArray<{
	name: string;
	input: OnboardingFactsInput;
	expected: () => ReturnType<typeof signedOutOnboardingFacts>;
}> = [
	{
		name: "signed out",
		input: {
			session: {
				signedIn: false,
				userId: null,
				actingProfileId: null,
				actingDisplayName: null,
			},
			accountProfiles: [],
			space: null,
			deviceStatus: "unknown",
		},
		expected: signedOutOnboardingFacts,
	},
	{
		name: "first run, choose space",
		input: {
			session: signedInSession,
			accountProfiles: [onboardingHumanProfileFixture()],
			space: null,
			deviceStatus: "not_connected",
		},
		expected: firstRunChooseSpaceOnboardingFacts,
	},
	{
		name: "first run, name missing",
		input: {
			session: { ...signedInSession, actingDisplayName: null },
			accountProfiles: [onboardingHumanProfileFixture()],
			space: null,
			deviceStatus: "not_connected",
		},
		expected: firstRunNameMissingOnboardingFacts,
	},
	{
		name: "joined, zero agents",
		input: {
			session: signedInSession,
			accountProfiles: [onboardingHumanProfileFixture()],
			space: {
				spaceId: ONBOARDING_FIXTURE_SPACE_ID,
				actingProfileIsMember: true,
				memberAgentProfileIds: [],
			},
			deviceStatus: "not_connected",
		},
		expected: joinedZeroAgentsOnboardingFacts,
	},
	{
		name: "joined, addable agent",
		input: {
			session: signedInSession,
			accountProfiles: [
				onboardingHumanProfileFixture(),
				onboardingAgentProfileFixture(),
			],
			space: {
				spaceId: ONBOARDING_FIXTURE_SPACE_ID,
				actingProfileIsMember: true,
				memberAgentProfileIds: [],
			},
			deviceStatus: "connected",
		},
		expected: joinedWithAddableAgentOnboardingFacts,
	},
	{
		name: "fully set up",
		input: {
			session: signedInSession,
			accountProfiles: [
				onboardingHumanProfileFixture(),
				onboardingAgentProfileFixture(),
			],
			space: {
				spaceId: ONBOARDING_FIXTURE_SPACE_ID,
				actingProfileIsMember: true,
				memberAgentProfileIds: [ONBOARDING_FIXTURE_AGENT_PROFILE_ID],
			},
			deviceStatus: "connected",
		},
		expected: fullySetUpOnboardingFacts,
	},
];

describe("resolveOnboardingFacts", () => {
	it.each(PARITY_CASES)("resolves the $name web input to the shared fixture", ({
		input,
		expected,
	}) => {
		expect(resolveOnboardingFacts(input)).toEqual(expected());
	});

	it.each(
		PARITY_CASES
	)("drives buildOnboardingPlan to the fixture's plan for $name", ({
		input,
		expected,
	}) => {
		expect(buildOnboardingPlan(resolveOnboardingFacts(input))).toEqual(
			buildOnboardingPlan(expected())
		);
	});

	it("degrades a signed-in session with no acting profile to signed-out", () => {
		const facts = resolveOnboardingFacts({
			session: {
				signedIn: true,
				userId: ONBOARDING_FIXTURE_USER_ID,
				actingProfileId: null,
				actingDisplayName: ONBOARDING_FIXTURE_DISPLAY_NAME,
			},
			accountProfiles: [],
			space: null,
			deviceStatus: "unknown",
		});

		expect(facts.auth).toEqual({ signedIn: false });
	});

	it("defaults a missing context slot to none", () => {
		const facts = resolveOnboardingFacts({
			session: signedInSession,
			accountProfiles: [onboardingHumanProfileFixture()],
			space: null,
			deviceStatus: "not_connected",
		});

		expect(facts.context).toEqual({ kind: "none" });
	});

	it("passes a web setup handoff context through unchanged", () => {
		const facts = resolveOnboardingFacts({
			session: signedInSession,
			accountProfiles: [onboardingHumanProfileFixture()],
			space: null,
			deviceStatus: "not_connected",
			context: { kind: "web_setup_handoff", startSessionToken: "tok_123" },
		});

		expect(facts.context).toEqual({
			kind: "web_setup_handoff",
			startSessionToken: "tok_123",
		});
	});
});
