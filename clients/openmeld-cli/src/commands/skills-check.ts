import { cancel } from "@clack/prompts";
import pc from "picocolors";
import type { RuntimeSkillsCustomTarget } from "../config/runtime-config";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import type { resolveSkillsAgentRegistry } from "../skills/agents";
import type { SkillsInstallTarget } from "../skills/installer";
import type { LegacyOpenMeldSkillFinding } from "../skills/legacy-audit";
import type { SkillInstallStateResult } from "../skills/state";
import type { InfoCardRow } from "../ui/info-card";
import { outLine } from "../ui/io";
import { promptSearchSelect, type SearchSelectItem } from "../ui/search-select";
import {
  formatSkillsCommand,
  formatSkillsCount,
  formatSkillsStoreValue,
  renderSkillsTextCard,
} from "./skills-format";
import { buildLegacyOpenMeldSkillNextStepRows } from "./skills-legacy-audit-view";
import { toTargetKey } from "./skills-target-key";

export const SKILLS_CHECK_INTERACTIVE_MAX_VISIBLE = 8;

export type SkillsCheckTargetState = {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  targetLabel: string;
  targetName: string;
  targetNameKind: "agent" | "custom";
  installed: boolean;
  latest: boolean;
  missingSkillIds: string[];
  outdatedSkillIds: string[];
  conflictSkillIds: string[];
};

export type SkillsCheckTargetAccumulator = {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  targetLabel: string;
  targetName: string;
  targetNameKind: "agent" | "custom";
  missingSkillIds: Set<string>;
  outdatedSkillIds: Set<string>;
  upToDateSkillIds: Set<string>;
  conflictSkillIds: Set<string>;
};

export type SkillsCheckNavigationResult = "completed" | "back" | "cancelled";

export async function runInteractiveSkillsCheckViewer(input: {
  storeDir: string;
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings: LegacyOpenMeldSkillFinding[];
  targetStates: SkillsCheckTargetState[];
  allowBackToCaller: boolean;
}): Promise<SkillsCheckNavigationResult> {
  const selected = await promptSearchSelect({
    message: "OpenMeld skills status",
    items: buildSkillsCheckInteractiveItems(input.targetStates),
    maxVisible: SKILLS_CHECK_INTERACTIVE_MAX_VISIBLE,
    emptyLabel: "No agents or saved OpenMeld skill targets found",
    allowBack: true,
    backLabel: input.allowBackToCaller ? "Back" : "Cancel",
    readOnly: true,
    summaryCard: buildSkillsCheckSummaryCard(input),
  });
  if (selected.status === "cancelled") {
    cancel("Cancelled.");
    return "cancelled";
  }
  if (selected.status === "back") {
    if (!input.allowBackToCaller) {
      cancel("Cancelled.");
      return "cancelled";
    }
    return "back";
  }
  return "completed";
}

function buildSkillsCheckInteractiveItems(
  targetStates: SkillsCheckTargetState[]
): SearchSelectItem<string>[] {
  return targetStates.map((target) => buildSkillsCheckTargetSearchItem(target));
}

function buildSkillsCheckSummaryCard(input: {
  storeDir: string;
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings: LegacyOpenMeldSkillFinding[];
}): {
  title: string;
  rows: InfoCardRow[];
  compact: boolean;
} {
  return {
    title: "Summary",
    rows: [
      {
        label: "Status",
        value: resolveSkillsCheckInteractiveSummaryLabel(input),
      },
      {
        label: "Summary",
        value: formatSkillsCheckSummaryCounts(input),
      },
      {
        label: "Legacy OpenMeld skills",
        value: String(input.legacyFindings.length),
      },
      {
        label: "Store directory",
        value: input.storeDir,
      },
      ...buildSkillsCheckSummaryNextStepRows(input),
    ],
    compact: true,
  };
}

function resolveSkillsCheckInteractiveSummaryLabel(input: {
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings: LegacyOpenMeldSkillFinding[];
}): string {
  if (input.legacyFindings.length > 0) {
    return "⚠ Legacy OpenMeld skill copies need review";
  }
  if (input.targetCount === 0) {
    return "ℹ No agents or saved OpenMeld skills installs";
  }
  if (
    input.summary.outdated === 0 &&
    input.summary.missing === 0 &&
    input.summary.externalConflict === 0
  ) {
    return "✅ OpenMeld skills are up to date on all detected agents and saved installs";
  }
  if (input.summary.missing > 0 || input.summary.externalConflict > 0) {
    return "⚠ OpenMeld skills need setup";
  }
  return "▲ OpenMeld skill updates are available";
}

function formatSkillsCheckSummaryCounts(input: {
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
}): string {
  return [
    `${input.targetCount} targets`,
    `${input.summary.upToDate} up to date`,
    `${input.summary.outdated} outdated`,
    `${input.summary.missing} missing`,
    `${input.summary.externalConflict} need review`,
  ].join(" · ");
}

function buildSkillsCheckTargetSearchItem(
  target: SkillsCheckTargetState
): SearchSelectItem<string> {
  const status = resolveSkillsCheckTargetStatus(target);
  const detailParts = [
    `${target.targetNameKind} target`,
    `ID ${target.targetId}`,
    target.targetDir,
  ];
  const issueDetail = resolveSkillsCheckTargetIssueDetail(target);
  if (issueDetail) {
    detailParts.push(issueDetail);
  }

  return {
    value: `target:${target.targetId}:${target.targetDir}`,
    label: `${status.icon} ${target.targetName}`,
    hint: status.label,
    detail: detailParts.join(" · "),
    searchText: [
      status.label,
      target.targetName,
      target.targetId,
      target.targetDir,
      target.targetType,
      ...target.outdatedSkillIds,
      ...target.missingSkillIds,
      ...target.conflictSkillIds,
    ].join(" "),
  };
}

function resolveSkillsCheckTargetStatus(target: SkillsCheckTargetState): {
  label: string;
  icon: string;
} {
  if (target.conflictSkillIds.length > 0) {
    return { label: "Needs review", icon: "✖" };
  }
  if (target.missingSkillIds.length > 0 && target.outdatedSkillIds.length > 0) {
    return { label: "Missing and outdated", icon: "⚠" };
  }
  if (target.missingSkillIds.length > 0) {
    return { label: "Missing", icon: "⚠" };
  }
  if (target.outdatedSkillIds.length > 0) {
    return { label: "Outdated", icon: "▲" };
  }
  if (target.latest) {
    return { label: "Up to date", icon: "✓" };
  }
  if (target.installed) {
    return { label: "Installed", icon: "•" };
  }
  return { label: "Tracked", icon: "•" };
}

function resolveSkillsCheckTargetIssueDetail(
  target: SkillsCheckTargetState
): string | null {
  const details: string[] = [];
  if (target.outdatedSkillIds.length > 0) {
    details.push(`outdated skills: ${target.outdatedSkillIds.join(", ")}`);
  }
  if (target.missingSkillIds.length > 0) {
    details.push(`missing skills: ${target.missingSkillIds.join(", ")}`);
  }
  if (target.conflictSkillIds.length > 0) {
    details.push(`non-OpenMeld skills: ${target.conflictSkillIds.join(", ")}`);
  }
  return details.length > 0 ? details.join(" · ") : null;
}

function buildSkillsCheckSummaryNextStepRows(input: {
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
}): InfoCardRow[] {
  if (input.targetCount === 0) {
    return [
      {
        label: "Next step",
        value: `Install first with ${formatOpenMeldCliCommand("openmeld skills install")}`,
      },
    ];
  }

  const summary = input.summary;
  const rows: InfoCardRow[] = [];
  if (
    summary.outdated === 0 &&
    summary.missing === 0 &&
    summary.externalConflict === 0
  ) {
    return [
      {
        label: "Next step",
        value: "No action needed",
      },
    ];
  }
  if (summary.missing > 0) {
    rows.push({
      label: "Install missing",
      value: [
        formatOpenMeldCliCommand("openmeld skills install --all"),
        formatOpenMeldCliCommand("openmeld skills install --agent <id...>"),
      ].join(" or "),
    });
  }
  if (summary.outdated > 0) {
    rows.push({
      label: "Update outdated",
      value: formatOpenMeldCliCommand("openmeld skills update"),
    });
  }
  if (summary.externalConflict > 0) {
    rows.push({
      label: "Review non-OpenMeld skills",
      value: `Rename or remove non-OpenMeld skills, then rerun ${formatOpenMeldCliCommand(
        "openmeld skills install --all"
      )}`,
    });
  }
  return rows;
}

export function emitSkillsCheckHumanSummaryCard(input: {
  storeDir: string;
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings: LegacyOpenMeldSkillFinding[];
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Status",
    rows: [
      {
        label: "status",
        value: resolveSkillsCheckHumanStatus({
          targetCount: input.targetCount,
          summary: input.summary,
          legacyFindings: input.legacyFindings,
        }),
      },
      {
        label: "store",
        value: formatSkillsStoreValue(input.storeDir),
      },
      {
        label: "targets",
        value: formatSkillsCount(input.targetCount, "neutral"),
      },
      {
        label: "up-to-date",
        value: formatSkillsCount(input.summary.upToDate, "green"),
      },
      {
        label: "outdated",
        value: formatSkillsCount(input.summary.outdated, "yellow"),
      },
      {
        label: "missing",
        value: formatSkillsCount(input.summary.missing, "red"),
      },
      {
        label: "needs review",
        value: formatSkillsCount(input.summary.externalConflict, "red"),
      },
      {
        label: "legacy OpenMeld skills",
        value: formatSkillsCount(input.legacyFindings.length, "red"),
      },
    ],
  });
}

function resolveSkillsCheckHumanStatus(input: {
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings: LegacyOpenMeldSkillFinding[];
}): string {
  if (input.legacyFindings.length > 0) {
    return `${pc.red("✖")} Legacy OpenMeld skill copies need review.`;
  }
  if (input.targetCount === 0) {
    return `${pc.yellow("○")} No agents or saved OpenMeld skills installs were found.`;
  }
  if (
    input.summary.outdated === 0 &&
    input.summary.missing === 0 &&
    input.summary.externalConflict === 0
  ) {
    return `${pc.green("✅")} OpenMeld skills are up to date on all detected agents and saved installs.`;
  }
  if (input.summary.missing > 0 || input.summary.externalConflict > 0) {
    return `${pc.red("✖")} OpenMeld skills need setup.`;
  }
  return `${pc.yellow("▲")} OpenMeld skill updates are available.`;
}

export function emitSkillsCheckHumanTargetCards(input: {
  targetStates: SkillsCheckTargetState[];
}): void {
  const hasActionableTargets = input.targetStates.some(
    (target) =>
      target.outdatedSkillIds.length > 0 ||
      target.missingSkillIds.length > 0 ||
      target.conflictSkillIds.length > 0
  );
  if (!hasActionableTargets) {
    const readyTargets = input.targetStates.filter((target) => target.latest);
    if (readyTargets.length > 0) {
      emitSkillsCheckCard({
        title: "Up-to-date Installs",
        targets: readyTargets,
      });
    }
    return;
  }

  const outdatedTargets = input.targetStates.filter(
    (target) => target.outdatedSkillIds.length > 0
  );
  const missingTargets = input.targetStates.filter(
    (target) => target.missingSkillIds.length > 0
  );
  const conflictTargets = input.targetStates.filter(
    (target) => target.conflictSkillIds.length > 0
  );

  if (outdatedTargets.length > 0) {
    emitSkillsCheckCard({
      title: "Updates Available",
      targets: outdatedTargets,
      detailMode: "outdated",
    });
  }
  if (missingTargets.length > 0) {
    emitSkillsCheckCard({
      title: "Missing Skills",
      targets: missingTargets,
      detailMode: "missing",
    });
  }
  if (conflictTargets.length > 0) {
    emitSkillsCheckCard({
      title: "Needs Review",
      targets: conflictTargets,
      detailMode: "conflict",
    });
  }
}

function emitSkillsCheckCard(input: {
  title: string;
  targets: SkillsCheckTargetState[];
  detailMode?: "outdated" | "missing" | "conflict";
}): void {
  outLine("");
  renderSkillsTextCard({
    title: `${input.title} (${input.targets.length})`,
    rows:
      input.targets.length > 0
        ? input.targets.map((target) =>
            buildSkillsCheckHumanTargetRow({
              target,
              detailMode: input.detailMode,
            })
          )
        : [
            {
              label: "status",
              value: pc.dim("none"),
            },
          ],
    compact: true,
  });
}

function buildSkillsCheckHumanTargetRow(input: {
  target: SkillsCheckTargetState;
  detailMode?: "outdated" | "missing" | "conflict";
}): InfoCardRow {
  const targetMeta = [
    pc.dim(`${input.target.targetNameKind} (${input.target.targetId})`),
    pc.dim(`dir: ${input.target.targetDir}`),
  ];

  const issueDetail = resolveSkillsCheckHumanIssueDetail(input);
  if (issueDetail) {
    targetMeta.push(issueDetail);
  }

  return {
    label: [
      resolveSkillsCheckHumanTargetMarker(input),
      formatSkillsCheckTargetNameForHuman(input.target),
    ].join(" "),
    value: targetMeta.join(` ${pc.dim("·")} `),
  };
}

function resolveSkillsCheckHumanTargetMarker(input: {
  target: SkillsCheckTargetState;
  detailMode?: "outdated" | "missing" | "conflict";
}): string {
  if (
    input.detailMode === "conflict" ||
    input.target.conflictSkillIds.length > 0
  ) {
    return pc.red("✖");
  }
  if (
    input.detailMode === "missing" ||
    input.target.missingSkillIds.length > 0
  ) {
    return pc.red("⚠");
  }
  if (
    input.detailMode === "outdated" ||
    input.target.outdatedSkillIds.length > 0
  ) {
    return pc.yellow("▲");
  }
  if (input.target.latest) {
    return pc.green("✓");
  }
  if (input.target.installed) {
    return pc.cyan("•");
  }
  return pc.dim("•");
}

function formatSkillsCheckTargetNameForHuman(
  target: SkillsCheckTargetState
): string {
  const displayName =
    target.targetNameKind === "agent"
      ? pc.cyan(target.targetName)
      : target.targetName;
  return pc.bold(displayName);
}

function resolveSkillsCheckHumanIssueDetail(input: {
  target: SkillsCheckTargetState;
  detailMode?: "outdated" | "missing" | "conflict";
}): string | null {
  if (
    input.detailMode === "outdated" &&
    input.target.outdatedSkillIds.length > 0
  ) {
    return pc.yellow(
      `outdated skills: ${input.target.outdatedSkillIds.join(", ")}`
    );
  }
  if (
    input.detailMode === "missing" &&
    input.target.missingSkillIds.length > 0
  ) {
    return pc.red(`missing skills: ${input.target.missingSkillIds.join(", ")}`);
  }
  if (
    input.detailMode === "conflict" &&
    input.target.conflictSkillIds.length > 0
  ) {
    return pc.red(
      `non-OpenMeld skills: ${input.target.conflictSkillIds.join(", ")}`
    );
  }
  return null;
}

export function emitSkillsCheckHumanNextStepsCard(input: {
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings: LegacyOpenMeldSkillFinding[];
}): void {
  const rows = buildSkillsCheckHumanNextStepRows(input);
  if (rows.length === 0) {
    return;
  }
  outLine("");
  renderSkillsTextCard({
    title: "Next Steps",
    rows,
    compact: true,
  });
}

export function buildSkillsCheckHumanNextStepRows(input: {
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  legacyFindings?: LegacyOpenMeldSkillFinding[];
}): InfoCardRow[] {
  const legacyRows = buildLegacyOpenMeldSkillNextStepRows(
    input.legacyFindings ?? []
  );
  if (input.targetCount === 0) {
    return [
      ...legacyRows,
      {
        label: "known agents",
        value: formatSkillsCommand("openmeld skills install --all"),
      },
      {
        label: "custom path",
        value: formatSkillsCommand(
          "openmeld skills install --dir <absolute-path>"
        ),
      },
    ];
  }

  const rows: InfoCardRow[] = [];
  rows.push(...legacyRows);
  if (input.summary.missing > 0) {
    rows.push({
      label: "install missing",
      value: pc.bold(
        formatInlineOpenMeldCliCommands(
          "Run `openmeld skills install --all` or `openmeld skills install --agent <id...>` to install missing OpenMeld skills."
        )
      ),
    });
  }
  if (input.summary.outdated > 0) {
    rows.push({
      label: "update outdated",
      value: pc.bold(
        formatInlineOpenMeldCliCommands(
          "Run `openmeld skills update` to update OpenMeld CLI skills to the latest version."
        )
      ),
    });
  }
  if (input.summary.externalConflict > 0) {
    rows.push({
      label: "review non-OpenMeld skills",
      value: pc.bold(
        formatInlineOpenMeldCliCommands(
          "Review the listed non-OpenMeld skills. OpenMeld will not overwrite them automatically. Rename or remove the ones you do not need, then run `openmeld skills install --all`."
        )
      ),
    });
  }
  return rows;
}

export function summarizeSkillsCheckTargets(input: {
  targets: SkillsInstallTarget[];
  states: SkillInstallStateResult[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  customTargets: RuntimeSkillsCustomTarget[];
}): SkillsCheckTargetState[] {
  const customTargetNameByDir = new Map(
    input.customTargets.map((target) => [target.dir, target.name])
  );
  const targetByKey = new Map<string, SkillsCheckTargetAccumulator>();

  for (const target of input.targets) {
    const key = toTargetKey(target.id, target.dir);
    targetByKey.set(key, {
      ...createSkillsCheckTargetAccumulator({
        targetId: target.id,
        targetDir: target.dir,
        targetType: target.type,
        registry: input.registry,
        customTargetNameByDir,
      }),
    });
  }

  for (const state of input.states) {
    const key = toTargetKey(state.targetId, state.targetDir);
    const target =
      targetByKey.get(key) ??
      createSkillsCheckTargetAccumulator({
        targetId: state.targetId,
        targetDir: state.targetDir,
        targetType: state.targetType,
        registry: input.registry,
        customTargetNameByDir,
      });
    if (!targetByKey.has(key)) {
      targetByKey.set(key, target);
    }

    applySkillStateToTargetAccumulator(target, state);
  }

  return [...targetByKey.values()]
    .map(projectSkillsCheckTargetState)
    .sort((left, right) =>
      `${left.targetType}:${left.targetId}:${left.targetDir}`.localeCompare(
        `${right.targetType}:${right.targetId}:${right.targetDir}`
      )
    );
}

function createSkillsCheckTargetAccumulator(input: {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  customTargetNameByDir: Map<string, string>;
}): SkillsCheckTargetAccumulator {
  const identity = resolveSkillsCheckTargetIdentity({
    targetId: input.targetId,
    targetDir: input.targetDir,
    targetType: input.targetType,
    registry: input.registry,
    customTargetNameByDir: input.customTargetNameByDir,
  });
  return {
    targetId: input.targetId,
    targetDir: input.targetDir,
    targetType: input.targetType,
    targetLabel: identity.targetLabel,
    targetName: identity.targetName,
    targetNameKind: identity.targetNameKind,
    missingSkillIds: new Set<string>(),
    outdatedSkillIds: new Set<string>(),
    upToDateSkillIds: new Set<string>(),
    conflictSkillIds: new Set<string>(),
  };
}

function resolveSkillsCheckTargetIdentity(input: {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  customTargetNameByDir: Map<string, string>;
}): {
  targetLabel: string;
  targetName: string;
  targetNameKind: "agent" | "custom";
} {
  if (input.targetType === "agent") {
    const targetName = resolveAgentDisplayName({
      targetId: input.targetId,
      registry: input.registry,
    });
    return {
      targetLabel: `agent ${targetName} (${input.targetId})`,
      targetName,
      targetNameKind: "agent",
    };
  }

  const customName = input.customTargetNameByDir.get(input.targetDir);
  const targetName = customName ?? input.targetId;
  if (targetName === input.targetId) {
    return {
      targetLabel: `custom ${input.targetId}`,
      targetName,
      targetNameKind: "custom",
    };
  }
  return {
    targetLabel: `custom ${targetName} (${input.targetId})`,
    targetName,
    targetNameKind: "custom",
  };
}

function applySkillStateToTargetAccumulator(
  target: SkillsCheckTargetAccumulator,
  state: SkillInstallStateResult
): void {
  if (state.state === "missing") {
    target.missingSkillIds.add(state.skillId);
    return;
  }
  if (state.state === "outdated") {
    target.outdatedSkillIds.add(state.skillId);
    return;
  }
  if (state.state === "up_to_date") {
    target.upToDateSkillIds.add(state.skillId);
    return;
  }
  target.conflictSkillIds.add(state.skillId);
}

function projectSkillsCheckTargetState(
  target: SkillsCheckTargetAccumulator
): SkillsCheckTargetState {
  const missingSkillIds = [...target.missingSkillIds].sort((a, b) =>
    a.localeCompare(b)
  );
  const outdatedSkillIds = [...target.outdatedSkillIds].sort((a, b) =>
    a.localeCompare(b)
  );
  const conflictSkillIds = [...target.conflictSkillIds].sort((a, b) =>
    a.localeCompare(b)
  );
  const installed =
    target.upToDateSkillIds.size > 0 || target.outdatedSkillIds.size > 0;
  const latest =
    installed &&
    missingSkillIds.length === 0 &&
    outdatedSkillIds.length === 0 &&
    conflictSkillIds.length === 0;
  return {
    targetId: target.targetId,
    targetDir: target.targetDir,
    targetType: target.targetType,
    targetLabel: target.targetLabel,
    targetName: target.targetName,
    targetNameKind: target.targetNameKind,
    installed,
    latest,
    missingSkillIds,
    outdatedSkillIds,
    conflictSkillIds,
  };
}

function resolveAgentDisplayName(input: {
  targetId: string;
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
}): string {
  return input.registry[input.targetId]?.displayName ?? input.targetId;
}
