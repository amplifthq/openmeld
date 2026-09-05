import { getConfiguredSkillsConfig } from "../config/runtime-config";
import { resolveSkillsAgentRegistry } from "./agents";
import { resolveTrackedInstallTargets } from "./installation-inventory";
import { installSkillsToTargets, withSkillsInstallLock } from "./installer";
import { downloadOfficialSkillUpdate } from "./official-release";
import { ensureLocalSkills } from "./store";

export async function maintainOfficialCliSkill(): Promise<void> {
  const outcome = await downloadOfficialSkillUpdate().catch(
    (error: unknown) => {
      process.stderr.write(
        `[openmeld] Skill download deferred: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return "deferred" as const;
    }
  );
  if (outcome === "lane_isolated") {
    return;
  }
  await withSkillsInstallLock(async () => {
    const localSkills = await ensureLocalSkills();
    const skillsConfig = await getConfiguredSkillsConfig();
    const targets = await resolveTrackedInstallTargets({
      skillsConfig,
      registry: resolveSkillsAgentRegistry(skillsConfig),
      localSkills,
      onlyOpenMeldInstalledTargets: false,
    });
    const results = await installSkillsToTargets({
      skills: localSkills,
      targets,
    });
    const failures = results.filter((result) => result.status === "failed");
    if (failures.length) {
      throw new Error(
        failures
          .map((result) => `${result.targetId}: ${result.reason}`)
          .join("; ")
      );
    }
  });
}
