import pc from "picocolors";
import { skillsDir } from "../config/paths";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import type { SkillsInstallResult } from "../skills/installer";
import type { LegacyOpenMeldSkillFinding } from "../skills/legacy-audit";
import { buildSkillsTargetSelectionExamples } from "../skills/target-selection-contract";
import type { InfoCardRow } from "../ui/info-card";
import { outLine } from "../ui/io";
import { buildSkillsCheckHumanNextStepRows } from "./skills-check";
import {
  formatSkillsCommand,
  formatSkillsCopy,
  formatSkillsCount,
  formatSkillsStoreValue,
  renderSkillsTextCard,
} from "./skills-format";
import { emitLegacyOpenMeldSkillFindingsHumanCard } from "./skills-legacy-audit-view";

function buildLocalSkillsListRows(
  skills: Array<{
    name: string;
    relativePath: string;
  }>
): InfoCardRow[] {
  if (skills.length === 0) {
    return [
      {
        label: "status",
        value: pc.dim("none"),
      },
    ];
  }

  return skills.map((skill) => ({
    label: pc.bold(skill.name),
    value: pc.dim(skill.relativePath),
  }));
}

export function emitSkillsListHumanCards(input: {
  storeDir: string;
  skills: Array<{
    id: string;
    name: string;
    relativePath: string;
    absolutePath: string;
  }>;
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Store",
    rows: [
      {
        label: "store",
        value: formatSkillsStoreValue(input.storeDir),
      },
      {
        label: "available",
        value: formatSkillsCount(input.skills.length, "green"),
      },
    ],
  });

  outLine("");
  renderSkillsTextCard({
    title: `Local OpenMeld Skills (${input.skills.length})`,
    rows: buildLocalSkillsListRows(input.skills),
    compact: true,
  });
}

export function emitSkillsUpdateHumanResultCards(input: {
  storeDir: string;
  targetCount: number;
  summary: {
    upToDate: number;
    outdated: number;
    missing: number;
    externalConflict: number;
  };
  status: "no_targets" | "up_to_date";
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Update",
    rows: [
      {
        label: "status",
        value:
          input.status === "no_targets"
            ? `${pc.yellow("○")} No tracked OpenMeld skills install targets found.`
            : `${pc.green("✅")} All tracked OpenMeld skills are up to date.`,
      },
      {
        label: "store",
        value: formatSkillsStoreValue(input.storeDir),
      },
      {
        label: "tracked targets",
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
    ],
  });

  if (input.status === "no_targets") {
    outLine("");
    renderSkillsTextCard({
      title: "Next Steps",
      rows: [
        {
          label: "install first",
          value: pc.bold(
            formatInlineOpenMeldCliCommands(
              "Install first with `openmeld skills install`."
            )
          ),
        },
        ...buildSkillsCheckHumanNextStepRows({
          targetCount: 0,
          summary: input.summary,
        }),
      ],
      compact: true,
    });
  }
}

function emitSkillsHelpCards(input: {
  storeDir: string;
  commands: Array<{
    command: string;
    description: string;
  }>;
  customAgentSteps: string[];
  knownAgentIds: string[];
  skills: Array<{
    id: string;
    name: string;
    relativePath: string;
    absolutePath: string;
  }>;
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Command Reference",
    rows: input.commands.map((entry) => ({
      label: formatSkillsCommand(entry.command),
      value: pc.dim(entry.description),
    })),
    compact: true,
  });

  outLine("");
  renderSkillsTextCard({
    title: "Custom Agent Install",
    rows: input.customAgentSteps.map((step, index) => ({
      label: String(index + 1),
      value: formatSkillsCopy(step),
    })),
    compact: true,
  });

  outLine("");
  renderSkillsTextCard({
    title: "OpenMeld Skills Store",
    rows: [
      {
        label: "store",
        value: formatSkillsStoreValue(input.storeDir),
      },
      {
        label: "known agents",
        value:
          input.knownAgentIds.length > 0
            ? pc.bold(input.knownAgentIds.join(", "))
            : pc.dim("none"),
      },
      {
        label: "local skills",
        value: formatSkillsCount(input.skills.length, "green"),
      },
    ],
  });

  outLine("");
  renderSkillsTextCard({
    title: `Local OpenMeld Skills (${input.skills.length})`,
    rows: buildLocalSkillsListRows(input.skills),
    compact: true,
  });
}

export function emitInstallSummaryCardsForHuman(input: {
  storeDir: string;
  summary: {
    installed: number;
    skipped: number;
    failed: number;
    degradedToCopy: number;
  };
  installedTargets: Array<{
    targetId: string;
    targetDir: string;
    targetType: "agent" | "custom";
    skillIds: string[];
  }>;
  legacyFindings: LegacyOpenMeldSkillFinding[];
  skipped: SkillsInstallResult[];
  failed: SkillsInstallResult[];
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Installation Summary",
    rows: [
      { label: "Store", value: formatSkillsStoreValue(input.storeDir) },
      {
        label: "Installed",
        value: formatSkillsCount(input.summary.installed, "green"),
      },
      {
        label: "Skipped",
        value: formatSkillsCount(input.summary.skipped, "yellow"),
      },
      {
        label: "Failed",
        value: formatSkillsCount(input.summary.failed, "red"),
      },
      {
        label: "Copied instead of linked",
        value: formatSkillsCount(input.summary.degradedToCopy, "neutral"),
      },
    ],
  });

  if (input.installedTargets.length > 0) {
    outLine("");
    renderSkillsTextCard({
      title: `Installed Targets (${input.installedTargets.length})`,
      rows: input.installedTargets.map((target) => ({
        label:
          target.targetType === "agent"
            ? `🤖 ${target.targetId}`
            : `🧩 ${target.targetDir}`,
        value: target.skillIds.join(", "),
      })),
    });
  }

  if (input.skipped.length > 0) {
    outLine("");
    renderSkillsTextCard({
      title: `Skipped Items (${input.skipped.length})`,
      rows: input.skipped.map((entry) => ({
        label: `${entry.skillId} -> ${entry.targetId}`,
        value: entry.reason ?? "skipped",
      })),
    });
  }

  if (input.failed.length > 0) {
    outLine("");
    renderSkillsTextCard({
      title: `Failed Items (${input.failed.length})`,
      rows: input.failed.map((entry) => ({
        label: `${entry.skillId} -> ${entry.targetId}`,
        value: entry.reason ?? "unknown error",
      })),
    });
  }

  emitLegacyOpenMeldSkillFindingsHumanCard({
    legacyFindings: input.legacyFindings,
  });
}

export function emitManualInstallGuide(input: {
  agentExampleArg: string;
  command?: "ensure" | "install";
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
}): void {
  const command = input.command ?? "install";
  const examples = buildSkillsTargetSelectionExamples({
    agentExampleArg: input.agentExampleArg,
    command,
  });
  const lines = [
    `OpenMeld local skills directory: ${skillsDir()}`,
    "Use the folder above as the source of truth for OpenMeld skills.",
    `For known agents, run: ${examples[0]}`,
    `For a custom agent path, run: ${examples[2]}`,
  ];

  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: `skills.${command}.guide`,
      payload: {
        storeDir: skillsDir(),
        steps: lines,
      },
    });
    return;
  }

  renderSkillsTextCard({
    title: "OpenMeld Skills Manual Install",
    rows: [
      {
        label: "local skills directory",
        value: pc.bold(pc.cyan(skillsDir())),
      },
      {
        label: "source of truth",
        value: pc.dim(
          formatSkillsCopy(
            "Use the folder above as the source of truth for OpenMeld skills."
          )
        ),
      },
      {
        label: "",
        value: "",
      },
      {
        label: "known agents",
        value: formatSkillsCommand(
          examples[0] ?? "openmeld skills install --all"
        ),
      },
      {
        label: "custom agent path",
        value: formatSkillsCommand(
          examples[2] ?? "openmeld skills install --dir <absolute-path>"
        ),
      },
    ],
  });
}

export function emitSkillsHelp(input: {
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  knownAgentIds: string[];
  agentExampleArg: string;
  skills: Array<{
    id: string;
    name: string;
    relativePath: string;
    absolutePath: string;
  }>;
}): void {
  const installExamples = buildSkillsTargetSelectionExamples({
    agentExampleArg: input.agentExampleArg,
    command: "install",
  });
  const uninstallExamples = buildSkillsTargetSelectionExamples({
    agentExampleArg: input.agentExampleArg,
    command: "uninstall",
  });
  const commands = [
    {
      command: "openmeld skills",
      description:
        "Show this guide in non-interactive mode, or open interactive skills menu in human TTY mode",
    },
    {
      command: "openmeld skills list",
      description:
        "List all OpenMeld skills available in this OpenMeld installation",
    },
    {
      command: "openmeld skills check",
      description: "Check OpenMeld skills on your agents and saved installs",
    },
    {
      command: "openmeld skills update",
      description: "Update saved OpenMeld skill installs to the latest version",
    },
    {
      command: installExamples[0] ?? "openmeld skills install --all",
      description: "Install OpenMeld skills to all detected known agents",
    },
    {
      command:
        installExamples[1] ??
        `openmeld skills install --agent ${input.agentExampleArg}`,
      description:
        "Install OpenMeld skills to one or more known agents by id (space-separated)",
    },
    {
      command:
        installExamples[2] ?? "openmeld skills install --dir <absolute-path>",
      description:
        "Install OpenMeld skills to a custom agent skills directory (for unknown/custom agents)",
    },
    {
      command: installExamples[3] ?? "openmeld skills install --guide",
      description:
        "Print manual install guide and source OpenMeld skills directory",
    },
    {
      command: uninstallExamples[0] ?? "openmeld skills uninstall --all",
      description: "Uninstall OpenMeld skills from all detected known agents",
    },
    {
      command:
        uninstallExamples[1] ??
        `openmeld skills uninstall --agent ${input.agentExampleArg}`,
      description:
        "Uninstall OpenMeld skills from one or more known agents by id (space-separated)",
    },
    {
      command:
        uninstallExamples[2] ??
        "openmeld skills uninstall --dir <absolute-path>",
      description:
        "Uninstall OpenMeld skills from a custom agent skills directory (for unknown/custom agents)",
    },
  ];

  const customAgentSteps = [
    "Find your agent's skills directory path.",
    "Run `openmeld skills install --dir <absolute-path>` to install OpenMeld skills.",
    "If you do not know the path, run `openmeld skills install --guide`.",
  ];

  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "skills.help",
      payload: {
        mode: "non-interactive",
        storeDir: skillsDir(),
        commands,
        customAgentSteps,
        knownAgentIds: input.knownAgentIds,
        skills: input.skills,
      },
    });
    return;
  }

  emitSkillsHelpCards({
    storeDir: skillsDir(),
    commands,
    customAgentSteps,
    knownAgentIds: input.knownAgentIds,
    skills: input.skills,
  });
}
