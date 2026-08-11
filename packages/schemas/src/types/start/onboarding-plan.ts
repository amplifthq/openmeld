import type { z } from "zod/v4";

type OnboardingActionIdSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingActionIdSchema"];
type OnboardingDecisionStatusSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingDecisionStatusSchema"];
type OnboardingReasonCodeSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingReasonCodeSchema"];
type OnboardingPlanDecisionSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingPlanDecisionSchema"];
type OnboardingPlanSummarySchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingPlanSummarySchema"];
type OnboardingPlanSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingPlanSchema"];
type OnboardingProfileKindSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingProfileKindSchema"];
type OnboardingAccountProfileSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingAccountProfileSchema"];
type OnboardingAuthFactSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingAuthFactSchema"];
type OnboardingSpaceContextSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingSpaceContextSchema"];
type OnboardingDeviceStatusSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingDeviceStatusSchema"];
type OnboardingDeviceFactSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingDeviceFactSchema"];
type OnboardingContextSlotSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingContextSlotSchema"];
type OnboardingFactsSchema =
  typeof import("../../schemas/start/onboarding-plan")["onboardingFactsSchema"];

export type OnboardingActionId = z.infer<OnboardingActionIdSchema>;
export type OnboardingDecisionStatus = z.infer<OnboardingDecisionStatusSchema>;
export type OnboardingReasonCode = z.infer<OnboardingReasonCodeSchema>;
export type OnboardingPlanDecision = z.infer<OnboardingPlanDecisionSchema>;
export type OnboardingPlanSummary = z.infer<OnboardingPlanSummarySchema>;
export type OnboardingPlan = z.infer<OnboardingPlanSchema>;
export type OnboardingProfileKind = z.infer<OnboardingProfileKindSchema>;
export type OnboardingAccountProfile = z.infer<OnboardingAccountProfileSchema>;
export type OnboardingAuthFact = z.infer<OnboardingAuthFactSchema>;
export type OnboardingSpaceContext = z.infer<OnboardingSpaceContextSchema>;
export type OnboardingDeviceStatus = z.infer<OnboardingDeviceStatusSchema>;
export type OnboardingDeviceFact = z.infer<OnboardingDeviceFactSchema>;
export type OnboardingContextSlot = z.infer<OnboardingContextSlotSchema>;
export type OnboardingFacts = z.infer<OnboardingFactsSchema>;
