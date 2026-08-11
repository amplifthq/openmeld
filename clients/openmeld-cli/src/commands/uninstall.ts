import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import pc from "picocolors";
import type { OpenMeldEnvPreset } from "../config/paths";
import { resolveOpenMeldRootDir } from "../config/paths";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import {
  clearLaneAuthSession,
  getLaneAuthSessionMetadata,
  removeLaneOpenMeldHome,
  runLaneDaemonTeardown,
  runLaneSkillsCleanup,
} from "../uninstall/adapters";
import {
  type LaneAuthTokenIdentity,
  resolveAuthTokenCleanupWarnings,
} from "../uninstall/auth-token-impact";
import {
  UNINSTALL_ALL_CONFIRM_TOKEN,
  UNINSTALL_ALL_LANES_COPY,
  UNINSTALL_ALL_LANES_SKILLS_PROMPT_TITLE,
  UNINSTALL_AUTH_TOKENS_PROMPT,
  UNINSTALL_SKILLS_PROMPT,
} from "../uninstall/copy";
import {
  inferProductionCliInstallSourceFromPaths,
  resolveFinalCliRemovalCommand,
} from "../uninstall/final-cli-removal";
import { runUninstallFlow } from "../uninstall/flow";
import {
  ALL_UNINSTALL_LANES,
  listScopeLanes,
  resolveCurrentUninstallLane,
  resolveUninstallScope,
} from "../uninstall/lane-scope";
import type {
  ManualCliRemoval,
  ProductionCliInstallSource,
  UninstallAction,
  UninstallFlowResult,
  UninstallScope,
} from "../uninstall/types";
import { emitTopLevelAgentOverview } from "./top-level-agent-overview";

const execFileAsync = promisify(execFile);
export const UNINSTALL_INTERNAL_SAFE_VALIDATION_FLAG =
  "--internal-safe-validation";

export type UninstallCliInput = {
  view?: string;
  yes?: boolean;
  force?: boolean;
  allLanes?: boolean;
  keepSkills?: boolean;
  removeSkills?: boolean;
  keepAuthTokens?: boolean;
  removeAuthTokens?: boolean;
  internalSafeValidation?: boolean;
};

export async function runUninstall(
  input: UninstallCliInput
): Promise<UninstallFlowResult> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  if (runtime.resolvedView === "agent") {
    emitTopLevelAgentOverview({
      presenter,
      command: "uninstall",
    });
  }

  const interactive =
    runtime.resolvedView === "human" && canUseInteractivePrompts(runtime);
  const currentLane = resolveCurrentUninstallLane({
    env: process.env,
    argv: process.argv,
  });
  const scope = resolveUninstallScope({
    allLanes: input.allLanes,
    env: process.env,
    argv: process.argv,
  });
  const internalSafeValidation = input.internalSafeValidation === true;
  const currentLaneOpenMeldHome =
    scope.kind === "current-lane"
      ? resolveOpenMeldRootDir({
          env: process.env,
          argv: process.argv,
        })
      : null;

  assertInternalSafeValidationMode({
    enabled: internalSafeValidation,
    scope,
    currentLaneOpenMeldHome,
    removeSkills: input.removeSkills === true,
    removeAuthTokens: input.removeAuthTokens === true,
  });

  const result = await runUninstallFlow(
    {
      scope,
      interactive,
      yes: input.yes === true,
      force: input.force === true,
    },
    {
      resolveSkillsAction: async ({ scope, interactive }) =>
        internalSafeValidation
          ? resolvedKeepAction()
          : await resolveSkillsAction({
              scope,
              interactive,
              keepSkills: input.keepSkills === true,
              removeSkills: input.removeSkills === true,
              presenter,
            }),
      resolveAuthTokenAction: async ({ scope, interactive }) =>
        internalSafeValidation
          ? resolvedKeepAction()
          : await resolveAuthTokenAction({
              scope,
              interactive,
              keepAuthTokens: input.keepAuthTokens === true,
              removeAuthTokens: input.removeAuthTokens === true,
              presenter,
            }),
      confirmCurrentLane: async ({ interactive, yes }) =>
        await confirmCurrentLaneRemoval({
          interactive,
          yes,
          lane: currentLane,
          presenter,
        }),
      confirmAllLanes: async ({ interactive, yes, force }) =>
        await confirmAllLanesRemoval({
          interactive,
          yes,
          force,
          presenter,
        }),
      resolveWarnings: async ({ scope, authTokenAction }) => {
        const laneIdentities = await resolveLaneAuthTokenIdentities({
          scope,
          currentLane,
          currentLaneOpenMeldHome,
        });
        const warnings = resolveAuthTokenCleanupWarnings({
          scope,
          currentLane,
          authTokenAction,
          laneIdentities,
        });
        if (runtime.resolvedView === "human" && warnings.length > 0) {
          emitHumanWarnings({
            presenter,
            warnings,
          });
        }
        return warnings;
      },
      removeSkills: async (request) => {
        for (const lane of listScopeLanes(request.scope)) {
          await runLaneSkillsCleanup(
            resolveScopedLaneInput({
              lane,
              scope: request.scope,
              currentLane,
              currentLaneOpenMeldHome,
            })
          );
        }
      },
      clearAuthTokens: async (request) => {
        for (const lane of listScopeLanes(request.scope)) {
          await clearLaneAuthSession(
            resolveScopedLaneInput({
              lane,
              scope: request.scope,
              currentLane,
              currentLaneOpenMeldHome,
            })
          );
        }
      },
      teardownService: async ({ lane }) => {
        if (internalSafeValidation) {
          return {
            removed: false,
          };
        }
        const result = await runLaneDaemonTeardown({
          ...resolveScopedLaneInput({
            lane,
            scope,
            currentLane,
            currentLaneOpenMeldHome,
          }),
        });
        return {
          removed: result.removed,
        };
      },
      removeHome: async ({ lane }) => {
        return await removeLaneOpenMeldHome(
          resolveScopedLaneInput({
            lane,
            scope,
            currentLane,
            currentLaneOpenMeldHome,
          })
        );
      },
      resolveFinalCliRemoval: async () =>
        await resolveFinalRemovalForCurrentCommand(currentLane),
    }
  );

  if (result.status === "cancelled") {
    return result;
  }

  if (result.status === "blocked") {
    throw new Error(result.reason);
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "uninstall.completed",
      payload: {
        scope: result.request.scope,
        skillsAction: result.request.skillsAction,
        authTokenAction: result.request.authTokenAction,
        warnings: result.request.warnings,
        laneResults: result.laneResults,
        finalCliRemoval: result.finalCliRemoval,
        internalSafeValidation,
      },
    });
    return result;
  }

  renderInfoCard({
    presenter,
    title: buildHumanUninstallCardTitle(result),
    codePrefix: "uninstall.completed.card",
    rows: buildHumanUninstallCardRows({
      result,
      internalSafeValidation,
    }),
  });
  return result;
}

async function resolveSkillsAction(input: {
  scope: UninstallScope;
  interactive: boolean;
  keepSkills: boolean;
  removeSkills: boolean;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<
  { status: "resolved"; value: UninstallAction } | { status: "cancelled" }
> {
  const explicit = resolveExplicitAction({
    keep: input.keepSkills,
    remove: input.removeSkills,
    flagName: "skills",
  });
  if (explicit) {
    return {
      status: "resolved",
      value: explicit,
    };
  }

  if (!input.interactive) {
    throw new Error(
      "openmeld uninstall requires --keep-skills or --remove-skills in non-interactive mode"
    );
  }

  renderInfoCard({
    presenter: input.presenter,
    title: "⚠️ Before You Remove OpenMeld",
    codePrefix: "uninstall.skills.card",
    rows: buildHumanSkillsPromptCardRows(input.scope),
  });
  const selection = await select({
    message:
      input.scope.kind === "all-lanes"
        ? UNINSTALL_ALL_LANES_SKILLS_PROMPT_TITLE
        : UNINSTALL_SKILLS_PROMPT.title,
    initialValue: "keep",
    options: [
      {
        value: "keep",
        label: UNINSTALL_SKILLS_PROMPT.keepLabel,
        hint: UNINSTALL_SKILLS_PROMPT.keepHint,
      },
      {
        value: "remove",
        label: UNINSTALL_SKILLS_PROMPT.removeLabel,
        hint: UNINSTALL_SKILLS_PROMPT.removeHint,
      },
    ],
  });
  if (isCancel(selection)) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
    };
  }
  return {
    status: "resolved",
    value: selection as UninstallAction,
  };
}

async function resolveAuthTokenAction(input: {
  scope: UninstallScope;
  interactive: boolean;
  keepAuthTokens: boolean;
  removeAuthTokens: boolean;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<
  { status: "resolved"; value: UninstallAction } | { status: "cancelled" }
> {
  const explicit = resolveExplicitAction({
    keep: input.keepAuthTokens,
    remove: input.removeAuthTokens,
    flagName: "auth tokens",
  });
  if (explicit) {
    return {
      status: "resolved",
      value: explicit,
    };
  }

  if (!input.interactive) {
    throw new Error(
      "openmeld uninstall requires --keep-auth-tokens or --remove-auth-tokens in non-interactive mode"
    );
  }

  renderInfoCard({
    presenter: input.presenter,
    title: "⚠️ Before You Remove OpenMeld",
    codePrefix: "uninstall.auth.card",
    rows: buildHumanAuthPromptCardRows(),
  });
  const selection = await select({
    message: UNINSTALL_AUTH_TOKENS_PROMPT.title,
    initialValue: "keep",
    options: [
      {
        value: "keep",
        label: UNINSTALL_AUTH_TOKENS_PROMPT.keepLabel,
        hint: UNINSTALL_AUTH_TOKENS_PROMPT.keepHint,
      },
      {
        value: "remove",
        label: UNINSTALL_AUTH_TOKENS_PROMPT.removeLabel,
        hint: UNINSTALL_AUTH_TOKENS_PROMPT.removeHint,
      },
    ],
  });
  if (isCancel(selection)) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
    };
  }
  return {
    status: "resolved",
    value: selection as UninstallAction,
  };
}

async function confirmCurrentLaneRemoval(input: {
  interactive: boolean;
  yes: boolean;
  lane: OpenMeldEnvPreset;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<{ status: "resolved"; value: true } | { status: "cancelled" }> {
  if (!input.interactive) {
    if (!input.yes) {
      throw new Error(
        "openmeld uninstall requires --yes in non-interactive mode"
      );
    }
    return {
      status: "resolved",
      value: true,
    };
  }

  if (input.yes) {
    return {
      status: "resolved",
      value: true,
    };
  }

  renderInfoCard({
    presenter: input.presenter,
    title: `⚠️ Remove ${resolveHumanOpenMeldCopyName(input.lane)}?`,
    codePrefix: "uninstall.confirm.card",
    rows: buildHumanCurrentRemovalCardRows(input.lane),
  });
  const confirmed = await confirm({
    message: `Remove ${resolveHumanOpenMeldCopyName(input.lane)} now?`,
    initialValue: false,
  });
  if (isCancel(confirmed) || !confirmed) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
    };
  }
  return {
    status: "resolved",
    value: true,
  };
}

async function confirmAllLanesRemoval(input: {
  interactive: boolean;
  yes: boolean;
  force: boolean;
  presenter: ReturnType<typeof createPresenter>;
}): Promise<{ status: "resolved"; value: true } | { status: "cancelled" }> {
  if (!input.interactive) {
    if (!(input.yes && input.force)) {
      throw new Error(
        "openmeld uninstall --all-lanes requires --yes --force in non-interactive mode"
      );
    }
    return {
      status: "resolved",
      value: true,
    };
  }

  renderInfoCard({
    presenter: input.presenter,
    title: "⚠️ Remove Every OpenMeld Copy?",
    codePrefix: "uninstall.confirm_all.card",
    rows: buildHumanAllLanesRemovalCardRows(),
  });
  const confirmation = await text({
    message: UNINSTALL_ALL_LANES_COPY.confirm,
    placeholder: UNINSTALL_ALL_CONFIRM_TOKEN,
  });
  if (
    isCancel(confirmation) ||
    String(confirmation ?? "")
      .trim()
      .toUpperCase() !== UNINSTALL_ALL_CONFIRM_TOKEN
  ) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
    };
  }
  return {
    status: "resolved",
    value: true,
  };
}

async function resolveLaneAuthTokenIdentities(input: {
  scope: UninstallScope;
  currentLane: ReturnType<typeof resolveCurrentUninstallLane>;
  currentLaneOpenMeldHome: string | null;
}): Promise<LaneAuthTokenIdentity[]> {
  const identities: LaneAuthTokenIdentity[] = [];
  for (const lane of ALL_UNINSTALL_LANES) {
    const metadata = await getLaneAuthSessionMetadata(
      resolveScopedLaneInput({
        lane,
        scope: input.scope,
        currentLane: input.currentLane,
        currentLaneOpenMeldHome: input.currentLaneOpenMeldHome,
      })
    );
    if (!(metadata?.authBaseUrl && metadata.clientId)) {
      continue;
    }
    identities.push({
      lane,
      authBaseUrl: metadata.authBaseUrl,
      clientId: metadata.clientId,
    });
  }
  return identities;
}

async function resolveFinalRemovalForCurrentCommand(
  currentLane: ReturnType<typeof resolveCurrentUninstallLane>
): Promise<ManualCliRemoval> {
  if (currentLane !== "prod") {
    return resolveFinalCliRemovalCommand({
      currentLane,
    });
  }

  const productionInstallSource = await resolveProductionCliInstallSource();
  return resolveFinalCliRemovalCommand({
    currentLane,
    productionInstallSource,
  });
}

function resolveScopedLaneInput(input: {
  lane: (typeof ALL_UNINSTALL_LANES)[number];
  scope: UninstallScope;
  currentLane: ReturnType<typeof resolveCurrentUninstallLane>;
  currentLaneOpenMeldHome: string | null;
}): {
  lane: (typeof ALL_UNINSTALL_LANES)[number];
  openMeldHome?: string;
} {
  if (
    input.scope.kind === "current-lane" &&
    input.lane === input.currentLane &&
    input.currentLaneOpenMeldHome
  ) {
    return {
      lane: input.lane,
      openMeldHome: input.currentLaneOpenMeldHome,
    };
  }
  return {
    lane: input.lane,
  };
}

function assertInternalSafeValidationMode(input: {
  enabled: boolean;
  scope: UninstallScope;
  currentLaneOpenMeldHome: string | null;
  removeSkills: boolean;
  removeAuthTokens: boolean;
}): void {
  if (!input.enabled) {
    return;
  }

  if (input.scope.kind !== "current-lane") {
    throw new Error(
      "openmeld uninstall --internal-safe-validation only supports the local OpenMeld installation under test"
    );
  }

  if (!input.currentLaneOpenMeldHome) {
    throw new Error(
      "openmeld uninstall --internal-safe-validation requires the local OpenMeld home to point to a temp directory"
    );
  }

  if (input.removeSkills || input.removeAuthTokens) {
    throw new Error(
      "openmeld uninstall --internal-safe-validation always keeps OpenMeld-installed skills and OpenMeld auth tokens"
    );
  }

  assertTempOpenMeldHome(input.currentLaneOpenMeldHome);
}

function resolvedKeepAction(): {
  status: "resolved";
  value: UninstallAction;
} {
  return {
    status: "resolved",
    value: "keep",
  };
}

async function resolveProductionCliInstallSource(): Promise<ProductionCliInstallSource> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmGlobalRootPath = await execFileAsync(npmCommand, ["root", "-g"], {
    encoding: "utf8",
  })
    .then((result) => String(result.stdout ?? "").trim())
    .catch(() => "");

  return inferProductionCliInstallSourceFromPaths({
    cliScriptPath: process.argv[1],
    npmGlobalRootPath,
  });
}

function assertTempOpenMeldHome(openMeldHome: string): void {
  const tempRoot = tmpdir();
  if (!isPathInsideRoot({ rootDir: tempRoot, candidatePath: openMeldHome })) {
    throw new Error(
      `openmeld uninstall --internal-safe-validation requires the local OpenMeld home under ${tempRoot}; use a fresh temp directory`
    );
  }
}

function resolveExplicitAction(input: {
  keep: boolean;
  remove: boolean;
  flagName: string;
}): UninstallAction | null {
  if (input.keep && input.remove) {
    throw new Error(
      `openmeld uninstall does not allow both keep and remove flags for ${input.flagName}`
    );
  }
  if (input.keep) {
    return "keep";
  }
  if (input.remove) {
    return "remove";
  }
  return null;
}

function emitHumanWarnings(input: {
  presenter: ReturnType<typeof createPresenter>;
  warnings: readonly { message: string }[];
}): void {
  for (const warning of input.warnings) {
    input.presenter.line({
      code: "uninstall.warning",
      text: warning.message,
    });
  }
}

function buildHumanUninstallCardTitle(
  result: Extract<UninstallFlowResult, { status: "completed" }>
): string {
  if (result.request.scope.kind === "all-lanes") {
    return "👋 OpenMeld Removed From This Mac";
  }
  return `👋 ${resolveHumanOpenMeldCopyName(result.request.scope.lane)} Removed`;
}

function buildHumanUninstallCardRows(input: {
  result: Extract<UninstallFlowResult, { status: "completed" }>;
  internalSafeValidation: boolean;
}): InfoCardRow[] {
  const currentLane =
    input.result.request.scope.kind === "current-lane"
      ? input.result.request.scope.lane
      : null;
  const rows: InfoCardRow[] = [
    {
      label: "Status",
      value: pc.bold(pc.green("Done")),
    },
    {
      label: "Removed",
      value:
        currentLane === null
          ? "OpenMeld, OpenMeld Dev, and OpenMeld Canary data on this Mac"
          : `${resolveHumanOpenMeldCopyName(currentLane)} data on this Mac`,
    },
    {
      label: "OpenMeld Service",
      value: buildHumanBackgroundServiceSummary(input.result),
    },
    { label: "", value: "" },
    {
      label: "Skills",
      value: formatHumanKeepOrRemove(input.result.request.skillsAction),
    },
    {
      label: "Sign-in",
      value: formatHumanKeepOrRemove(input.result.request.authTokenAction),
    },
    ...(input.internalSafeValidation
      ? [
          { label: "", value: "" },
          {
            label: "Test mode",
            value: "OpenMeld kept your skills and sign-in.",
          },
        ]
      : []),
    { label: "", value: "" },
    {
      label: "Next step",
      value: buildFinalCliRemovalLine(input.result.finalCliRemoval),
    },
  ];

  return rows;
}

function buildHumanSkillsPromptCardRows(scope: UninstallScope): InfoCardRow[] {
  const skillsTarget =
    scope.kind === "all-lanes"
      ? "the skills OpenMeld installed for OpenMeld, OpenMeld Dev, and OpenMeld Canary on this Mac"
      : `the skills OpenMeld installed for ${resolveHumanOpenMeldCopyName(scope.lane)}`;
  return [
    {
      label: "This step",
      value: `Keep or remove ${skillsTarget}.`,
    },
    {
      label: "If removed",
      value: "OpenMeld deletes them.",
    },
    {
      label: "Recommend",
      value: "Keep them",
    },
  ];
}

function buildHumanAuthPromptCardRows(): InfoCardRow[] {
  return [
    {
      label: "This step",
      value: "Keep or remove your OpenMeld sign-in on this Mac.",
    },
    {
      label: "If removed",
      value: "OpenMeld signs you out here.",
    },
    {
      label: "Recommend",
      value: "Keep it",
    },
  ];
}

function buildHumanCurrentRemovalCardRows(
  lane: OpenMeldEnvPreset
): InfoCardRow[] {
  const openMeldCopyName = resolveHumanOpenMeldCopyName(lane);
  return [
    {
      label: "This removes",
      value: `${openMeldCopyName} data on this Mac`,
    },
    {
      label: "This also stops",
      value: `${openMeldCopyName} OpenMeld Service`,
    },
    {
      label: "What stays",
      value: "The OpenMeld command you used",
    },
  ];
}

function buildHumanAllLanesRemovalCardRows(): InfoCardRow[] {
  return [
    {
      label: "This removes",
      value: "OpenMeld, OpenMeld Dev, and OpenMeld Canary on this Mac",
    },
    {
      label: "This also removes",
      value: "Their local data and OpenMeld Service setup",
    },
    {
      label: "To continue",
      value: 'Type "UNINSTALL ALL"',
    },
  ];
}

function buildHumanBackgroundServiceSummary(
  result: Extract<UninstallFlowResult, { status: "completed" }>
): string {
  const removedCount = result.laneResults.filter(
    (lane) => lane.serviceRemoved
  ).length;
  if (removedCount === 0) {
    return "Was not set up here";
  }
  if (removedCount === 1) {
    return "Removed";
  }
  return `${pc.bold(String(removedCount))} removed`;
}

function formatHumanKeepOrRemove(action: UninstallAction): string {
  return action === "remove"
    ? pc.bold(pc.green("Removed"))
    : pc.bold(pc.yellow("Kept"));
}

function resolveHumanOpenMeldCopyName(lane: OpenMeldEnvPreset): string {
  switch (lane) {
    case "dev-local":
      return "OpenMeld Dev";
    case "canary":
      return "OpenMeld Canary";
    default:
      return "OpenMeld";
  }
}

function buildFinalCliRemovalLine(removal: ManualCliRemoval): string {
  if (removal.kind === "command") {
    return `Run ${pc.bold(pc.cyan(removal.command))} to finish removing OpenMeld.`;
  }
  return "Remove the OpenMeld command the same way you installed it.";
}

function isPathInsideRoot(input: {
  rootDir: string;
  candidatePath: string;
}): boolean {
  const rootDir = resolvePathForSafetyCheck(input.rootDir);
  const candidatePath = resolvePathForSafetyCheck(input.candidatePath);
  const relativePath = relative(rootDir, candidatePath);
  if (relativePath.length === 0) {
    return true;
  }
  if (relativePath.startsWith("..")) {
    return false;
  }
  return !isAbsolute(relativePath);
}

function resolvePathForSafetyCheck(path: string): string {
  const resolved = resolve(path);
  const direct = resolveRealPathOrNull(resolved);
  if (direct) {
    return direct;
  }

  let cursor = resolved;
  const missingSegments: string[] = [];
  while (true) {
    const existing = resolveRealPathOrNull(cursor);
    if (existing) {
      return missingSegments.length === 0
        ? existing
        : join(existing, ...missingSegments.reverse());
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return resolved;
    }
    missingSegments.push(cursor.slice(parent.length + 1));
    cursor = parent;
  }
}

function resolveRealPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
