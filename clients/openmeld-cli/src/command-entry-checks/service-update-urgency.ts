import { resolveOpenMeldEnvironmentTarget } from "../config/openmeld-environment-target";
import {
  assessServerRequiredVersion,
  type ServerRequiredVersionAssessment,
} from "./server-required-version-assessment";

export type ServiceUpdateUrgency = "available" | "required";

export async function resolveServiceUpdateUrgency(
  input: { gatewayUrl?: string } = {}
): Promise<ServiceUpdateUrgency> {
  const environmentTarget = await resolveOpenMeldEnvironmentTarget({
    gatewayUrl: input.gatewayUrl,
  });
  const assessment = await assessServerRequiredVersion({
    gatewayUrl: environmentTarget.gatewayUrl,
  });
  return resolveServiceUpdateUrgencyFromAssessment(assessment);
}

export function resolveServiceUpdateUrgencyFromAssessment(
  assessment: ServerRequiredVersionAssessment
): ServiceUpdateUrgency {
  return assessment.available && assessment.service.status === "update_required"
    ? "required"
    : "available";
}
