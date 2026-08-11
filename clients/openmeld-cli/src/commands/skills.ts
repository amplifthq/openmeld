import { realpathSync } from "node:fs";
import { lstat, readlink, rm, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { cancel, isCancel, select } from "@clack/prompts";
import pc from "picocolors";
import { resolveInstallableAgentExamplePair } from "../agents/command-examples";
import { openMeldRootDir, skillsDir } from "../config/paths";
import {
  getConfiguredSkillsConfig,
  type RuntimeSkillsConfig,
  type RuntimeSkillsCustomTarget,
  type RuntimeSkillsInstallRecord,
  resolveRuntimeSkillsCustomTargetId,
  setConfiguredSkillsConfig,
  updateConfiguredSkillsConfig,
} from "../config/runtime-config";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import {
  createSkillsActionGuideError,
  createSkillsMenuGuideError,
} from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import { emitSkillsAgentOverview } from "../skills/agent-overview";
import {
  canManageRegistryAgentSkillTargets,
  detectInstalledSkillsAgents,
  resolveSkillsAgentRegistry,
} from "../skills/agents";
import {
  installSkillsToTargets,
  type SkillsInstallResult,
  type SkillsInstallTarget,
  withSkillsInstallLock,
} from "../skills/installer";
import {
  detectLegacyOpenMeldSkillCopies,
  type LegacyOpenMeldSkillFinding,
} from "../skills/legacy-audit";
import {
  resolveSkillInstallStateForTarget,
  resolveSkillsInstallStates,
  type SkillInstallStateResult,
} from "../skills/state";
import {
  ensureLocalSkills,
  isOpenMeldManagedSkillDir,
  type LocalSkill,
  listLocalSkills,
} from "../skills/store";
import {
  buildSkillsTargetSelectionExamples,
  getSkillsTargetSelectionOptionalArguments,
  getSkillsTargetSelectionRequiredArguments,
  validateSkillsTargetSelectionInput,
} from "../skills/target-selection-contract";
import { outLine } from "../ui/io";
import {
  promptSearchMultiselect,
  type SearchSelectItem,
} from "../ui/search-select";
import { promptTextEntry } from "../ui/text-entry";
import {
  emitInstallSummaryCardsForHuman,
  emitManualInstallGuide,
  emitSkillsHelp,
  emitSkillsListHumanCards,
  emitSkillsUpdateHumanResultCards,
} from "./skills-cards";
import {
  emitSkillsCheckHumanNextStepsCard,
  emitSkillsCheckHumanSummaryCard,
  emitSkillsCheckHumanTargetCards,
  runInteractiveSkillsCheckViewer,
  type SkillsCheckNavigationResult,
  summarizeSkillsCheckTargets,
} from "./skills-check";
import {
  formatSkillsCopy,
  formatSkillsCount,
  formatSkillsStoreValue,
  renderSkillsTextCard,
} from "./skills-format";
import {
  buildLegacyOpenMeldSkillAgentReview,
  emitLegacyOpenMeldSkillAgentAttention,
  emitLegacyOpenMeldSkillFindingsHumanCard,
  formatLegacyOpenMeldSkillFindingsForAgentView,
} from "./skills-legacy-audit-view";
import {
  INSTALL_RECORD_GROUP_SEPARATOR,
  toTargetKey,
} from "./skills-target-key";

type SkillsBaseInput = {
  view?: string;
  quiet?: boolean;
  suppressAgentOverview?: boolean;
};

type SkillsCheckInput = SkillsBaseInput & {
  allowBackToCaller?: boolean;
};

type SkillsInstallInput = SkillsBaseInput & {
  all?: boolean;
  agent?: string[];
  command?: "ensure" | "install";
  dir?: string;
  guide?: boolean;
  allowBackToCaller?: boolean;
};

type SkillsUninstallInput = SkillsBaseInput & {
  all?: boolean;
  agent?: string[];
  dir?: string;
  dryRun?: boolean;
  allowExternalTargets?: boolean;
  allowBackToCaller?: boolean;
};

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

const SKILLS_MENU_CHOICE = {
  install: "install",
  uninstall: "uninstall",
  check: "check",
  update: "update",
  list: "list",
  exit: "exit",
} as const;
const EXTERNAL_UNINSTALL_CONFIRM_TOKEN = "uninstall";

const INTERACTIVE_NAVIGATION_CHOICE = "__navigation__";

type SkillsCommandNavigationResult =
  | "completed"
  | "back"
  | "cancelled"
  | "guided";
type SkillsPromptResult<T> =
  | {
      status: "submitted";
      value: T;
    }
  | {
      status: "back" | "cancelled";
    };
type SkillsInteractiveInstallTargetResult =
  | SkillsPromptResult<SkillsInstallTarget[]>
  | {
      status: "guide";
    };
type SkillsTargetSelectionMode =
  | "explicit_dir"
  | "all"
  | "agent"
  | "interactive";
type ResolvedSkillsUninstallTargetsResult = SkillsPromptResult<{
  targets: SkillsInstallTarget[];
  targetSelectionMode: SkillsTargetSelectionMode;
}>;
type InteractiveSkillsTargetChoice = "select" | "all" | "custom";
type InteractiveSkillsInstallChoice = InteractiveSkillsTargetChoice | "guide";
type InteractiveSkillsTargetChoiceResult<TChoice> =
  | {
      status: "selected";
      value: TChoice;
    }
  | {
      status: "back" | "cancelled";
    };

const INTERACTIVE_SKILLS_MENU: Array<{
  value: (typeof SKILLS_MENU_CHOICE)[keyof typeof SKILLS_MENU_CHOICE];
  label: string;
  hint?: string;
}> = [
  {
    value: SKILLS_MENU_CHOICE.install,
    label: "Install",
    hint: "Install OpenMeld skills into local agent skills directories",
  },
  {
    value: SKILLS_MENU_CHOICE.uninstall,
    label: "Uninstall",
    hint: "Remove OpenMeld skills from selected targets",
  },
  {
    value: SKILLS_MENU_CHOICE.check,
    label: "Check",
    hint: "Check tracked targets for OpenMeld skills updates",
  },
  {
    value: SKILLS_MENU_CHOICE.update,
    label: "Update",
    hint: "Update tracked targets with outdated OpenMeld skills",
  },
  {
    value: SKILLS_MENU_CHOICE.list,
    label: "List",
    hint: "Show all skills currently available in this OpenMeld installation",
  },
  {
    value: SKILLS_MENU_CHOICE.exit,
    label: "Exit",
  },
];

export async function runSkills(input: SkillsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const allowPrompt = canUseInteractivePrompts(runtime);
  const presenter = createPresenter(runtime);
  if (!allowPrompt) {
    await runSkillsWithoutInteractiveMenu({
      runtime,
      presenter,
    });
    return;
  }

  while (true) {
    const choice = await select({
      message: "OpenMeld skills:",
      options: INTERACTIVE_SKILLS_MENU,
    });
    if (isCancel(choice) || choice === SKILLS_MENU_CHOICE.exit) {
      cancel("Cancelled.");
      return;
    }

    const shouldContinue = await handleInteractiveSkillsMenuChoice(
      choice,
      input
    );
    if (shouldContinue) {
      continue;
    }
    return;
  }
}

async function runSkillsWithoutInteractiveMenu(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<void> {
  await ensureLocalSkills();
  const skills = await listLocalSkills();
  const skillsConfig = await getConfiguredSkillsConfig();
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const knownAgentIds = Object.keys(registry).sort((a, b) =>
    a.localeCompare(b)
  );
  const agentExampleArg = resolveInstallableAgentExamplePair(registry);
  const normalizedSkills = skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    relativePath: skill.relativePath,
    absolutePath: skill.absolutePath,
  }));
  if (input.runtime.resolvedView === "agent") {
    emitSkillsAgentOverview({
      presenter: input.presenter,
      command: "menu",
      storeDir: skillsDir(),
      knownAgentIds,
      agentExampleArg,
      skills: normalizedSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
    throw createSkillsMenuGuideError({
      storeDir: skillsDir(),
      knownAgentIds,
      agentExampleArg,
      skills: normalizedSkills,
    });
  }
  emitSkillsHelp({
    resolvedView: input.runtime.resolvedView,
    presenter: input.presenter,
    knownAgentIds,
    agentExampleArg,
    skills: normalizedSkills,
  });
}

async function handleInteractiveSkillsMenuChoice(
  choice: (typeof SKILLS_MENU_CHOICE)[keyof typeof SKILLS_MENU_CHOICE],
  input: SkillsBaseInput
): Promise<boolean> {
  if (choice === SKILLS_MENU_CHOICE.list) {
    await runSkillsList(input);
    return false;
  }
  if (choice === SKILLS_MENU_CHOICE.update) {
    await runSkillsUpdate(input);
    return false;
  }
  if (choice === SKILLS_MENU_CHOICE.check) {
    const result = await runSkillsCheck({
      ...input,
      allowBackToCaller: true,
    });
    return result === "back";
  }
  if (choice === SKILLS_MENU_CHOICE.uninstall) {
    const result = await runSkillsUninstall({
      ...input,
      allowBackToCaller: true,
    });
    return result === "back";
  }
  const result = await runSkillsInstall({
    ...input,
    allowBackToCaller: true,
  });
  return result === "back";
}

export async function runSkillsList(input: SkillsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  await ensureLocalSkills();
  const skills = await listLocalSkills();
  const payload = {
    storeDir: skillsDir(),
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      relativePath: skill.relativePath,
      absolutePath: skill.absolutePath,
    })),
  };
  if (runtime.resolvedView === "agent" && !input.suppressAgentOverview) {
    emitSkillsAgentOverview({
      presenter,
      command: "list",
      storeDir: payload.storeDir,
      knownAgentIds: [],
      agentExampleArg: "<id...>",
      skills: payload.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "skills.list",
      payload,
    });
    return;
  }

  if (payload.skills.length === 0) {
    emitSkillsListHumanCards(payload);
    return;
  }

  emitSkillsListHumanCards(payload);
}

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

export async function runSkillsCheck(
  input: SkillsCheckInput
): Promise<SkillsCheckNavigationResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const allowPrompt = canUseInteractivePrompts(runtime);
  const presenter = createPresenter(runtime);
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
  const legacyFindings = await detectLegacyOpenMeldSkillCopies({
    registry,
    localSkills,
    targets: checkTargets,
  });
  const payloadLegacyFindings =
    runtime.resolvedView === "agent"
      ? formatLegacyOpenMeldSkillFindingsForAgentView(legacyFindings)
      : legacyFindings;
  await persistDetectedInstallStateFromCheck({ states });
  const summary = summarizeSkillState(states);
  const targetStates = summarizeSkillsCheckTargets({
    targets: checkTargets,
    states,
    registry,
    customTargets: skillsConfig?.customTargets ?? [],
  });
  const payload = {
    storeDir: skillsDir(),
    targets: checkTargets,
    summary,
    states,
    targetStates,
    legacyFindings: payloadLegacyFindings,
    legacyFindingCount: payloadLegacyFindings.length,
    legacyReview:
      payloadLegacyFindings.length > 0
        ? buildLegacyOpenMeldSkillAgentReview(payloadLegacyFindings)
        : null,
    requiresReview:
      summary.outdated > 0 ||
      summary.missing > 0 ||
      summary.externalConflict > 0 ||
      legacyFindings.length > 0,
  };
  if (runtime.resolvedView === "agent" && !input.suppressAgentOverview) {
    emitSkillsAgentOverview({
      presenter,
      command: "check",
      storeDir: payload.storeDir,
      knownAgentIds: Object.keys(registry).sort((a, b) => a.localeCompare(b)),
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      skills: localSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
  }

  if (input.quiet) {
    return "completed";
  }

  if (runtime.resolvedView === "agent") {
    emitLegacyOpenMeldSkillAgentAttention({
      legacyFindings: payloadLegacyFindings,
      presenter,
      source: "skills.check",
    });
    presenter.data({
      code: "skills.check.summary",
      payload,
    });
    return "completed";
  }

  if (
    allowPrompt &&
    runtime.resolvedView === "human" &&
    input.allowBackToCaller === true
  ) {
    return runInteractiveSkillsCheckViewer({
      storeDir: payload.storeDir,
      targetCount: checkTargets.length,
      summary,
      legacyFindings,
      targetStates,
      allowBackToCaller: input.allowBackToCaller === true,
    });
  }

  emitSkillsCheckHumanSummaryCard({
    storeDir: payload.storeDir,
    targetCount: checkTargets.length,
    summary,
    legacyFindings,
  });
  if (checkTargets.length > 0) {
    emitSkillsCheckHumanTargetCards({
      targetStates,
    });
  }
  emitLegacyOpenMeldSkillFindingsHumanCard({
    legacyFindings,
  });
  emitSkillsCheckHumanNextStepsCard({
    targetCount: checkTargets.length,
    summary,
    legacyFindings,
  });
  return "completed";
}

export async function runSkillsUpdate(input: SkillsBaseInput): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const skillsConfig = await getConfiguredSkillsConfig();
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const localSkills = await ensureLocalSkills();
  if (runtime.resolvedView === "agent") {
    emitSkillsAgentOverview({
      presenter,
      command: "update",
      storeDir: skillsDir(),
      knownAgentIds: Object.keys(registry).sort((a, b) => a.localeCompare(b)),
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      skills: localSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
  }
  const trackedTargets = await resolveTrackedInstallTargets({
    skillsConfig,
    registry,
    localSkills,
    onlyOpenMeldInstalledTargets: true,
  });
  if (trackedTargets.length === 0) {
    if (runtime.resolvedView === "agent") {
      presenter.data({
        code: "skills.update.summary",
        payload: {
          storeDir: skillsDir(),
          targets: [],
          summary: {
            installed: 0,
            skipped: 0,
            failed: 0,
            degradedToCopy: 0,
          },
          results: [],
          message: "no tracked install targets",
        },
      });
      return;
    }
    emitSkillsUpdateHumanResultCards({
      storeDir: skillsDir(),
      targetCount: 0,
      summary: {
        upToDate: 0,
        outdated: 0,
        missing: 0,
        externalConflict: 0,
      },
      status: "no_targets",
    });
    return;
  }

  const states = await resolveSkillsInstallStates({
    skills: localSkills,
    targets: trackedTargets,
  });
  const stateSummary = summarizeSkillState(states);
  const actionableTargetKeys = new Set(
    states
      .filter(
        (state) => state.state === "missing" || state.state === "outdated"
      )
      .map(
        (state) =>
          `${state.targetId}${INSTALL_RECORD_GROUP_SEPARATOR}${state.targetDir}`
      )
  );

  if (actionableTargetKeys.size === 0) {
    if (runtime.resolvedView === "agent") {
      presenter.data({
        code: "skills.update.summary",
        payload: {
          storeDir: skillsDir(),
          targets: trackedTargets,
          summary: {
            installed: 0,
            skipped: 0,
            failed: 0,
            degradedToCopy: 0,
          },
          results: [],
          stateSummary,
          message: "all tracked skills are up to date",
        },
      });
      return;
    }
    emitSkillsUpdateHumanResultCards({
      storeDir: skillsDir(),
      targetCount: trackedTargets.length,
      summary: stateSummary,
      status: "up_to_date",
    });
    return;
  }

  const targets = trackedTargets.filter((target) =>
    actionableTargetKeys.has(
      `${target.id}${INSTALL_RECORD_GROUP_SEPARATOR}${target.dir}`
    )
  );

  const installResults = await withSkillsInstallLock(async () =>
    installSkillsToTargets({
      skills: localSkills,
      targets,
    })
  );
  await persistSkillsInstallState({
    previousSkillsConfig: skillsConfig,
    targets,
    installResults,
  });
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "skills.update.summary",
      payload: {
        storeDir: skillsDir(),
        targets,
        summary: summarizeInstallResults(installResults),
        results: installResults,
        stateSummary,
      },
    });
    return;
  }

  emitInstallSummary({
    resolvedView: runtime.resolvedView,
    presenter,
    installResults,
    storeDir: skillsDir(),
  });
}

export async function runSkillsEnsure(
  input: SkillsInstallInput
): Promise<SkillsCommandNavigationResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const skillsConfig = await getConfiguredSkillsConfig();
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const localSkills = await ensureLocalSkills();
  if (runtime.resolvedView === "agent" && !input.suppressAgentOverview) {
    emitSkillsAgentOverview({
      presenter,
      command: "ensure",
      storeDir: skillsDir(),
      knownAgentIds: Object.keys(registry).sort((a, b) => a.localeCompare(b)),
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      skills: localSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
  }
  const { hasExplicitInstallArgs } = resolveSkillsInstallSelectionInput(
    input,
    "ensure"
  );
  if (!hasExplicitInstallArgs && runtime.resolvedView === "agent") {
    throw createSkillsActionGuideError({
      action: "ensure",
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
    });
  }

  if (input.guide) {
    emitManualInstallGuide({
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      command: "ensure",
      presenter,
      resolvedView: runtime.resolvedView,
    });
    return "guided";
  }

  return await runSkillsInstall({
    ...input,
    command: "ensure",
    suppressAgentOverview: true,
  });
}

export async function runSkillsInstall(
  input: SkillsInstallInput
): Promise<SkillsCommandNavigationResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const allowPrompt = canUseInteractivePrompts(runtime);
  const command = input.command ?? "install";

  const skillsConfig = await getConfiguredSkillsConfig();
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const registryKeys = Object.keys(registry).sort((a, b) => a.localeCompare(b));
  const installableRegistryKeys = resolveInstallableAgentIds(registry).sort(
    (a, b) => a.localeCompare(b)
  );
  const installedAgents = await detectInstalledSkillsAgents(registry);
  const localSkills = await ensureLocalSkills();
  if (runtime.resolvedView === "agent" && !input.suppressAgentOverview) {
    emitSkillsAgentOverview({
      presenter,
      command,
      storeDir: skillsDir(),
      knownAgentIds: registryKeys,
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      skills: localSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
  }

  const { explicitAgents, explicitDir, hasExplicitInstallArgs } =
    resolveSkillsInstallSelectionInput(input, command);

  if (input.guide) {
    emitManualInstallGuide({
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      command,
      presenter,
      resolvedView: runtime.resolvedView,
    });
    return "guided";
  }

  let targets: SkillsInstallTarget[] = [];
  if (explicitDir.length > 0) {
    const customDir = resolve(explicitDir);
    await assertDirectoryExists(customDir);
    targets = [buildCustomSkillsTarget(customDir, skillsConfig)];
  } else if (input.all === true) {
    if (
      command === "ensure" &&
      installedAgents.length === 0 &&
      !canManageRegistryAgentSkillTargets()
    ) {
      // Lane-specific OpenMeld homes have no managed agent targets, and ensure
      // must stay a safe no-op there so setup completes inside dev lanes
      // instead of failing on the published home's agent directories.
      emitInstallSummary({
        resolvedView: runtime.resolvedView,
        presenter,
        installResults: [],
        quiet: input.quiet,
        storeDir: skillsDir(),
      });
      return "completed";
    }
    targets = resolveDetectedInstallableTargetsOrThrow({
      installedAgents,
      registry,
      action: command,
    });
  } else if (explicitAgents.length > 0) {
    targets = resolveExplicitAgentTargetsOrThrow({
      action: command,
      explicitAgents,
      registry,
      registryKeys,
      installableRegistryKeys,
    });
  } else if (!hasExplicitInstallArgs && allowPrompt) {
    const interactiveTargets = await resolveInteractiveInstallTargets({
      registry,
      installedAgents,
      skillsConfig,
      localSkills,
      allowBackToCaller: input.allowBackToCaller === true,
    });
    if (interactiveTargets.status === "guide") {
      emitManualInstallGuide({
        agentExampleArg: resolveInstallableAgentExamplePair(registry),
        presenter,
        resolvedView: runtime.resolvedView,
      });
      return "guided";
    }
    if (interactiveTargets.status !== "submitted") {
      return handleSkillsCommandExit({
        status: interactiveTargets.status,
        allowBackToCaller: input.allowBackToCaller === true,
      });
    }
    targets = interactiveTargets.value;
  } else {
    if (runtime.resolvedView === "agent") {
      throw createSkillsActionGuideError({
        action: command,
        agentExampleArg: resolveInstallableAgentExamplePair(registry),
      });
    }
    throw new Error(buildNonInteractiveInstallError(registry, command));
  }

  if (targets.length === 0) {
    throw new Error(
      formatInlineOpenMeldCliCommands(
        `no ${command} targets resolved; use \`openmeld skills ${command} --all\`, \`--agent\`, or \`--dir\``
      )
    );
  }

  const installResults = await withSkillsInstallLock(async () =>
    installSkillsToTargets({
      skills: localSkills,
      targets,
    })
  );
  const legacyFindings = await detectLegacyOpenMeldSkillCopies({
    registry,
    localSkills,
    targets,
  });

  await persistSkillsInstallState({
    previousSkillsConfig: skillsConfig,
    targets,
    installResults,
  });
  emitInstallSummary({
    resolvedView: runtime.resolvedView,
    presenter,
    installResults,
    legacyFindings,
    quiet: input.quiet,
    storeDir: skillsDir(),
  });
  return "completed";
}

type SkillsUninstallStatus = "removed" | "skipped" | "blocked" | "failed";

type SkillsUninstallResult = {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  skillId: string;
  status: SkillsUninstallStatus;
  reason?: string;
};

export async function runSkillsUninstall(
  input: SkillsUninstallInput
): Promise<SkillsCommandNavigationResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const allowPrompt = canUseInteractivePrompts(runtime);
  const skillsConfig = await getConfiguredSkillsConfig();
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const registryKeys = Object.keys(registry).sort((a, b) => a.localeCompare(b));
  const installableRegistryKeys = resolveInstallableAgentIds(registry).sort(
    (a, b) => a.localeCompare(b)
  );
  const installedAgents = await detectInstalledSkillsAgents(registry);
  const localSkills = await ensureLocalSkills();
  if (runtime.resolvedView === "agent") {
    emitSkillsAgentOverview({
      presenter,
      command: "uninstall",
      storeDir: skillsDir(),
      knownAgentIds: registryKeys,
      agentExampleArg: resolveInstallableAgentExamplePair(registry),
      skills: localSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        relativePath: skill.relativePath,
      })),
    });
  }

  const explicitDir = String(input.dir ?? "").trim();
  const explicitAgents = Array.from(
    new Set(
      (input.agent ?? [])
        .map((agent) => agent.trim().toLowerCase())
        .filter((agent) => agent.length > 0)
    )
  );
  const hasExplicitUninstallArgs =
    input.all === true || explicitAgents.length > 0 || explicitDir.length > 0;

  const hasInteractiveTargetSelection =
    !hasExplicitUninstallArgs && allowPrompt;

  while (true) {
    const targetResolution = await resolveSkillsUninstallTargets({
      runtimeResolvedView: runtime.resolvedView,
      allowPrompt,
      explicitDir,
      all: input.all === true,
      explicitAgents,
      registry,
      registryKeys,
      installableRegistryKeys,
      installedAgents,
      skillsConfig,
      localSkills,
      hasInteractiveTargetSelection,
      allowBackToCaller: input.allowBackToCaller === true,
    });
    if (targetResolution.status !== "submitted") {
      return handleSkillsCommandExit({
        status: targetResolution.status,
        allowBackToCaller: input.allowBackToCaller === true,
      });
    }

    const { targets, targetSelectionMode } = targetResolution.value;
    assertResolvedSkillsTargets(targets, "uninstall");

    if (input.dryRun === true) {
      emitUninstallDryRunPreview({
        resolvedView: runtime.resolvedView,
        presenter,
        storeDir: skillsDir(),
        openMeldHomeDir: openMeldRootDir(),
        targetAudits: summarizeUninstallTargetAudits({
          targets,
          openMeldHomeDir: openMeldRootDir(),
        }),
        skillIds: localSkills.map((skill) => skill.id),
      });
      return "completed";
    }

    const confirmationResult = await confirmSkillsUninstallTargets({
      allowPrompt,
      allowExternalTargets: input.allowExternalTargets === true,
      hasInteractiveTargetSelection,
      targetSelectionMode,
      targets,
    });
    if (confirmationResult === "back") {
      continue;
    }
    if (confirmationResult === "cancelled") {
      return handleSkillsCommandExit({
        status: "cancelled",
        allowBackToCaller: input.allowBackToCaller === true,
      });
    }

    await executeSkillsUninstall({
      runtimeResolvedView: runtime.resolvedView,
      presenter,
      skillsConfig,
      localSkills,
      targets,
    });
    return "completed";
  }
}

async function resolveSkillsUninstallTargets(input: {
  runtimeResolvedView: "human" | "agent";
  allowPrompt: boolean;
  explicitDir: string;
  all: boolean;
  explicitAgents: string[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  registryKeys: string[];
  installableRegistryKeys: string[];
  installedAgents: string[];
  skillsConfig: RuntimeSkillsConfig | null;
  localSkills: LocalSkill[];
  hasInteractiveTargetSelection: boolean;
  allowBackToCaller: boolean;
}): Promise<ResolvedSkillsUninstallTargetsResult> {
  if (
    input.all ||
    input.explicitAgents.length > 0 ||
    input.explicitDir.length > 0
  ) {
    validateSkillsTargetSelectionInput({
      all: input.all,
      command: "uninstall",
      explicitAgentIds: input.explicitAgents,
      explicitDir: input.explicitDir.length > 0 ? input.explicitDir : null,
    });
  }

  if (input.explicitDir.length > 0) {
    return {
      status: "submitted",
      value: {
        targets: [
          buildCustomSkillsTarget(
            resolve(input.explicitDir),
            input.skillsConfig
          ),
        ],
        targetSelectionMode: "explicit_dir",
      },
    };
  }
  if (input.all) {
    return {
      status: "submitted",
      value: {
        targets: resolveDetectedInstallableTargetsOrThrow({
          installedAgents: input.installedAgents,
          registry: input.registry,
          action: "uninstall",
        }),
        targetSelectionMode: "all",
      },
    };
  }
  if (input.explicitAgents.length > 0) {
    return {
      status: "submitted",
      value: {
        targets: resolveExplicitAgentTargetsOrThrow({
          action: "uninstall",
          explicitAgents: input.explicitAgents,
          registry: input.registry,
          registryKeys: input.registryKeys,
          installableRegistryKeys: input.installableRegistryKeys,
        }),
        targetSelectionMode: "agent",
      },
    };
  }
  if (input.hasInteractiveTargetSelection) {
    const interactiveTargets = await resolveInteractiveUninstallTargets({
      registry: input.registry,
      installedAgents: input.installedAgents,
      skillsConfig: input.skillsConfig,
      localSkills: input.localSkills,
      allowBackToCaller: input.allowBackToCaller,
    });
    if (interactiveTargets.status !== "submitted") {
      return interactiveTargets;
    }
    return {
      status: "submitted",
      value: {
        targets: interactiveTargets.value,
        targetSelectionMode: "interactive",
      },
    };
  }
  if (input.runtimeResolvedView === "agent") {
    throw createSkillsActionGuideError({
      action: "uninstall",
      agentExampleArg: resolveInstallableAgentExamplePair(input.registry),
    });
  }
  throw new Error(buildNonInteractiveUninstallError(input.registry));
}

function assertResolvedSkillsTargets(
  targets: SkillsInstallTarget[],
  action: "install" | "uninstall"
): void {
  if (targets.length > 0) {
    return;
  }
  throw new Error(
    formatInlineOpenMeldCliCommands(
      `no ${action} targets resolved; use \`openmeld skills ${action} --all\`, \`--agent\`, or \`--dir\``
    )
  );
}

async function confirmSkillsUninstallTargets(input: {
  allowPrompt: boolean;
  allowExternalTargets: boolean;
  hasInteractiveTargetSelection: boolean;
  targetSelectionMode: SkillsTargetSelectionMode;
  targets: SkillsInstallTarget[];
}): Promise<"confirmed" | "back" | "cancelled"> {
  if (input.targetSelectionMode === "explicit_dir") {
    return "confirmed";
  }
  const confirmed = await ensureExternalUninstallTargetsConfirmed({
    allowPrompt: input.allowPrompt,
    allowExternalTargets: input.allowExternalTargets,
    targetAudits: summarizeUninstallTargetAudits({
      targets: input.targets,
      openMeldHomeDir: openMeldRootDir(),
    }),
    allowBack:
      input.hasInteractiveTargetSelection &&
      input.targetSelectionMode === "interactive",
  });
  return confirmed.status;
}

async function executeSkillsUninstall(input: {
  runtimeResolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  skillsConfig: RuntimeSkillsConfig | null;
  localSkills: LocalSkill[];
  targets: SkillsInstallTarget[];
}): Promise<void> {
  const uninstallResults = await withSkillsInstallLock(async () => {
    const results = await uninstallSkillsFromTargets({
      skills: input.localSkills,
      targets: input.targets,
    });
    const successfullyUninstalledTargets = selectSuccessfullyUninstalledTargets(
      {
        targets: input.targets,
        uninstallResults: results,
      }
    );
    await persistSkillsUninstallState({
      previousSkillsConfig: input.skillsConfig,
      targets: successfullyUninstalledTargets,
    });
    return results;
  });
  emitUninstallSummary({
    resolvedView: input.runtimeResolvedView,
    presenter: input.presenter,
    uninstallResults,
    storeDir: skillsDir(),
  });
}

async function resolveInteractiveUninstallTargets(input: {
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  installedAgents: string[];
  skillsConfig: RuntimeSkillsConfig | null;
  localSkills: LocalSkill[];
  allowBackToCaller: boolean;
}): Promise<SkillsPromptResult<SkillsInstallTarget[]>> {
  const detectedAgentTargets = buildAgentTargets(
    input.installedAgents,
    input.registry
  );
  const uninstallableAgentTargets =
    await filterTargetsWithInstalledOpenMeldSkills({
      targets: detectedAgentTargets,
      localSkills: input.localSkills,
    });
  const uninstallableAgentIds = uninstallableAgentTargets.map(
    (target) => target.id
  );

  while (true) {
    const action = await promptInteractiveUninstallTargetChoice({
      hasAgentTargets: uninstallableAgentIds.length > 0,
      allowBackToCaller: input.allowBackToCaller,
    });
    if (action.status !== "selected") {
      return action;
    }

    const resolvedTargets = await resolveInteractiveUninstallTargetAction({
      action: action.value,
      uninstallableAgentTargets,
      uninstallableAgentIds,
      registry: input.registry,
      skillsConfig: input.skillsConfig,
    });
    if (resolvedTargets.status === "back") {
      continue;
    }
    return resolvedTargets;
  }
}

async function promptForCustomSkillsDirForUninstall(): Promise<
  SkillsPromptResult<string>
> {
  for (;;) {
    const answer = await promptTextEntry({
      message: "Custom agent skills directory (absolute path)",
      placeholder: "/Users/<you>/.your-agent/skills",
      allowBack: true,
      backLabel: "Back",
      requiredMessage: "Path cannot be empty.",
    });
    if (answer.status !== "submitted") {
      return answer;
    }

    const trimmed = String(answer.value ?? "").trim();
    if (!trimmed) {
      process.stderr.write("Path cannot be empty.\n");
      continue;
    }

    const resolvedDir = resolve(trimmed);
    const stats = await stat(resolvedDir).catch(() => null);
    if (!stats) {
      process.stderr.write(
        "Path does not exist. Enter an existing directory path.\n"
      );
      continue;
    }
    if (!stats.isDirectory()) {
      process.stderr.write("Path is not a directory.\n");
      continue;
    }
    return {
      status: "submitted",
      value: resolvedDir,
    };
  }
}

function buildNonInteractiveUninstallError(
  registry: ReturnType<typeof resolveSkillsAgentRegistry>
): string {
  const examples = buildSkillsTargetSelectionExamples({
    agentExampleArg: resolveInstallableAgentExamplePair(registry),
    command: "uninstall",
  });
  return formatSkillsCopy(
    [
      "openmeld skills uninstall requires explicit target selection in non-interactive mode.",
      "",
      "Required:",
      ...getSkillsTargetSelectionRequiredArguments("uninstall").map(
        (argument) => `  ${argument}`
      ),
      "",
      "Optional:",
      ...getSkillsTargetSelectionOptionalArguments("uninstall").map(
        (argument) => `  ${argument}`
      ),
      "",
      "examples:",
      ...examples.map((command) => `  ${command}`),
    ].join("\n")
  );
}

type SkillsUninstallTargetAudit = {
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  location: "openmeld_home" | "external";
};

function summarizeUninstallTargetAudits(input: {
  targets: SkillsInstallTarget[];
  openMeldHomeDir: string;
}): SkillsUninstallTargetAudit[] {
  const openMeldHomeDir = resolve(input.openMeldHomeDir);
  return input.targets.map((target) => ({
    targetId: target.id,
    targetDir: target.dir,
    targetType: target.type,
    location: isPathInsideRoot({
      rootDir: openMeldHomeDir,
      candidatePath: target.dir,
    })
      ? "openmeld_home"
      : "external",
  }));
}

async function ensureExternalUninstallTargetsConfirmed(input: {
  allowPrompt: boolean;
  allowExternalTargets: boolean;
  targetAudits: SkillsUninstallTargetAudit[];
  allowBack: boolean;
}): Promise<
  | {
      status: "confirmed";
    }
  | {
      status: "back" | "cancelled";
    }
> {
  const externalTargets = input.targetAudits.filter(
    (target) => target.location === "external"
  );
  if (externalTargets.length === 0 || input.allowExternalTargets) {
    return {
      status: "confirmed",
    };
  }

  const externalTargetLines = externalTargets
    .map((target) => `  - ${target.targetDir}`)
    .join("\n");
  if (!input.allowPrompt) {
    throw new Error(
      formatSkillsCopy(
        [
          "skills uninstall detected targets outside this OpenMeld installation.",
          "external targets:",
          externalTargetLines,
          "re-run with one of:",
          "  openmeld skills uninstall --all --dry-run",
          "  openmeld skills uninstall --all --allow-external-targets",
        ].join("\n")
      )
    );
  }

  while (true) {
    const firstConfirm = await select({
      message: [
        `Detected ${externalTargets.length} uninstall target(s) outside this OpenMeld installation:`,
        externalTargetLines,
        "Continue?",
      ].join("\n"),
      initialValue: "continue",
      options: [
        {
          value: "continue",
          label: "Continue",
        },
        ...(input.allowBack
          ? [
              {
                value: "back",
                label: "Back",
              },
            ]
          : []),
        {
          value: "cancel",
          label: "Cancel",
        },
      ],
    });
    if (isCancel(firstConfirm) || firstConfirm === "cancel") {
      return {
        status: "cancelled",
      };
    }
    if (firstConfirm === "back") {
      return {
        status: "back",
      };
    }

    const secondConfirm = await promptTextEntry({
      message: 'Type "UNINSTALL" to confirm external target removal',
      placeholder: "UNINSTALL",
      allowBack: input.allowBack,
      backLabel: "Back",
      requiredMessage: 'Type "UNINSTALL" to continue.',
    });
    if (secondConfirm.status === "back") {
      continue;
    }
    if (secondConfirm.status === "cancelled") {
      return {
        status: "cancelled",
      };
    }
    if (
      normalizeExternalUninstallConfirm(secondConfirm.value) !==
      EXTERNAL_UNINSTALL_CONFIRM_TOKEN
    ) {
      process.stderr.write('Type "UNINSTALL" to continue.\n');
      continue;
    }
    return {
      status: "confirmed",
    };
  }
}

function emitUninstallDryRunPreview(input: {
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  storeDir: string;
  openMeldHomeDir: string;
  targetAudits: SkillsUninstallTargetAudit[];
  skillIds: string[];
}): void {
  const externalTargets = input.targetAudits.filter(
    (target) => target.location === "external"
  );
  const payload = {
    storeDir: input.storeDir,
    openMeldHomeDir: input.openMeldHomeDir,
    targetCount: input.targetAudits.length,
    externalTargetCount: externalTargets.length,
    skillIds: input.skillIds,
    targets: input.targetAudits,
  };

  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "skills.uninstall.preview",
      payload,
    });
    return;
  }

  emitSkillsUninstallDryRunCards({
    storeDir: input.storeDir,
    openMeldHomeDir: input.openMeldHomeDir,
    targetAudits: input.targetAudits,
    externalTargetCount: externalTargets.length,
    skillIds: input.skillIds,
  });
}

function normalizeExternalUninstallConfirm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isPathInsideRoot(input: {
  rootDir: string;
  candidatePath: string;
}): boolean {
  const rootDir = resolveAuditPath(input.rootDir);
  const candidatePath = resolveAuditPath(input.candidatePath);
  const relativePath = relative(rootDir, candidatePath);
  if (relativePath.length === 0) {
    return true;
  }
  if (relativePath.startsWith("..")) {
    return false;
  }
  return !isAbsolute(relativePath);
}

function resolveAuditPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

async function uninstallSkillsFromTargets(input: {
  skills: LocalSkill[];
  targets: SkillsInstallTarget[];
}): Promise<SkillsUninstallResult[]> {
  const results: SkillsUninstallResult[] = [];
  for (const target of input.targets) {
    for (const skill of input.skills) {
      const result = await uninstallOneSkillFromTarget({
        target,
        skill,
      });
      results.push(result);
    }
  }
  return results;
}

async function uninstallOneSkillFromTarget(input: {
  target: SkillsInstallTarget;
  skill: LocalSkill;
}): Promise<SkillsUninstallResult> {
  const skillDir = join(input.target.dir, input.skill.id);
  const targetBase = {
    targetId: input.target.id,
    targetDir: input.target.dir,
    targetType: input.target.type,
    skillId: input.skill.id,
  } as const;

  const skillStats = await lstat(skillDir).catch(() => null);
  if (!skillStats) {
    return {
      ...targetBase,
      status: "skipped",
      reason: "skill not found",
    };
  }

  const managedDirectly = await isOpenMeldManagedSkillDir(skillDir);
  const managedViaSymlink = skillStats.isSymbolicLink()
    ? await resolveSymlinkTarget(skillDir)
        .then((resolved) => isOpenMeldManagedSkillDir(resolved))
        .catch(() => false)
    : false;

  if (!(managedDirectly || managedViaSymlink)) {
    return {
      ...targetBase,
      status: "blocked",
      reason: "existing non-OpenMeld skill detected; blocked",
    };
  }

  try {
    await rm(skillDir, { recursive: true, force: true });
    return {
      ...targetBase,
      status: "removed",
    };
  } catch (error) {
    return {
      ...targetBase,
      status: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "failed to uninstall skill from target",
    };
  }
}

async function persistSkillsUninstallState(input: {
  previousSkillsConfig: RuntimeSkillsConfig | null;
  targets: SkillsInstallTarget[];
}): Promise<void> {
  const removedTargetDirs = new Set(input.targets.map((target) => target.dir));
  const retainedInstalls = (input.previousSkillsConfig?.installs ?? []).filter(
    (record) => !removedTargetDirs.has(record.targetDir)
  );
  const retainedCustomTargets = (
    input.previousSkillsConfig?.customTargets ?? []
  ).filter((target) => !removedTargetDirs.has(target.dir));

  await setConfiguredSkillsConfig({
    storeDir: input.previousSkillsConfig?.storeDir ?? skillsDir(),
    ...(input.previousSkillsConfig?.agents
      ? { agents: input.previousSkillsConfig.agents }
      : {}),
    ...(retainedCustomTargets.length > 0
      ? { customTargets: retainedCustomTargets }
      : {}),
    installs: retainedInstalls,
  });
}

function selectSuccessfullyUninstalledTargets(input: {
  targets: SkillsInstallTarget[];
  uninstallResults: SkillsUninstallResult[];
}): SkillsInstallTarget[] {
  const unsuccessfulTargetDirs = new Set(
    input.uninstallResults
      .filter(
        (result) => result.status === "failed" || result.status === "blocked"
      )
      .map((result) => result.targetDir)
  );
  return input.targets.filter(
    (target) => !unsuccessfulTargetDirs.has(target.dir)
  );
}

function buildAgentTargets(
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

function buildCustomSkillsTarget(
  dir: string,
  skillsConfig?: RuntimeSkillsConfig | null
): SkillsInstallTarget {
  const knownTarget = skillsConfig?.customTargets?.find(
    (target) => target.dir === dir
  );
  const id = resolveRuntimeSkillsCustomTargetId({
    dir,
    ...(knownTarget?.id ? { id: knownTarget.id } : {}),
  });
  return {
    id,
    dir,
    type: "custom",
  };
}

function isLikelyCustomTargetId(value: string): boolean {
  return value.startsWith("custom-");
}

function resolveTrackedInstallTargets(input: {
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

function mergeTargetsByDir(input: {
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

async function filterTargetsWithInstalledOpenMeldSkills(input: {
  targets: SkillsInstallTarget[];
  localSkills: LocalSkill[];
}): Promise<SkillsInstallTarget[]> {
  const existingTargets = await filterExistingTargetDirs(input.targets);
  return filterInstalledTrackedTargets({
    candidates: existingTargets,
    localSkills: input.localSkills,
  });
}

async function filterTargetsNeedingInstallOrUpdate(input: {
  targets: SkillsInstallTarget[];
  localSkills: LocalSkill[];
}): Promise<SkillsInstallTarget[]> {
  if (input.targets.length === 0) {
    return [];
  }
  const states = await resolveSkillsInstallStates({
    skills: input.localSkills,
    targets: input.targets,
  });
  const actionableTargetKeys = new Set(
    states
      .filter(
        (state) => state.state === "missing" || state.state === "outdated"
      )
      .map((state) => toTargetKey(state.targetId, state.targetDir))
  );
  return input.targets.filter((target) =>
    actionableTargetKeys.has(toTargetKey(target.id, target.dir))
  );
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

function summarizeSkillState(states: SkillInstallStateResult[]): {
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

function emitSkillsUninstallDryRunCards(input: {
  storeDir: string;
  openMeldHomeDir: string;
  targetAudits: SkillsUninstallTargetAudit[];
  externalTargetCount: number;
  skillIds: string[];
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Uninstall Dry Run",
    rows: [
      {
        label: "status",
        value: `${pc.cyan("•")} dry-run complete: no files were removed.`,
      },
      {
        label: "store",
        value: formatSkillsStoreValue(input.storeDir),
      },
      {
        label: "OpenMeld home",
        value: pc.dim(input.openMeldHomeDir),
      },
      {
        label: "targets",
        value: formatSkillsCount(input.targetAudits.length, "neutral"),
      },
      {
        label: "external",
        value: formatSkillsCount(input.externalTargetCount, "yellow"),
      },
      {
        label: "skills",
        value:
          input.skillIds.length > 0
            ? pc.bold(input.skillIds.join(", "))
            : pc.dim("all OpenMeld skills"),
      },
    ],
  });

  outLine("");
  renderSkillsTextCard({
    title: `Target Preview (${input.targetAudits.length})`,
    rows:
      input.targetAudits.length > 0
        ? input.targetAudits.map((target) => ({
            label: [
              target.location === "external" ? pc.yellow("▲") : pc.cyan("•"),
              pc.bold(target.targetId),
            ].join(" "),
            value: [
              pc.dim(
                target.location === "external" ? "external" : "OpenMeld home"
              ),
              pc.dim(`${target.targetType} target`),
              pc.dim(`dir: ${target.targetDir}`),
            ].join(` ${pc.dim("·")} `),
          }))
        : [
            {
              label: "status",
              value: pc.dim("none"),
            },
          ],
    compact: true,
  });
}

function emitSkillsUninstallSummaryCardsForHuman(input: {
  storeDir: string;
  summary: {
    removed: number;
    skipped: number;
    blocked: number;
    failed: number;
  };
  failed: SkillsUninstallResult[];
  blocked: SkillsUninstallResult[];
  skipped: SkillsUninstallResult[];
}): void {
  renderSkillsTextCard({
    title: "OpenMeld Skills Uninstall Summary",
    rows: [
      {
        label: "store",
        value: formatSkillsStoreValue(input.storeDir),
      },
      {
        label: "removed",
        value: formatSkillsCount(input.summary.removed, "green"),
      },
      {
        label: "skipped",
        value: formatSkillsCount(input.summary.skipped, "yellow"),
      },
      {
        label: "blocked",
        value: formatSkillsCount(input.summary.blocked, "red"),
      },
      {
        label: "failed",
        value: formatSkillsCount(input.summary.failed, "red"),
      },
    ],
  });

  emitSkillsUninstallDetailCard({
    title: "Failed Items",
    entries: input.failed,
  });
  emitSkillsUninstallDetailCard({
    title: "Blocked Items",
    entries: input.blocked,
  });
  emitSkillsUninstallDetailCard({
    title: "Skipped Items",
    entries: input.skipped,
  });
}

function emitSkillsUninstallDetailCard(input: {
  title: string;
  entries: SkillsUninstallResult[];
}): void {
  outLine("");
  renderSkillsTextCard({
    title: `${input.title} (${input.entries.length})`,
    rows:
      input.entries.length > 0
        ? input.entries.map((entry) => ({
            label: pc.bold(`${entry.skillId} -> ${entry.targetId}`),
            value: [
              pc.dim(`${entry.targetType} target`),
              pc.dim(`dir: ${entry.targetDir}`),
              entry.reason ? pc.red(entry.reason) : pc.dim("unknown"),
            ].join(` ${pc.dim("·")} `),
          }))
        : [
            {
              label: "status",
              value: pc.dim("none"),
            },
          ],
    compact: true,
  });
}

function summarizeInstallResults(results: SkillsInstallResult[]): {
  installed: number;
  skipped: number;
  failed: number;
  degradedToCopy: number;
} {
  return {
    installed: results.filter((item) => item.status === "installed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length,
    degradedToCopy: results.filter((item) => item.degraded).length,
  };
}

function summarizeUninstallResults(results: SkillsUninstallResult[]): {
  removed: number;
  skipped: number;
  blocked: number;
  failed: number;
} {
  return {
    removed: results.filter((item) => item.status === "removed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    failed: results.filter((item) => item.status === "failed").length,
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

async function resolveSymlinkTarget(linkPath: string): Promise<string> {
  const target = await readlink(linkPath);
  return resolve(dirname(linkPath), target);
}

async function resolveInteractiveInstallTargets(input: {
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  installedAgents: string[];
  skillsConfig: RuntimeSkillsConfig | null;
  localSkills: LocalSkill[];
  allowBackToCaller: boolean;
}): Promise<SkillsInteractiveInstallTargetResult> {
  const detectedAgentTargets = buildAgentTargets(
    input.installedAgents,
    input.registry
  );
  const trackedTargets = await resolveTrackedInstallTargets({
    skillsConfig: input.skillsConfig,
    registry: input.registry,
    localSkills: input.localSkills,
    onlyOpenMeldInstalledTargets: false,
  });
  const installCandidateTargets = mergeTargetsByDir({
    primary: detectedAgentTargets,
    secondary: trackedTargets.filter((target) => target.type === "agent"),
  });
  const actionableAgentTargets = await filterTargetsNeedingInstallOrUpdate({
    targets: installCandidateTargets,
    localSkills: input.localSkills,
  });
  const actionableAgentIds = actionableAgentTargets.map((target) => target.id);

  while (true) {
    const action = await promptInteractiveInstallTargetChoice({
      hasAgentTargets: actionableAgentIds.length > 0,
      allowBackToCaller: input.allowBackToCaller,
    });
    if (action.status !== "selected") {
      return action;
    }
    if (action.value === "guide") {
      return {
        status: "guide",
      };
    }

    const resolvedTargets = await resolveInteractiveInstallTargetAction({
      action: action.value,
      actionableAgentTargets,
      actionableAgentIds,
      registry: input.registry,
      skillsConfig: input.skillsConfig,
    });
    if (resolvedTargets.status === "back") {
      continue;
    }
    return resolvedTargets;
  }
}

async function promptInteractiveUninstallTargetChoice(input: {
  hasAgentTargets: boolean;
  allowBackToCaller: boolean;
}): Promise<
  InteractiveSkillsTargetChoiceResult<InteractiveSkillsTargetChoice>
> {
  const action = await select({
    message: "Choose OpenMeld skills uninstall target",
    options: buildInteractiveUninstallTargetOptions({
      hasAgentTargets: input.hasAgentTargets,
      allowBackToCaller: input.allowBackToCaller,
    }),
  });
  return normalizeInteractiveSkillsTargetChoice({
    action,
    allowBackToCaller: input.allowBackToCaller,
  });
}

async function resolveInteractiveUninstallTargetAction(input: {
  action: InteractiveSkillsTargetChoice;
  uninstallableAgentTargets: SkillsInstallTarget[];
  uninstallableAgentIds: string[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  skillsConfig: RuntimeSkillsConfig | null;
}): Promise<SkillsPromptResult<SkillsInstallTarget[]>> {
  if (input.action === "custom") {
    return await resolveInteractiveCustomUninstallTarget(input.skillsConfig);
  }
  if (input.action === "all") {
    return {
      status: "submitted",
      value: input.uninstallableAgentTargets,
    };
  }
  return await promptSkillsAgentTargets({
    message: "Select agents to uninstall OpenMeld skills from",
    agentIds: input.uninstallableAgentIds,
    registry: input.registry,
  });
}

async function resolveInteractiveCustomUninstallTarget(
  skillsConfig: RuntimeSkillsConfig | null
): Promise<SkillsPromptResult<SkillsInstallTarget[]>> {
  const customDir = await promptForCustomSkillsDirForUninstall();
  if (customDir.status !== "submitted") {
    return customDir;
  }
  return {
    status: "submitted",
    value: [buildCustomSkillsTarget(customDir.value, skillsConfig)],
  };
}

async function promptInteractiveInstallTargetChoice(input: {
  hasAgentTargets: boolean;
  allowBackToCaller: boolean;
}): Promise<
  InteractiveSkillsTargetChoiceResult<InteractiveSkillsInstallChoice>
> {
  const action = await select<
    InteractiveSkillsInstallChoice | typeof INTERACTIVE_NAVIGATION_CHOICE
  >({
    message: "How do you want to install OpenMeld skills?",
    initialValue: "all",
    options: buildInteractiveInstallTargetOptions({
      hasAgentTargets: input.hasAgentTargets,
      allowBackToCaller: input.allowBackToCaller,
    }),
  });
  return normalizeInteractiveSkillsTargetChoice({
    action,
    allowBackToCaller: input.allowBackToCaller,
  });
}

async function resolveInteractiveInstallTargetAction(input: {
  action: InteractiveSkillsTargetChoice;
  actionableAgentTargets: SkillsInstallTarget[];
  actionableAgentIds: string[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  skillsConfig: RuntimeSkillsConfig | null;
}): Promise<SkillsPromptResult<SkillsInstallTarget[]>> {
  if (input.action === "custom") {
    const customDir = await promptForCustomSkillsDir();
    if (customDir.status !== "submitted") {
      return customDir;
    }
    return {
      status: "submitted",
      value: [buildCustomSkillsTarget(customDir.value, input.skillsConfig)],
    };
  }
  if (input.action === "all") {
    return {
      status: "submitted",
      value: input.actionableAgentTargets,
    };
  }
  return promptSkillsAgentTargets({
    message: "Choose agents to install OpenMeld skills for",
    agentIds: input.actionableAgentIds,
    registry: input.registry,
  });
}

function buildInteractiveUninstallTargetOptions(input: {
  hasAgentTargets: boolean;
  allowBackToCaller: boolean;
}): Array<{
  value: InteractiveSkillsTargetChoice | typeof INTERACTIVE_NAVIGATION_CHOICE;
  label: string;
  hint?: string;
}> {
  if (!input.hasAgentTargets) {
    return [
      {
        value: "custom",
        label: "Use a custom skills directory",
      },
      {
        value: INTERACTIVE_NAVIGATION_CHOICE,
        label: input.allowBackToCaller ? "Back" : "Cancel",
      },
    ];
  }
  return [
    {
      value: "select",
      label: "Select agents with OpenMeld skills installed",
      hint: "Choose one or more agents",
    },
    {
      value: "all",
      label: "Uninstall from all installed agents",
    },
    {
      value: "custom",
      label: "Use a custom skills directory",
    },
    {
      value: INTERACTIVE_NAVIGATION_CHOICE,
      label: input.allowBackToCaller ? "Back" : "Cancel",
    },
  ];
}

function buildInteractiveInstallTargetOptions(input: {
  hasAgentTargets: boolean;
  allowBackToCaller: boolean;
}): Array<{
  value: InteractiveSkillsInstallChoice | typeof INTERACTIVE_NAVIGATION_CHOICE;
  label: string;
  hint?: string;
}> {
  if (!input.hasAgentTargets) {
    return [
      {
        value: "custom",
        label: "Custom agent",
        hint: "Use a custom skills folder",
      },
      {
        value: "guide",
        label: "Manual install guide",
      },
      {
        value: INTERACTIVE_NAVIGATION_CHOICE,
        label: input.allowBackToCaller ? "Back" : "Cancel",
      },
    ];
  }
  return [
    {
      value: "all",
      label: "Install automatically",
      hint: "For all detected agents that need it",
    },
    {
      value: "select",
      label: "Choose agents",
      hint: "Pick which agents to install or update",
    },
    {
      value: "custom",
      label: "Custom agent",
      hint: "Use a custom skills folder",
    },
    {
      value: "guide",
      label: "Manual install guide",
    },
    {
      value: INTERACTIVE_NAVIGATION_CHOICE,
      label: input.allowBackToCaller ? "Back" : "Cancel",
    },
  ];
}

function normalizeInteractiveSkillsTargetChoice<TChoice>(input: {
  action: TChoice | typeof INTERACTIVE_NAVIGATION_CHOICE | symbol;
  allowBackToCaller: boolean;
}): InteractiveSkillsTargetChoiceResult<TChoice> {
  if (
    isCancel(input.action) ||
    input.action === INTERACTIVE_NAVIGATION_CHOICE
  ) {
    return {
      status: input.allowBackToCaller ? "back" : "cancelled",
    };
  }
  return {
    status: "selected",
    value: input.action as TChoice,
  };
}

async function promptSkillsAgentTargets(input: {
  message: string;
  agentIds: string[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
}): Promise<SkillsPromptResult<SkillsInstallTarget[]>> {
  const selected = await promptSearchMultiselect({
    message: input.message,
    items: input.agentIds.map((agentName) =>
      buildSkillsAgentSearchItem({
        agentId: agentName,
        displayName: input.registry[agentName]?.displayName ?? agentName,
        globalSkillsDir:
          input.registry[agentName]?.globalSkillsDir ?? "no global skills dir",
      })
    ),
    required: true,
    maxVisible: 8,
    allowBack: true,
    backLabel: "Back",
  });
  if (selected.status === "cancelled" || selected.status === "back") {
    return selected;
  }
  return {
    status: "submitted",
    value: buildAgentTargets(
      selected.value.sort((a, b) => a.localeCompare(b)),
      input.registry
    ),
  };
}

function buildSkillsAgentSearchItem(input: {
  agentId: string;
  displayName: string;
  globalSkillsDir: string;
}): SearchSelectItem<string> {
  return {
    value: input.agentId,
    label: input.displayName,
    detail: [`ID ${input.agentId}`, input.globalSkillsDir].join(" · "),
    searchText: [input.displayName, input.agentId, input.globalSkillsDir].join(
      " "
    ),
  };
}

async function promptForCustomSkillsDir(): Promise<SkillsPromptResult<string>> {
  for (;;) {
    const answer = await promptTextEntry({
      message: "Custom agent skills directory (absolute path)",
      placeholder: "/Users/<you>/.your-agent/skills",
      allowBack: true,
      backLabel: "Back",
      requiredMessage: "Path cannot be empty.",
    });
    if (answer.status !== "submitted") {
      return answer;
    }

    const trimmed = String(answer.value ?? "").trim();
    if (!trimmed) {
      process.stderr.write("Path cannot be empty.\n");
      continue;
    }

    const resolvedDir = resolve(trimmed);
    const stats = await stat(resolvedDir).catch(() => null);
    if (!stats?.isDirectory()) {
      process.stderr.write(
        `${formatInlineOpenMeldCliCommands(
          "Directory not found. Enter an existing directory path or run `openmeld skills install --guide`."
        )}\n`
      );
      continue;
    }
    return {
      status: "submitted",
      value: resolvedDir,
    };
  }
}

function handleSkillsCommandExit(input: {
  status: "back" | "cancelled";
  allowBackToCaller: boolean;
}): SkillsCommandNavigationResult {
  if (input.status === "back" && input.allowBackToCaller) {
    return "back";
  }
  cancel("Cancelled.");
  return "cancelled";
}

async function assertDirectoryExists(dir: string): Promise<void> {
  const stats = await stat(dir).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(
      formatSkillsCopy(
        `custom skills directory not found: ${dir}\nuse an existing directory or run \`openmeld skills install --guide\``
      )
    );
  }
}

async function persistSkillsInstallState(input: {
  previousSkillsConfig: RuntimeSkillsConfig | null;
  targets: SkillsInstallTarget[];
  installResults: SkillsInstallResult[];
}): Promise<void> {
  const records = buildInstallRecords(input.installResults);

  await updateConfiguredSkillsConfig((currentSkillsConfig) => {
    const baseSkillsConfig = currentSkillsConfig ?? input.previousSkillsConfig;
    const installs = mergeInstallsByTargetDir(
      baseSkillsConfig?.installs,
      records
    );
    const customTargets = mergeCustomTargets(
      baseSkillsConfig?.customTargets,
      input.targets
    );
    return {
      storeDir: baseSkillsConfig?.storeDir ?? skillsDir(),
      ...(baseSkillsConfig?.agents ? { agents: baseSkillsConfig.agents } : {}),
      ...(customTargets.length > 0 ? { customTargets } : {}),
      installs,
    };
  });
}

function mergeInstallsByTargetDir(
  previous: RuntimeSkillsInstallRecord[] | undefined,
  next: RuntimeSkillsInstallRecord[]
): RuntimeSkillsInstallRecord[] {
  const byTargetDir = new Map<string, RuntimeSkillsInstallRecord>();
  for (const record of previous ?? []) {
    byTargetDir.set(record.targetDir, record);
  }
  for (const record of next) {
    byTargetDir.set(record.targetDir, record);
  }
  return [...byTargetDir.values()].sort(compareInstallRecords);
}

function mergeCustomTargets(
  previous: RuntimeSkillsCustomTarget[] | undefined,
  targets: SkillsInstallTarget[]
): RuntimeSkillsCustomTarget[] {
  const customTargetMap = new Map<string, RuntimeSkillsCustomTarget>();
  for (const target of previous ?? []) {
    customTargetMap.set(target.dir, {
      id: resolveRuntimeSkillsCustomTargetId({
        dir: target.dir,
        ...(target.id ? { id: target.id } : {}),
      }),
      name: target.name,
      dir: target.dir,
    });
  }

  for (const target of targets.filter((item) => item.type === "custom")) {
    const existingTarget = customTargetMap.get(target.dir);
    customTargetMap.set(target.dir, {
      id: resolveRuntimeSkillsCustomTargetId({
        dir: target.dir,
        ...(existingTarget?.id ? { id: existingTarget.id } : { id: target.id }),
      }),
      name: existingTarget?.name ?? basename(target.dir),
      dir: target.dir,
    });
  }

  return [...customTargetMap.values()];
}

async function persistDetectedInstallStateFromCheck(input: {
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

function compareInstallRecords(
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

function buildInstallRecords(
  results: SkillsInstallResult[]
): RuntimeSkillsInstallRecord[] {
  const groups = new Map<string, SkillsInstallResult[]>();
  for (const result of results) {
    const key = `${result.targetId}${INSTALL_RECORD_GROUP_SEPARATOR}${result.targetDir}`;
    const list = groups.get(key) ?? [];
    list.push(result);
    groups.set(key, list);
  }

  const records: RuntimeSkillsInstallRecord[] = [];
  for (const [key, group] of groups) {
    // targetId comes from known agent ids or OpenMeld-generated custom ids like
    // "custom-<hash>", neither of which includes INSTALL_RECORD_GROUP_SEPARATOR.
    // Splitting on the first separator is safe for current input sources.
    const separatorIndex = key.indexOf(INSTALL_RECORD_GROUP_SEPARATOR);
    if (separatorIndex < 0) {
      continue;
    }
    const targetId = key.slice(0, separatorIndex);
    const targetDir = key.slice(
      separatorIndex + INSTALL_RECORD_GROUP_SEPARATOR.length
    );
    if (!(targetId && targetDir)) {
      continue;
    }
    const failed = group.filter((item) => item.status === "failed");
    const installed = group.filter((item) => item.status === "installed");
    const skipped = group.filter((item) => item.status === "skipped");

    let status: RuntimeSkillsInstallRecord["status"] = "skipped";
    if (failed.length > 0) {
      status = "failed";
    } else if (installed.length > 0) {
      status = "installed";
    }
    const mode: RuntimeSkillsInstallRecord["mode"] = group.some(
      (item) => item.mode === "copy"
    )
      ? "copy"
      : "symlink";
    const reason =
      [...failed, ...skipped]
        .map((entry) => entry.reason)
        .find((entry): entry is string => typeof entry === "string") ?? "";
    const skillIds = Array.from(
      new Set(group.map((entry) => entry.skillId))
    ).sort((a, b) => a.localeCompare(b));

    records.push({
      targetId,
      targetDir,
      mode,
      status,
      skillIds,
      ...(reason ? { reason } : {}),
      updatedAt: new Date().toISOString(),
    });
  }

  return records;
}

function emitInstallSummary(input: {
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  installResults: SkillsInstallResult[];
  legacyFindings?: LegacyOpenMeldSkillFinding[];
  quiet?: boolean;
  storeDir: string;
}): void {
  const summary = summarizeInstallResults(input.installResults);
  const installedTargets = summarizeInstalledTargets(input.installResults);
  const failed = input.installResults.filter(
    (item) => item.status === "failed"
  );
  const skipped = input.installResults.filter(
    (item) => item.status === "skipped"
  );
  const legacyFindings =
    input.resolvedView === "agent"
      ? formatLegacyOpenMeldSkillFindingsForAgentView(
          input.legacyFindings ?? []
        )
      : (input.legacyFindings ?? []);

  const payload = {
    storeDir: input.storeDir,
    summary,
    installedTargets,
    results: input.installResults,
    legacyFindings,
    legacyFindingCount: legacyFindings.length,
    legacyReview:
      legacyFindings.length > 0
        ? buildLegacyOpenMeldSkillAgentReview(legacyFindings)
        : null,
    requiresReview: summary.failed > 0 || legacyFindings.length > 0,
  };
  if (input.quiet && !payload.requiresReview) {
    return;
  }

  if (input.resolvedView === "agent") {
    emitLegacyOpenMeldSkillAgentAttention({
      legacyFindings,
      presenter: input.presenter,
      source: "skills.install",
    });
    input.presenter.data({
      code: "skills.install.summary",
      payload,
    });
    return;
  }

  emitInstallSummaryCardsForHuman({
    storeDir: input.storeDir,
    summary,
    installedTargets,
    legacyFindings: input.legacyFindings ?? [],
    skipped,
    failed,
  });
}

function summarizeInstalledTargets(results: SkillsInstallResult[]): Array<{
  targetId: string;
  targetDir: string;
  targetType: "agent" | "custom";
  skillIds: string[];
}> {
  const groups = new Map<
    string,
    {
      targetId: string;
      targetDir: string;
      targetType: "agent" | "custom";
      skillIds: Set<string>;
    }
  >();
  for (const result of results) {
    if (result.status !== "installed") {
      continue;
    }
    const key = [result.targetType, result.targetId, result.targetDir].join(
      INSTALL_RECORD_GROUP_SEPARATOR
    );
    const group = groups.get(key) ?? {
      targetId: result.targetId,
      targetDir: result.targetDir,
      targetType: result.targetType,
      skillIds: new Set<string>(),
    };
    group.skillIds.add(result.skillId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      targetId: group.targetId,
      targetDir: group.targetDir,
      targetType: group.targetType,
      skillIds: [...group.skillIds].sort((left, right) =>
        left.localeCompare(right)
      ),
    }))
    .sort((left, right) =>
      `${left.targetType}:${left.targetId}:${left.targetDir}`.localeCompare(
        `${right.targetType}:${right.targetId}:${right.targetDir}`
      )
    );
}

function emitUninstallSummary(input: {
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  uninstallResults: SkillsUninstallResult[];
  storeDir: string;
}): void {
  const summary = summarizeUninstallResults(input.uninstallResults);
  const failed = input.uninstallResults.filter(
    (item) => item.status === "failed"
  );
  const blocked = input.uninstallResults.filter(
    (item) => item.status === "blocked"
  );
  const skipped = input.uninstallResults.filter(
    (item) => item.status === "skipped"
  );
  const payload = {
    storeDir: input.storeDir,
    summary,
    results: input.uninstallResults,
  };

  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "skills.uninstall.summary",
      payload,
    });
    return;
  }

  emitSkillsUninstallSummaryCardsForHuman({
    storeDir: input.storeDir,
    summary,
    failed,
    blocked,
    skipped,
  });
}

function buildNonInteractiveInstallError(
  registry: ReturnType<typeof resolveSkillsAgentRegistry>,
  command: "ensure" | "install"
): string {
  const examples = buildSkillsTargetSelectionExamples({
    agentExampleArg: resolveInstallableAgentExamplePair(registry),
    command,
  });
  return formatSkillsCopy(
    [
      `openmeld skills ${command} requires explicit target selection in non-interactive mode.`,
      "",
      "Required:",
      ...getSkillsTargetSelectionRequiredArguments(command).map(
        (argument) => `  ${argument}`
      ),
      "",
      "Optional:",
      ...getSkillsTargetSelectionOptionalArguments(command).map(
        (argument) => `  ${argument}`
      ),
      "",
      "Examples:",
      ...examples.map((command) => `  ${command}`),
    ].join("\n")
  );
}

function resolveSkillsInstallSelectionInput(
  input: SkillsInstallInput,
  command: "ensure" | "install" = "install"
): {
  explicitAgents: string[];
  explicitDir: string;
  hasExplicitInstallArgs: boolean;
} {
  const explicitDir = String(input.dir ?? "").trim();
  const explicitAgents = Array.from(
    new Set(
      (input.agent ?? [])
        .map((agent) => agent.trim().toLowerCase())
        .filter((agent) => agent.length > 0)
    )
  );
  const hasExplicitInstallArgs =
    input.all === true ||
    explicitAgents.length > 0 ||
    explicitDir.length > 0 ||
    input.guide === true;

  if (hasExplicitInstallArgs) {
    validateSkillsTargetSelectionInput({
      all: input.all === true,
      command,
      explicitAgentIds: explicitAgents,
      explicitDir: explicitDir.length > 0 ? explicitDir : null,
      guide: input.guide === true,
    });
  }

  return {
    explicitAgents,
    explicitDir,
    hasExplicitInstallArgs,
  };
}

function resolveExplicitAgentTargetsOrThrow(input: {
  action: "ensure" | "install" | "uninstall";
  explicitAgents: string[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  registryKeys: string[];
  installableRegistryKeys: string[];
}): SkillsInstallTarget[] {
  const invalidAgents = input.explicitAgents.filter(
    (agent) => !input.registry[agent]
  );
  if (invalidAgents.length > 0) {
    throw new Error(
      `invalid agents: ${invalidAgents.join(", ")}\nvalid agents: ${input.registryKeys.join(", ")}`
    );
  }
  const nonInstallableAgents = input.explicitAgents.filter(
    (agent) => !isAgentSkillsInstallable(agent, input.registry)
  );
  if (nonInstallableAgents.length > 0) {
    throw new Error(
      buildNonInstallableAgentSelectionError({
        action: input.action,
        nonInstallableAgents,
        installableAgents: input.installableRegistryKeys,
      })
    );
  }
  if (!canManageRegistryAgentSkillTargets()) {
    const laneBlockedAgents = input.explicitAgents.filter(
      (agent) =>
        input.registry[agent]?.globalSkillsDirSource !== "config-override"
    );
    if (laneBlockedAgents.length > 0) {
      throw new Error(
        formatInlineOpenMeldCliCommands(
          `agent skills directories for ${laneBlockedAgents.join(", ")} are managed by the published OpenMeld home and cannot be targeted from this lane-specific OpenMeld home; use \`openmeld skills ${input.action} --dir <absolute-path>\` for lane-local targets`
        )
      );
    }
  }
  return buildAgentTargets(input.explicitAgents, input.registry);
}

function resolveDetectedInstallableTargetsOrThrow(input: {
  installedAgents: string[];
  registry: ReturnType<typeof resolveSkillsAgentRegistry>;
  action: "ensure" | "install" | "uninstall";
}): SkillsInstallTarget[] {
  const targets = buildAgentTargets(input.installedAgents, input.registry);
  if (targets.length > 0) {
    return targets;
  }
  if (!canManageRegistryAgentSkillTargets()) {
    throw new Error(
      formatInlineOpenMeldCliCommands(
        `detected agent skills directories are managed by the published OpenMeld home and cannot be targeted from this lane-specific OpenMeld home; use \`openmeld skills ${input.action} --dir <absolute-path>\` for lane-local targets`
      )
    );
  }
  if (input.action === "install" || input.action === "ensure") {
    throw new Error(
      formatInlineOpenMeldCliCommands(
        `no installable detected agents were found in your home directory; use \`openmeld skills ${input.action} --dir <absolute-path>\` or \`openmeld skills ${input.action} --guide\``
      )
    );
  }
  throw new Error(
    formatInlineOpenMeldCliCommands(
      "no installable detected agents were found in your home directory; use `openmeld skills uninstall --dir <absolute-path>`"
    )
  );
}

function isAgentSkillsInstallable(
  agentId: string,
  registry: ReturnType<typeof resolveSkillsAgentRegistry>
): boolean {
  return registry[agentId]?.skillsInstallable === true;
}

function resolveInstallableAgentIds(
  registry: ReturnType<typeof resolveSkillsAgentRegistry>
): string[] {
  return Object.entries(registry)
    .filter((entry) => entry[1].skillsInstallable === true)
    .map((entry) => entry[0]);
}

function buildNonInstallableAgentSelectionError(input: {
  action: "ensure" | "install" | "uninstall";
  nonInstallableAgents: string[];
  installableAgents: string[];
}): string {
  const installableAgentsLine =
    input.installableAgents.length > 0
      ? input.installableAgents.join(", ")
      : "(none)";
  return [
    `unsupported agents for skills ${input.action}: ${input.nonInstallableAgents.join(", ")}`,
    "known agents but not installable (skillsInstallable=false)",
    `installable agents: ${installableAgentsLine}`,
  ].join("\n");
}
