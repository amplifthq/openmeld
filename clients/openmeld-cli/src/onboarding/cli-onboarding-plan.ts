import type {
  OnboardingAccountProfile,
  OnboardingFacts,
  OnboardingPlan,
} from "@openmeld/schemas/types";
import { buildOnboardingPlan } from "@openmeld/start";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import type { StartReadinessSnapshot } from "../start-local/readiness-types";

export type CliOnboardingPlan = {
  facts: OnboardingFacts;
  plan: OnboardingPlan;
};

export async function resolveCliSetupOnboardingPlan(input: {
  profile?: string;
  readiness?: StartReadinessSnapshot;
  deviceStatus?: OnboardingFacts["device"]["status"];
}): Promise<CliOnboardingPlan> {
  const profile = await resolveOpenMeldProfileOrNull({
    ...(input.profile ? { openMeldProfileId: input.profile } : {}),
    allowDefaultFallback: true,
    allowUnauthenticated: false,
    persistSelection: false,
  });
  if (!profile) {
    throw new Error("setup.plan requires a resolved OpenMeld profile.");
  }

  return buildCliOnboardingPlanForProfile({
    profile,
    deviceStatus:
      input.deviceStatus ??
      resolveOnboardingDeviceStatusFromStartReadiness(input.readiness),
  });
}

export function buildCliOnboardingPlanForProfile(input: {
  profile: OpenMeldProfile;
  accountProfiles?: readonly OpenMeldProfile[];
  deviceStatus?: OnboardingFacts["device"]["status"];
}): CliOnboardingPlan {
  const actingProfile = toOnboardingAccountProfile(input.profile);
  const accountProfiles = [
    actingProfile,
    ...(input.accountProfiles ?? [])
      .filter(
        (profile) =>
          profile.openMeldProfileId !== input.profile.openMeldProfileId
      )
      .map(toOnboardingAccountProfile),
  ];
  const facts: OnboardingFacts = {
    auth: {
      signedIn: true,
      userId: input.profile.ownerUserId,
      actingProfileId: input.profile.openMeldProfileId,
      actingDisplayName: input.profile.profileName,
    },
    accountProfiles,
    space: null,
    device: {
      status: input.deviceStatus ?? "unknown",
    },
    context: {
      kind: "none",
    },
  };

  return {
    facts,
    plan: buildOnboardingPlan(facts),
  };
}

export function resolveOnboardingDeviceStatusFromStartReadiness(
  readiness: StartReadinessSnapshot | undefined
): OnboardingFacts["device"]["status"] {
  const service = readiness?.service;
  if (!service) {
    return "unknown";
  }
  if (service.runtime?.status === "running") {
    return "connected";
  }
  if (service.runtime?.status === "stale") {
    return "connecting";
  }
  if (
    service.status === "not_installed" ||
    service.runtime?.status === "not_running"
  ) {
    return "not_connected";
  }
  if (
    service.status === "installed_current" ||
    service.status === "installed_outdated"
  ) {
    return "not_connected";
  }
  return "unknown";
}

function toOnboardingAccountProfile(
  profile: OpenMeldProfile
): OnboardingAccountProfile {
  if (profile.profileKind !== "human" && profile.profileKind !== "agent") {
    throw new Error(
      "setup.plan only supports human or agent OpenMeld profiles."
    );
  }

  return {
    profileId: profile.openMeldProfileId,
    kind: profile.profileKind,
    name: profile.profileName,
    active: profile.status === "active",
  };
}
