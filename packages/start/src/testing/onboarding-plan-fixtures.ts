import type {
  OnboardingAccountProfile,
  OnboardingFacts,
} from "@openmeld/schemas/types";

// Stable onboarding fact fixtures.
//
// The W1 planner tests and the future W2 (Web checklist) and W3 (CLI
// setup/doctor) parity tests all build from these named scenarios, so the
// renderer-parity check (onboarding.md Acceptance scenario 10) compares the
// same facts across surfaces. Keep the names and shapes stable.

export const ONBOARDING_FIXTURE_USER_ID = "user-onboarding-fixture";
export const ONBOARDING_FIXTURE_HUMAN_PROFILE_ID =
  "11111111-1111-4111-8111-111111111111";
export const ONBOARDING_FIXTURE_AGENT_PROFILE_ID =
  "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ONBOARDING_FIXTURE_SECOND_AGENT_PROFILE_ID =
  "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ONBOARDING_FIXTURE_SPACE_ID =
  "0000000000000000000000000000000000000000000000000000000000000001";
export const ONBOARDING_FIXTURE_DISPLAY_NAME = "Felix";

export function onboardingHumanProfileFixture(
  overrides: Partial<OnboardingAccountProfile> = {}
): OnboardingAccountProfile {
  return {
    profileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
    kind: "human",
    name: ONBOARDING_FIXTURE_DISPLAY_NAME,
    active: true,
    ...overrides,
  };
}

export function onboardingAgentProfileFixture(
  overrides: Partial<OnboardingAccountProfile> = {}
): OnboardingAccountProfile {
  return {
    profileId: ONBOARDING_FIXTURE_AGENT_PROFILE_ID,
    kind: "agent",
    name: "Felix's Claude",
    active: true,
    ...overrides,
  };
}

// Signed out. Only sign_in is knowable.
export function signedOutOnboardingFacts(): OnboardingFacts {
  return {
    auth: { signedIn: false },
    accountProfiles: [],
    space: null,
    device: { status: "unknown" },
    context: { kind: "none" },
  };
}

// Signed in, named, no Space chosen yet — first-run "choose where to work".
export function firstRunChooseSpaceOnboardingFacts(): OnboardingFacts {
  return {
    auth: {
      signedIn: true,
      userId: ONBOARDING_FIXTURE_USER_ID,
      actingProfileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
      actingDisplayName: ONBOARDING_FIXTURE_DISPLAY_NAME,
    },
    accountProfiles: [onboardingHumanProfileFixture()],
    space: null,
    device: { status: "not_connected" },
    context: { kind: "none" },
  };
}

// Signed in but the account has no usable display name yet (e.g. email signup).
export function firstRunNameMissingOnboardingFacts(): OnboardingFacts {
  return {
    auth: {
      signedIn: true,
      userId: ONBOARDING_FIXTURE_USER_ID,
      actingProfileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
      actingDisplayName: null,
    },
    accountProfiles: [onboardingHumanProfileFixture()],
    space: null,
    device: { status: "not_connected" },
    context: { kind: "none" },
  };
}

// Joined a Space, zero agent profiles, this computer not connected. The brand
// new user: bring_agents is blocked (no agent yet), connect is available.
export function joinedZeroAgentsOnboardingFacts(): OnboardingFacts {
  return {
    auth: {
      signedIn: true,
      userId: ONBOARDING_FIXTURE_USER_ID,
      actingProfileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
      actingDisplayName: ONBOARDING_FIXTURE_DISPLAY_NAME,
    },
    accountProfiles: [onboardingHumanProfileFixture()],
    space: {
      spaceId: ONBOARDING_FIXTURE_SPACE_ID,
      actingProfileIsMember: true,
      memberAgentProfileIds: [],
    },
    device: { status: "not_connected" },
    context: { kind: "none" },
  };
}

// Joined, has an agent profile not yet a member, this computer connected.
// bring_agents available, connect done.
export function joinedWithAddableAgentOnboardingFacts(): OnboardingFacts {
  return {
    auth: {
      signedIn: true,
      userId: ONBOARDING_FIXTURE_USER_ID,
      actingProfileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
      actingDisplayName: ONBOARDING_FIXTURE_DISPLAY_NAME,
    },
    accountProfiles: [
      onboardingHumanProfileFixture(),
      onboardingAgentProfileFixture(),
    ],
    space: {
      spaceId: ONBOARDING_FIXTURE_SPACE_ID,
      actingProfileIsMember: true,
      memberAgentProfileIds: [],
    },
    device: { status: "connected" },
    context: { kind: "none" },
  };
}

// Joined, the agent is already a member, this computer connected. Everything
// done.
export function fullySetUpOnboardingFacts(): OnboardingFacts {
  return {
    auth: {
      signedIn: true,
      userId: ONBOARDING_FIXTURE_USER_ID,
      actingProfileId: ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
      actingDisplayName: ONBOARDING_FIXTURE_DISPLAY_NAME,
    },
    accountProfiles: [
      onboardingHumanProfileFixture(),
      onboardingAgentProfileFixture(),
    ],
    space: {
      spaceId: ONBOARDING_FIXTURE_SPACE_ID,
      actingProfileIsMember: true,
      memberAgentProfileIds: [ONBOARDING_FIXTURE_AGENT_PROFILE_ID],
    },
    device: { status: "connected" },
    context: { kind: "none" },
  };
}
