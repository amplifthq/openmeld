import { skillsDir } from "../config/paths";
import {
  getConfiguredSkillsConfig,
  setConfiguredSkillsConfig,
} from "../config/runtime-config";
import { ensureStorageVersionState } from "../config/storage-version";
import { ensureSystemLayout } from "../config/system-layout";
import {
  ensureVersionStateReady,
  type OpenMeldVersionStateV1,
} from "../config/version-state";
import { ensureLocalSkills, type LocalSkill } from "../skills/store";

export type OpenMeldBootstrapResult = {
  versionState: OpenMeldVersionStateV1;
  skills: LocalSkill[];
};

export async function bootstrapOpenMeldHome(input: {
  currentVersion: string;
}): Promise<OpenMeldBootstrapResult> {
  await ensureSystemLayout();
  await ensureStorageVersionState();
  const skills = await ensureLocalSkills();

  const previousSkillsConfig = await getConfiguredSkillsConfig();
  const resolvedStoreDir =
    String(previousSkillsConfig?.storeDir ?? "").trim() || skillsDir();
  await setConfiguredSkillsConfig({
    storeDir: resolvedStoreDir,
    ...(previousSkillsConfig?.agents
      ? { agents: previousSkillsConfig.agents }
      : {}),
    ...(previousSkillsConfig?.customTargets
      ? { customTargets: previousSkillsConfig.customTargets }
      : {}),
    installs: previousSkillsConfig?.installs ?? [],
  });

  const versionState = await ensureVersionStateReady({
    currentVersion: input.currentVersion,
  });

  return {
    versionState,
    skills,
  };
}
