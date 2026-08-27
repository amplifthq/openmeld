import { getConfiguredSkillsConfig } from "../../config/runtime-config";
import {
  canManageRegistryAgentSkillTargets,
  resolveSkillsAgentRegistry,
} from "../../skills/agents";
import {
  installSkillsToTargets,
  type SkillsInstallTarget,
  withSkillsInstallLock,
} from "../../skills/installer";
import { resolveSkillInstallStateForTarget } from "../../skills/state";
import { ensureLocalSkills, type LocalSkill } from "../../skills/store";

export type DispatchControllerOpenMeldSkillRepairStatus =
  | "blocked"
  | "failed"
  | "lane_isolated"
  | "not_needed"
  | "repaired"
  | "unsupported";

export type DispatchControllerOpenMeldSkillRepairResult = {
  agentId: string | null;
  status: DispatchControllerOpenMeldSkillRepairStatus;
  reason?: string;
};

const OPENMELD_CLI_SKILL_ID = "openmeld-cli";

/**
 * Restores only OpenMeld's own collaboration skill for the Agent Controller
 * carrying the current dispatch. User-owned skill directories are never
 * overwritten, and isolated lanes cannot mutate published agent state unless
 * the target directory was explicitly configured for that lane.
 */
export async function ensureDispatchControllerOpenMeldSkill(input: {
  agentControllerRef: string | null | undefined;
}): Promise<DispatchControllerOpenMeldSkillRepairResult> {
  const agentId = resolveBuiltinAgentId(input.agentControllerRef);
  if (!agentId) {
    return { agentId: null, status: "unsupported" };
  }

  try {
    const skillsConfig = await getConfiguredSkillsConfig();
    const registry = resolveSkillsAgentRegistry(skillsConfig);
    const agent = registry[agentId];
    if (
      !agent?.globalSkillsDir ||
      agent.skillsInstallable !== true ||
      agent.lifecycleStatus === "removed"
    ) {
      return { agentId, status: "unsupported" };
    }
    if (
      agent.globalSkillsDirSource === "registry-default" &&
      !canManageRegistryAgentSkillTargets()
    ) {
      return { agentId, status: "lane_isolated" };
    }

    const openMeldSkill = (await ensureLocalSkills()).find(
      (skill) => skill.id === OPENMELD_CLI_SKILL_ID
    );
    if (!openMeldSkill) {
      return {
        agentId,
        status: "failed",
        reason: "the bundled openmeld-cli skill is unavailable",
      };
    }

    const target: SkillsInstallTarget = {
      id: agentId,
      dir: agent.globalSkillsDir,
      type: "agent",
    };
    return await repairOpenMeldSkillTarget({
      agentId,
      openMeldSkill,
      target,
    });
  } catch (error) {
    return {
      agentId,
      status: "failed",
      reason: error instanceof Error ? error.message : "skill repair failed",
    };
  }
}

async function repairOpenMeldSkillTarget(input: {
  agentId: string;
  openMeldSkill: LocalSkill;
  target: SkillsInstallTarget;
}): Promise<DispatchControllerOpenMeldSkillRepairResult> {
  const currentResult = await resolveExistingSkillResult(input);
  if (currentResult) {
    return currentResult;
  }

  const [installResult] = await withSkillsInstallLock(() =>
    installSkillsToTargets({
      skills: [input.openMeldSkill],
      targets: [input.target],
    })
  );
  if (installResult?.status === "installed") {
    return { agentId: input.agentId, status: "repaired" };
  }
  if (installResult?.status === "skipped") {
    const reconciledResult = await resolveExistingSkillResult(input);
    if (reconciledResult) {
      return reconciledResult;
    }
  }
  return {
    agentId: input.agentId,
    status: "failed",
    ...(installResult?.reason ? { reason: installResult.reason } : {}),
  };
}

async function resolveExistingSkillResult(input: {
  agentId: string;
  openMeldSkill: LocalSkill;
  target: SkillsInstallTarget;
}): Promise<DispatchControllerOpenMeldSkillRepairResult | null> {
  const state = await resolveSkillInstallStateForTarget({
    skill: input.openMeldSkill,
    target: input.target,
  });
  if (state.state === "up_to_date") {
    return { agentId: input.agentId, status: "not_needed" };
  }
  if (state.state === "external_conflict") {
    return {
      agentId: input.agentId,
      status: "blocked",
      ...(state.reason ? { reason: state.reason } : {}),
    };
  }
  return null;
}

function resolveBuiltinAgentId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized.startsWith("builtin:")) {
    return null;
  }
  const agentId = normalized.slice("builtin:".length).trim();
  return agentId.length > 0 ? agentId : null;
}
