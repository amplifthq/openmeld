import { stat } from "node:fs/promises";
import { skillsDir } from "../config/paths";
import {
  getConfiguredSkillsConfig,
  type RuntimeSkillsConfig,
  type RuntimeSkillsCustomTarget,
  type RuntimeSkillsInstallRecord,
  resolveRuntimeSkillsCustomTargetId,
  updateConfiguredSkillsConfig,
} from "../config/runtime-config";
import {
  canManageRegistryAgentSkillTargets,
  detectInstalledSkillsAgents,
  resolveSkillsAgentRegistry,
} from "./agents";
import type { SkillsInstallTarget } from "./installer";
import {
  resolveSkillInstallStateForTarget,
  resolveSkillsInstallStates,
  type SkillInstallStateResult,
} from "./state";
import { ensureLocalSkills, type LocalSkill } from "./store";

export type SkillsReadinessSnapshot = {
  status: "up_to_date" | "action_required" | "no_targets";
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
};

export async function collectSkillsReadinessSnapshot(): Promise<SkillsReadinessSnapshot> {
  const skillsConfig = await getConfiguredSkillsConfig();
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const installedAgents = await detectInstalledSkillsAgents(registry);
  const localSkills = await ensureLocalSkills();
  const detectedAgentTargets = buildAgentTargets(installedAgents, registry);
  const trackedTargets = await resolveTrackedInstallTargets({
    skillsConfig,
    registry,
    localSkills,
    onlyOpenMeldInstalledTargets: false,
  });
  const checkTargets = mergeTargetsByDir({
    primary: detectedAgentTargets,
    secondary: trackedTargets,
  });
  const states = await resolveSkillsInstallStates({
    skills: localSkills,
    targets: checkTargets,
  });
  await persistDetectedInstallStateFromCheck({ states });
  const summary = summarizeSkillState(states);
  const hasIssues =
    summary.outdated > 0 || summary.missing > 0 || summary.externalConflict > 0;
  let status: SkillsReadinessSnapshot["status"] = "up_to_date";
  if (checkTargets.length === 0) {
    status = "no_targets";
  } else if (hasIssues) {
    status = "action_required";
  }
  return {
    status,
    targetCount: checkTargets.length,
    summary,
  };
}

export function buildAgentTargets(
  agents: string[],
  registry: ReturnType<typeof resolveSkillsAgentRegistry>
): SkillsInstallTarget[] {
  return agents.flatMap((agentName) => {
    const config = registry[agentName];
    if (!config?.globalSkillsDir || config.skillsInstallable !== true) {
      return [];
    }
    return [
      {
        id: agentName,
        dir: config.globalSkillsDir,
        type: "agent" as const,
      },
    ];
  });
}

function isLikelyCustomTargetId(value: string): boolean {
  return value.startsWith("custom-");
}

export function resolveTrackedInstallTargets(input: {
  skillsConfig: RuntimeSkillsConfig | null;
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  localSkills: LocalSkill[];
  onlyOpenMeldInstalledTargets: boolean;
}): Promise<SkillsInstallTarget[]> {
  const installs = input.skillsConfig?.installs ?? [];
  const customTargets = input.skillsConfig?.customTargets ?? [];
  const customTargetByDir = buildCustomTargetByDir(customTargets);
  const byTargetDir = new Map<string, SkillsInstallTarget>();
  seedTrackedTargetsFromCustomTargets({
    byTargetDir,
    customTargetByDir,
  });
  seedTrackedTargetsFromInstallRecords({
    byTargetDir,
    installs,
    registry: input.registry,
    customTargetByDir,
  });

  const candidates = sortTrackedTargets([...byTargetDir.values()]);
  const allowRegistryDefaults = canManageRegistryAgentSkillTargets();
  const laneSafeCandidates = allowRegistryDefaults
    ? candidates
    : candidates.filter(
        (target) =>
          target.type === "custom" ||
          input.registry[target.id]?.globalSkillsDirSource === "config-override"
      );
  return filterTrackedTargetsByState({
    candidates: laneSafeCandidates,
    localSkills: input.localSkills,
    onlyOpenMeldInstalledTargets: input.onlyOpenMeldInstalledTargets,
  });
}

function buildCustomTargetByDir(
  customTargets: RuntimeSkillsCustomTarget[]
): Map<string, RuntimeSkillsCustomTarget> {
  const customTargetByDir = new Map<string, RuntimeSkillsCustomTarget>();
  for (const customTarget of customTargets) {
    const id = resolveRuntimeSkillsCustomTargetId({
      dir: customTarget.dir,
      ...(customTarget.id ? { id: customTarget.id } : {}),
    });
    customTargetByDir.set(customTarget.dir, {
      id,
      name: customTarget.name,
      dir: customTarget.dir,
    });
  }
  return customTargetByDir;
}

function seedTrackedTargetsFromCustomTargets(input: {
  byTargetDir: Map<string, SkillsInstallTarget>;
  customTargetByDir: Map<string, RuntimeSkillsCustomTarget>;
}): void {
  for (const customTarget of input.customTargetByDir.values()) {
    input.byTargetDir.set(customTarget.dir, {
      id:
        customTarget.id ??
        resolveRuntimeSkillsCustomTargetId({ dir: customTarget.dir }),
      dir: customTarget.dir,
      type: "custom",
    });
  }
}

function seedTrackedTargetsFromInstallRecords(input: {
  byTargetDir: Map<string, SkillsInstallTarget>;
  installs: RuntimeSkillsInstallRecord[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  customTargetByDir: Map<string, RuntimeSkillsCustomTarget>;
}): void {
  for (const install of input.installs) {
    const trackedTarget = buildTrackedTargetFromInstallRecord({
      install,
      registry: input.registry,
      customTargetByDir: input.customTargetByDir,
    });
    input.byTargetDir.set(install.targetDir, trackedTarget);
  }
}

function buildTrackedTargetFromInstallRecord(input: {
  install: RuntimeSkillsInstallRecord;
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  customTargetByDir: Map<string, RuntimeSkillsCustomTarget>;
}): SkillsInstallTarget {
  const knownAgentDir = input.registry[input.install.targetId]?.globalSkillsDir;
  const targetType: SkillsInstallTarget["type"] =
    knownAgentDir && knownAgentDir === input.install.targetDir
      ? "agent"
      : "custom";
  if (targetType === "agent") {
    return {
      id: input.install.targetId,
      dir: input.install.targetDir,
      type: "agent",
    };
  }

  const customTarget = input.customTargetByDir.get(input.install.targetDir);
  const fallbackCustomId = isLikelyCustomTargetId(input.install.targetId)
    ? input.install.targetId
    : undefined;
  const resolvedCustomId = customTarget?.id ?? fallbackCustomId;
  return {
    id: resolveRuntimeSkillsCustomTargetId({
      dir: input.install.targetDir,
      ...(resolvedCustomId ? { id: resolvedCustomId } : {}),
    }),
    dir: input.install.targetDir,
    type: "custom",
  };
}

function sortTrackedTargets(
  targets: SkillsInstallTarget[]
): SkillsInstallTarget[] {
  return [...targets].sort((a, b) =>
    `${a.id}:${a.dir}`.localeCompare(`${b.id}:${b.dir}`)
  );
}

export function mergeTargetsByDir(input: {
  primary: SkillsInstallTarget[];
  secondary: SkillsInstallTarget[];
}): SkillsInstallTarget[] {
  const byDir = new Map<string, SkillsInstallTarget>();
  for (const target of input.secondary) {
    byDir.set(target.dir, target);
  }
  for (const target of input.primary) {
    byDir.set(target.dir, target);
  }
  return sortTrackedTargets([...byDir.values()]);
}

async function filterInstalledTrackedTargets(input: {
  candidates: SkillsInstallTarget[];
  localSkills: LocalSkill[];
}): Promise<SkillsInstallTarget[]> {
  const installedOnly: SkillsInstallTarget[] = [];
  for (const candidate of input.candidates) {
    const hasInstalledOpenMeldSkill = await targetHasInstalledOpenMeldSkill({
      target: candidate,
      localSkills: input.localSkills,
    });
    if (!hasInstalledOpenMeldSkill) {
      continue;
    }
    installedOnly.push(candidate);
  }
  return installedOnly;
}

export async function filterTargetsWithInstalledOpenMeldSkills(input: {
  targets: SkillsInstallTarget[];
  localSkills: LocalSkill[];
}): Promise<SkillsInstallTarget[]> {
  const existingTargets = await filterExistingTargetDirs(input.targets);
  return filterInstalledTrackedTargets({
    candidates: existingTargets,
    localSkills: input.localSkills,
  });
}

async function filterTrackedTargetsByState(input: {
  candidates: SkillsInstallTarget[];
  localSkills: LocalSkill[];
  onlyOpenMeldInstalledTargets: boolean;
}): Promise<SkillsInstallTarget[]> {
  const existingTargets = await filterExistingTargetDirs(input.candidates);
  if (!input.onlyOpenMeldInstalledTargets) {
    return existingTargets;
  }

  return filterInstalledTrackedTargets({
    candidates: existingTargets,
    localSkills: input.localSkills,
  });
}

async function filterExistingTargetDirs(
  candidates: SkillsInstallTarget[]
): Promise<SkillsInstallTarget[]> {
  const existing: SkillsInstallTarget[] = [];
  for (const candidate of candidates) {
    const targetDirStats = await stat(candidate.dir).catch(() => null);
    if (!targetDirStats?.isDirectory()) {
      continue;
    }
    existing.push(candidate);
  }
  return existing;
}

export function summarizeSkillState(states: SkillInstallStateResult[]): {
  upToDate: number;
  outdated: number;
  missing: number;
  externalConflict: number;
} {
  return {
    upToDate: states.filter((state) => state.state === "up_to_date").length,
    outdated: states.filter((state) => state.state === "outdated").length,
    missing: states.filter((state) => state.state === "missing").length,
    externalConflict: states.filter(
      (state) => state.state === "external_conflict"
    ).length,
  };
}

async function targetHasInstalledOpenMeldSkill(input: {
  target: SkillsInstallTarget;
  localSkills: LocalSkill[];
}): Promise<boolean> {
  const targetDirStats = await stat(input.target.dir).catch(() => null);
  if (!targetDirStats?.isDirectory()) {
    return false;
  }

  for (const skill of input.localSkills) {
    const state = await resolveSkillInstallStateForTarget({
      skill,
      target: input.target,
    });
    if (state.state === "up_to_date" || state.state === "outdated") {
      return true;
    }
  }

  return false;
}

export async function persistDetectedInstallStateFromCheck(input: {
  states: SkillInstallStateResult[];
}): Promise<void> {
  const discoveredByTargetDir = new Map<string, SkillInstallStateResult[]>();
  for (const state of input.states) {
    if (!(state.state === "up_to_date" || state.state === "outdated")) {
      continue;
    }
    const list = discoveredByTargetDir.get(state.targetDir) ?? [];
    list.push(state);
    discoveredByTargetDir.set(state.targetDir, list);
  }

  if (discoveredByTargetDir.size === 0) {
    return;
  }

  await updateConfiguredSkillsConfig((currentSkillsConfig) => {
    const byTargetDir = new Map<string, RuntimeSkillsInstallRecord>();
    for (const record of currentSkillsConfig?.installs ?? []) {
      byTargetDir.set(record.targetDir, record);
    }

    const now = new Date().toISOString();
    for (const [targetDir, group] of discoveredByTargetDir) {
      const first = group[0];
      if (!first) {
        continue;
      }
      const mode: RuntimeSkillsInstallRecord["mode"] = group.some(
        (state) => state.targetMode === "copy"
      )
        ? "copy"
        : "symlink";
      const skillIds = Array.from(
        new Set(group.map((state) => state.skillId))
      ).sort((a, b) => a.localeCompare(b));

      byTargetDir.set(targetDir, {
        targetId: first.targetId,
        targetDir,
        mode,
        status: "installed",
        skillIds,
        updatedAt: now,
      });
    }

    const nextInstalls = [...byTargetDir.values()].sort(compareInstallRecords);
    const previousInstalls = [...(currentSkillsConfig?.installs ?? [])]
      .sort(compareInstallRecords)
      .map(normalizeInstallRecordForCompare);
    const nextComparable = nextInstalls.map(normalizeInstallRecordForCompare);
    if (JSON.stringify(previousInstalls) === JSON.stringify(nextComparable)) {
      return currentSkillsConfig;
    }

    return {
      storeDir: currentSkillsConfig?.storeDir ?? skillsDir(),
      ...(currentSkillsConfig?.agents
        ? { agents: currentSkillsConfig.agents }
        : {}),
      ...(currentSkillsConfig?.customTargets
        ? { customTargets: currentSkillsConfig.customTargets }
        : {}),
      installs: nextInstalls,
    };
  });
}

export function compareInstallRecords(
  left: RuntimeSkillsInstallRecord,
  right: RuntimeSkillsInstallRecord
): number {
  const byTargetId = left.targetId.localeCompare(right.targetId);
  if (byTargetId !== 0) {
    return byTargetId;
  }
  return left.targetDir.localeCompare(right.targetDir);
}

function normalizeInstallRecordForCompare(
  input: RuntimeSkillsInstallRecord
): Omit<RuntimeSkillsInstallRecord, "updatedAt"> {
  return {
    targetId: input.targetId,
    targetDir: input.targetDir,
    mode: input.mode,
    status: input.status,
    skillIds: [...input.skillIds].sort((a, b) => a.localeCompare(b)),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}
