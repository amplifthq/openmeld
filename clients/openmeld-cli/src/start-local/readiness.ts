import { collectStartLocalAgentsReadiness } from "./agents-local";
import { collectStartLocalBackgroundHelperReadiness } from "./background-helper-local";
import type { StartReadinessSnapshot } from "./readiness-types";
import { collectStartLocalSkillsReadiness } from "./skills-local";

export async function collectStartLocalReadiness(input: {
  auth: StartReadinessSnapshot["auth"];
}): Promise<StartReadinessSnapshot> {
  // OPENMELD_SERVICE_THIN_CORE: legacy composite input for setup.
  // This currently combines skills, local agents, and service evidence for
  // setup UX. Phase 2 should extract runtime inventory so this snapshot stops
  // acting like a readiness proof for unrelated product surfaces.
  const [skills, agents, service] = await Promise.all([
    collectStartLocalSkillsReadiness(),
    collectStartLocalAgentsReadiness(),
    collectStartLocalBackgroundHelperReadiness(),
  ]);

  return {
    auth: input.auth,
    skills,
    agents,
    service,
  };
}
