// biome-ignore-all lint/performance/noBarrelFile: Stable test-support entrypoint for cross-package onboarding fixtures.

export {
  firstRunChooseSpaceOnboardingFacts,
  firstRunNameMissingOnboardingFacts,
  fullySetUpOnboardingFacts,
  joinedWithAddableAgentOnboardingFacts,
  joinedZeroAgentsOnboardingFacts,
  ONBOARDING_FIXTURE_AGENT_PROFILE_ID,
  ONBOARDING_FIXTURE_DISPLAY_NAME,
  ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
  ONBOARDING_FIXTURE_SECOND_AGENT_PROFILE_ID,
  ONBOARDING_FIXTURE_SPACE_ID,
  ONBOARDING_FIXTURE_USER_ID,
  onboardingAgentProfileFixture,
  onboardingHumanProfileFixture,
  signedOutOnboardingFacts,
} from "./onboarding-plan-fixtures";
