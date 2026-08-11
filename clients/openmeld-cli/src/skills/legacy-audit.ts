import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SkillsInstallTarget } from "./installer";
import type { LocalSkill } from "./store";
import { readOpenMeldSkillMarker } from "./store";

type SkillsRegistryEntryLike = {
  globalSkillsDir?: string;
};

export type LegacyOpenMeldSkillFinding = {
  skillId: string;
  skillDir: string;
  parentDir: string;
  reasonCode:
    | "legacy_openmeld_skill_id"
    | "unmanaged_current_openmeld_skill_copy";
  problem: string;
  recommendation: string;
  currentInstallCommand: string;
  cleanupCommands: string[];
  verificationCommand: string;
};

const LEGACY_OPENMELD_SKILL_IDS = new Set(["openmeld-cli-guide"]);
const LEGACY_OPENMELD_SKILL_VERIFICATION_COMMAND =
  "openmeld skills check --view agent";

export async function detectLegacyOpenMeldSkillCopies(input: {
  registry: Record<string, SkillsRegistryEntryLike>;
  localSkills: LocalSkill[];
  targets?: SkillsInstallTarget[];
}): Promise<LegacyOpenMeldSkillFinding[]> {
  const currentSkillIds = new Set(input.localSkills.map((skill) => skill.id));
  const roots = resolveCandidateSkillRoots(input);
  const targetCurrentSkillDirs = resolveTargetCurrentSkillDirs({
    targets: input.targets ?? [],
    currentSkillIds,
  });
  const skillIdsToAudit = new Set([
    ...LEGACY_OPENMELD_SKILL_IDS,
    ...currentSkillIds,
  ]);
  const findings: LegacyOpenMeldSkillFinding[] = [];

  for (const parentDir of roots) {
    for (const skillId of skillIdsToAudit) {
      const skillDir = join(parentDir, skillId);
      const finding = await inspectPotentialLegacyOpenMeldSkill({
        skillId,
        skillDir,
        parentDir,
        currentSkillIds,
        targetCurrentSkillDirs,
      });
      if (finding) {
        findings.push(finding);
      }
    }
  }

  return dedupeLegacyFindings(findings);
}

function resolveCandidateSkillRoots(input: {
  registry: Record<string, SkillsRegistryEntryLike>;
  targets?: SkillsInstallTarget[];
}): string[] {
  const roots = new Set<string>();
  for (const agent of Object.values(input.registry)) {
    const root = normalizeAbsolutePath(agent.globalSkillsDir);
    if (root) {
      roots.add(root);
    }
  }
  for (const target of input.targets ?? []) {
    const root = normalizeAbsolutePath(target.dir);
    if (root) {
      roots.add(root);
    }
  }
  return [...roots].sort((left, right) => left.localeCompare(right));
}

function resolveTargetCurrentSkillDirs(input: {
  targets: SkillsInstallTarget[];
  currentSkillIds: Set<string>;
}): Set<string> {
  const skillDirs = new Set<string>();
  for (const target of input.targets) {
    for (const skillId of input.currentSkillIds) {
      skillDirs.add(resolve(join(target.dir, skillId)));
    }
  }
  return skillDirs;
}

async function inspectPotentialLegacyOpenMeldSkill(input: {
  skillId: string;
  skillDir: string;
  parentDir: string;
  currentSkillIds: Set<string>;
  targetCurrentSkillDirs: Set<string>;
}): Promise<LegacyOpenMeldSkillFinding | null> {
  const skillDir = resolve(input.skillDir);
  const parentDir = resolve(input.parentDir);
  const stats = await stat(skillDir).catch(() => null);
  if (!stats?.isDirectory()) {
    return null;
  }

  const rawSkill = await readFile(join(skillDir, "SKILL.md"), "utf8").catch(
    () => ""
  );
  if (!rawSkill) {
    return null;
  }

  const marker = await readOpenMeldSkillMarker(skillDir);
  if (
    marker?.managedBy === "openmeld" &&
    marker.skillId === input.skillId &&
    input.currentSkillIds.has(input.skillId)
  ) {
    return null;
  }

  if (LEGACY_OPENMELD_SKILL_IDS.has(input.skillId)) {
    return {
      skillId: input.skillId,
      skillDir,
      parentDir,
      reasonCode: "legacy_openmeld_skill_id",
      problem:
        "This is an old OpenMeld skill name. Agents can still load it and learn stale OpenMeld instructions.",
      recommendation:
        "Do not load or follow this skill. Install the current OpenMeld skill into this skill root, then remove or rename this legacy skill directory and rerun the OpenMeld skills check.",
      currentInstallCommand: buildCurrentSkillInstallCommand(parentDir),
      cleanupCommands: buildLegacySkillCleanupCommands(skillDir),
      verificationCommand: LEGACY_OPENMELD_SKILL_VERIFICATION_COMMAND,
    };
  }

  if (
    input.currentSkillIds.has(input.skillId) &&
    !input.targetCurrentSkillDirs.has(skillDir) &&
    isLikelyOpenMeldSkillDocument(rawSkill)
  ) {
    return {
      skillId: input.skillId,
      skillDir,
      parentDir,
      reasonCode: "unmanaged_current_openmeld_skill_copy",
      problem:
        "This looks like an OpenMeld skill copy, but this OpenMeld installation does not manage it.",
      recommendation:
        "Do not load or follow this unmanaged copy until the current OpenMeld-managed skill is installed for this skill root. Install the current skill, then remove or rename this directory if this agent should not use the unmanaged copy.",
      currentInstallCommand: buildCurrentSkillInstallCommand(parentDir),
      cleanupCommands: buildLegacySkillCleanupCommands(skillDir),
      verificationCommand: LEGACY_OPENMELD_SKILL_VERIFICATION_COMMAND,
    };
  }

  return null;
}

function buildLegacySkillCleanupCommands(skillDir: string): string[] {
  return [
    `mv ${quoteShellArg(skillDir)} ${quoteShellArg(`${skillDir}.legacy`)}`,
    `rm -rf ${quoteShellArg(skillDir)}`,
  ];
}

function buildCurrentSkillInstallCommand(parentDir: string): string {
  return `openmeld skills ensure --dir ${quoteShellArg(parentDir)} --view agent`;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isLikelyOpenMeldSkillDocument(rawSkill: string): boolean {
  const normalized = rawSkill.toLowerCase();
  return (
    normalized.includes("openmeld") ||
    normalized.includes("openmeld cli") ||
    normalized.includes("openmeld space action") ||
    normalized.includes("openmeld skills")
  );
}

function dedupeLegacyFindings(
  findings: LegacyOpenMeldSkillFinding[]
): LegacyOpenMeldSkillFinding[] {
  const byPath = new Map<string, LegacyOpenMeldSkillFinding>();
  for (const finding of findings) {
    byPath.set(finding.skillDir, finding);
  }
  return [...byPath.values()].sort((left, right) =>
    `${left.skillId}:${left.skillDir}`.localeCompare(
      `${right.skillId}:${right.skillDir}`
    )
  );
}

function normalizeAbsolutePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? resolve(normalized) : null;
}
