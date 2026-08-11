import type {
	OnboardingAccountProfile,
	OnboardingFacts,
} from "@openmeld/schemas/types";

/**
 * Web-side inputs for the onboarding planner, normalized from the existing
 * auth / members / local-runtime read models. Kept deliberately minimal and
 * source-shaped so the mapping stays a pure, drift-resistant function: every
 * renderer (W2 Web, later Desktop) feeds the same fact families to the single
 * `buildOnboardingPlan` engine instead of re-deriving onboarding rules.
 */
export type OnboardingFactsInput = {
	session: {
		signedIn: boolean;
		userId: string | null;
		actingProfileId: string | null;
		actingDisplayName: string | null;
	};
	accountProfiles: readonly OnboardingAccountProfile[];
	space: OnboardingFacts["space"];
	deviceStatus: OnboardingFacts["device"]["status"];
	context?: OnboardingFacts["context"];
};

/**
 * Assemble `OnboardingFacts` for `buildOnboardingPlan`. Pure: no fetching, no
 * React, no clock. The only judgement here is the auth guard — a session that
 * claims to be signed in but is missing its acting profile or user id cannot
 * drive any onboarding action, so it degrades to signed-out rather than
 * emitting half-built signed-in facts.
 */
export function resolveOnboardingFacts(
	input: OnboardingFactsInput
): OnboardingFacts {
	return {
		auth: resolveAuthFacts(input.session),
		accountProfiles: [...input.accountProfiles],
		space: input.space,
		device: { status: input.deviceStatus },
		context: input.context ?? { kind: "none" },
	};
}

function resolveAuthFacts(
	session: OnboardingFactsInput["session"]
): OnboardingFacts["auth"] {
	if (!(session.signedIn && session.userId && session.actingProfileId)) {
		return { signedIn: false };
	}

	return {
		signedIn: true,
		userId: session.userId,
		actingProfileId: session.actingProfileId,
		actingDisplayName: session.actingDisplayName,
	};
}
