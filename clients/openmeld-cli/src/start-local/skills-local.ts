import { runSkillsInstall } from "../commands/skills";
import { collectSkillsReadinessSnapshot } from "../skills/installation-inventory";
import type { StartReadinessSnapshot } from "./readiness-types";

export function collectStartLocalSkillsReadiness(): Promise<
  StartReadinessSnapshot["skills"]
> {
  return collectSkillsReadinessSnapshot()
    .then((snapshot) => ({
      status: snapshot.status,
      targetCount: snapshot.targetCount,
      summary: snapshot.summary,
    }))
    .catch((error) => ({
      status: "unknown" as const,
      targetCount: 0,
      summary: {
        upToDate: 0,
        outdated: 0,
        missing: 0,
        externalConflict: 0,
      },
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "skills readiness unavailable",
    }));
}

export async function runStartLocalSkillsInstall(input: {
  view?: string;
  allowBackToCaller?: boolean;
}): Promise<Awaited<ReturnType<typeof runSkillsInstall>>> {
  return await runSkillsInstall(input);
}
